# Infra Agent Specification

> **Mission:** Set up and maintain AWS infrastructure for Jarble using EC2 + Docker
> **Architecture:** Shared EC2 instance with Docker containers (MVP), scales to multiple EC2s

---

## Agent Profile

| Attribute | Value |
|-----------|-------|
| **Name** | Infra Agent |
| **Role** | Infrastructure & DevOps |
| **Primary Language** | Bash, Docker, YAML |
| **Key Tools** | AWS CLI, Docker, docker-compose, SSH |
| **Output** | Deployment scripts, docker-compose configs, runbooks |

---

## Core Responsibilities

### MVP Phase (Current)
- **EC2 setup** — Launch and configure bot host instance
- **Docker deployment** — Container orchestration with docker-compose
- **Resource management** — CPU/memory limits per bot
- **Backup strategy** — S3 sync for bot workspaces

### Scale Phase (Future)
- Multiple EC2 instances with load distribution
- Docker Swarm for orchestration
- Automated scaling based on metrics

### Enterprise Phase (V2)
- ECS Fargate migration
- AWS Organizations for tenant isolation
- Per-customer AWS accounts

---

## Architecture Overview

```
SINGLE AWS ACCOUNT (jarble-prod)
├── EC2 Instance (t3.medium, ~$30/mo)
│   ├── Docker Engine
│   ├── docker-compose.yml (all bots)
│   └── /data/bots/{bot_id}/ (persistent volumes)
│
├── RDS MySQL (Aurora)
│   └── jarble database
│
├── S3: jarble-skill-templates
├── S3: jarble-bot-data (backups)
└── Secrets Manager: LiteLLM key
```

---

## MVP Infrastructure Tasks

### 1. EC2 Instance Setup

**Launch instance:**
```bash
# t3.medium in us-east-1 (~$30/mo)
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \
  --instance-type t3.medium \
  --key-name jarble-key \
  --security-group-ids sg-jarble-bots \
  --iam-instance-profile Name=jarble-ec2-role \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=jarble-bots}]' \
  --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":50,"VolumeType":"gp3"}}]'
```

**Security group rules:**
```bash
# Create security group
aws ec2 create-security-group \
  --group-name jarble-bots \
  --description "Jarble bot EC2 instances"

# Allow SSH from known IPs only
aws ec2 authorize-security-group-ingress \
  --group-name jarble-bots \
  --protocol tcp --port 22 \
  --cidr YOUR_IP/32

# Allow all outbound (for WhatsApp Web, LiteLLM)
aws ec2 authorize-security-group-egress \
  --group-name jarble-bots \
  --protocol -1 --port -1 \
  --cidr 0.0.0.0/0
```

**Bootstrap script (user-data):**
```bash
#!/bin/bash
yum update -y
yum install docker -y
systemctl start docker
systemctl enable docker
usermod -aG docker ec2-user

# Install docker-compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Create bot data directory
mkdir -p /data/bots
chown ec2-user:ec2-user /data/bots

# Create base docker-compose.yml
cat > /home/ec2-user/docker-compose.yml << 'EOF'
version: '3.8'

# Bot services are added dynamically by deploy-bot.sh
services: {}
EOF
chown ec2-user:ec2-user /home/ec2-user/docker-compose.yml
```

---

### 2. Docker Compose Template

**Base `docker-compose.yml`:**
```yaml
version: '3.8'

services:
  # Each bot is added as a service
  # Example:
  # bot-abc123:
  #   image: jarble-bot:latest
  #   container_name: bot-abc123
  #   deploy:
  #     resources:
  #       limits:
  #         cpus: '0.5'
  #         memory: 512M
  #       reservations:
  #         cpus: '0.25'
  #         memory: 256M
  #   environment:
  #     - BOT_ID=abc123
  #     - TELEGRAM_TOKEN=${BOT_abc123_TELEGRAM_TOKEN}
  #     - LITELLM_API_KEY=${LITELLM_API_KEY}
  #     - DATABASE_URL=${DATABASE_URL}
  #   volumes:
  #     - /data/bots/abc123:/app/workspace
  #   restart: unless-stopped
```

---

### 3. Deployment Scripts

**`deploy-bot.sh`:**
```bash
#!/bin/bash
set -e

BOT_ID=$1
TIER=${2:-free}

if [ -z "$BOT_ID" ]; then
    echo "Usage: deploy-bot.sh <bot-id> [tier]"
    exit 1
fi

# Set resource limits based on tier
case $TIER in
    free)
        CPU_LIMIT="0.25"
        MEM_LIMIT="256M"
        CPU_RESERVE="0.1"
        MEM_RESERVE="128M"
        ;;
    starter)
        CPU_LIMIT="0.5"
        MEM_LIMIT="512M"
        CPU_RESERVE="0.25"
        MEM_RESERVE="256M"
        ;;
    pro)
        CPU_LIMIT="1.0"
        MEM_LIMIT="1G"
        CPU_RESERVE="0.5"
        MEM_RESERVE="512M"
        ;;
    *)
        echo "Unknown tier: $TIER"
        exit 1
        ;;
esac

# Create workspace directory
mkdir -p /data/bots/$BOT_ID
mkdir -p /data/bots/$BOT_ID/memory

# Copy default template (SOUL.md, AGENTS.md, etc.)
aws s3 cp s3://jarble-skill-templates/default/ /data/bots/$BOT_ID/ --recursive

# Get LiteLLM key from Secrets Manager
LITELLM_KEY=$(aws secretsmanager get-secret-value \
    --secret-id jarble/litellm-api-key \
    --query SecretString --output text)

# Create .env file for this bot
# WhatsApp session is established via QR code during onboarding
cat > /data/bots/$BOT_ID/.env << EOF
BOT_ID=$BOT_ID
WHATSAPP_ENABLED=true
LITELLM_API_KEY=$LITELLM_KEY
DATABASE_URL=$DATABASE_URL
EOF

# Add service to docker-compose.yml using yq or sed
# (Using simple append for MVP)
cat >> ~/docker-compose.yml << EOF

  bot-$BOT_ID:
    image: jarble-bot:latest
    container_name: bot-$BOT_ID
    deploy:
      resources:
        limits:
          cpus: '$CPU_LIMIT'
          memory: $MEM_LIMIT
        reservations:
          cpus: '$CPU_RESERVE'
          memory: $MEM_RESERVE
    env_file:
      - /data/bots/$BOT_ID/.env
    volumes:
      - /data/bots/$BOT_ID:/app/workspace
    restart: unless-stopped
EOF

# Start the bot
cd ~
docker-compose up -d bot-$BOT_ID

echo "Bot $BOT_ID deployed successfully"
```

**`remove-bot.sh`:**
```bash
#!/bin/bash
set -e

BOT_ID=$1
DELETE_DATA=${2:-false}

if [ -z "$BOT_ID" ]; then
    echo "Usage: remove-bot.sh <bot-id> [delete-data:true/false]"
    exit 1
fi

# Stop and remove container
cd ~
docker-compose stop bot-$BOT_ID
docker-compose rm -f bot-$BOT_ID

# Remove from docker-compose.yml
# (In production, use yq for proper YAML editing)
sed -i "/bot-$BOT_ID:/,/restart: unless-stopped/d" ~/docker-compose.yml

# Optionally delete data
if [ "$DELETE_DATA" = "true" ]; then
    echo "Deleting bot data..."
    rm -rf /data/bots/$BOT_ID
else
    echo "Bot data preserved at /data/bots/$BOT_ID"
fi

echo "Bot $BOT_ID removed"
```

**`restart-bot.sh`:**
```bash
#!/bin/bash
BOT_ID=$1

cd ~
docker-compose restart bot-$BOT_ID
echo "Bot $BOT_ID restarted"
```

---

### 4. S3 Resources

**Create buckets:**
```bash
# Templates bucket
aws s3 mb s3://jarble-skill-templates --region us-east-1

# Backup bucket
aws s3 mb s3://jarble-bot-data --region us-east-1

# Upload default template
aws s3 cp ./templates/default/ s3://jarble-skill-templates/default/ --recursive
```

**Default template structure:**
```
templates/default/
├── SOUL.md
├── AGENTS.md
├── TOOLS.md
├── MEMORY.md
└── memory/
    └── .gitkeep
```

---

### 5. Secrets Manager

```bash
# Store LiteLLM key
aws secretsmanager create-secret \
  --name jarble/litellm-api-key \
  --secret-string "sk-or-v1-xxxx" \
  --region us-east-1

# Store database URL
aws secretsmanager create-secret \
  --name jarble/database-url \
  --secret-string "mysql://user:pass@jarble-db.xxx.rds.amazonaws.com/jarble" \
  --region us-east-1
```

---

### 6. IAM Role for EC2

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::jarble-skill-templates",
        "arn:aws:s3:::jarble-skill-templates/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::jarble-bot-data",
        "arn:aws:s3:::jarble-bot-data/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": [
        "arn:aws:secretsmanager:us-east-1:*:secret:jarble/*"
      ]
    }
  ]
}
```

---

### 7. Backup Strategy

**Daily backup cron (on EC2):**
```bash
# /etc/cron.daily/backup-bots
#!/bin/bash
aws s3 sync /data/bots/ s3://jarble-bot-data/backups/$(date +%Y-%m-%d)/ \
  --exclude "*.db-journal" \
  --exclude "*.log"

# Keep only last 7 days
aws s3 ls s3://jarble-bot-data/backups/ | while read -r line; do
  DIR=$(echo $line | awk '{print $2}')
  DATE=$(echo $DIR | tr -d '/')
  if [[ $(date -d "$DATE" +%s) -lt $(date -d "7 days ago" +%s) ]]; then
    aws s3 rm s3://jarble-bot-data/backups/$DIR --recursive
  fi
done
```

---

### 8. Monitoring

**CloudWatch agent config:**
```json
{
  "metrics": {
    "namespace": "Jarble/Bots",
    "metrics_collected": {
      "cpu": {
        "measurement": ["cpu_usage_idle", "cpu_usage_user"],
        "metrics_collection_interval": 60
      },
      "mem": {
        "measurement": ["mem_used_percent"],
        "metrics_collection_interval": 60
      },
      "disk": {
        "measurement": ["disk_used_percent"],
        "resources": ["/data"],
        "metrics_collection_interval": 60
      }
    }
  }
}
```

**Docker stats collection:**
```bash
#!/bin/bash
# /etc/cron.d/docker-stats
# Collect docker stats every 5 minutes
*/5 * * * * root docker stats --no-stream --format \
  "{{.Name}},{{.CPUPerc}},{{.MemUsage}}" >> /var/log/docker-stats.log
```

---

## Scaling Checklist

When to add another EC2:
- [ ] Average CPU > 70% sustained for 24h
- [ ] Memory usage > 80%
- [ ] More than 15-20 active bots
- [ ] Response latency increasing

How to scale:
1. Launch new EC2 with same setup
2. Update deployment logic to round-robin new bots
3. Consider Docker Swarm for orchestration

---

## Security Checklist

- [ ] SSH key-based auth only (no passwords)
- [ ] Security group limits SSH to known IPs
- [ ] Secrets in AWS Secrets Manager (not env files on disk)
- [ ] EBS encryption enabled
- [ ] IAM role with minimal permissions
- [ ] Regular security updates (`yum update`)

---

## Troubleshooting

### Bot won't start
```bash
# Check logs
docker logs bot-{id}

# Check compose config
docker-compose config

# Check resources
docker stats
```

### Out of disk space
```bash
# Check disk usage
df -h /data

# Prune old images
docker system prune -a

# Check largest bot workspaces
du -sh /data/bots/* | sort -hr | head -10
```

### Bot not responding
```bash
# Check container status
docker ps -a | grep bot-{id}

# Restart
docker-compose restart bot-{id}

# Check WhatsApp session status
docker exec bot-{id} openclaw status
```

---

## Phase 1C Deliverables

- [ ] EC2 instance running with Docker
- [ ] Security group configured
- [ ] IAM role attached
- [ ] `deploy-bot.sh` script working
- [ ] `remove-bot.sh` script working
- [ ] S3 buckets created
- [ ] LiteLLM key in Secrets Manager
- [ ] Default template uploaded to S3
- [ ] Backup cron configured
- [ ] Test bot deployed and responding
