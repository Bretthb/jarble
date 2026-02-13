# Jarble Operations Runbook

> Standard operating procedures for managing Jarble infrastructure.
> **Architecture:** EC2 + Docker (MVP)

---

## Quick Reference

### SSH Access
```bash
ssh -i jarble-key.pem ec2-user@<EC2_IP>
```

### Common Commands
```bash
# List running bots
docker ps

# Bot logs
docker logs bot-<id> -f

# Resource usage
docker stats

# Restart a bot
docker-compose restart bot-<id>

# Deploy a bot
./scripts/deploy-bot.sh <bot-id> <tier>

# Remove a bot
./scripts/remove-bot.sh <bot-id> [true|false]
```

---

## 1. Bot Management

### 1.1 Deploy a New Bot

**From dashboard (normal flow):**
1. User completes onboarding
2. API calls deploy script via SSH/SSM
3. Bot container starts automatically

**Manual deployment:**
```bash
ssh -i jarble-key.pem ec2-user@<EC2_IP>
./scripts/deploy-bot.sh abc123 "123456:ABC-DEF" free
```

**Verify deployment:**
```bash
docker ps | grep bot-abc123
docker logs bot-abc123
```

### 1.2 Stop a Bot

**Temporary stop (preserves data):**
```bash
docker-compose stop bot-<id>
```

**Full removal:**
```bash
./scripts/remove-bot.sh <bot-id> false  # Keep data
./scripts/remove-bot.sh <bot-id> true   # Delete data
```

### 1.3 Restart a Bot

```bash
docker-compose restart bot-<id>

# Or force recreate:
docker-compose up -d --force-recreate bot-<id>
```

### 1.4 Update Bot Image

```bash
# Pull latest image
docker pull jarble/bot:latest

# Restart all bots with new image
docker-compose up -d

# Or restart specific bot
docker-compose up -d bot-<id>
```

### 1.5 View Bot Logs

```bash
# Live logs
docker logs bot-<id> -f

# Last 100 lines
docker logs bot-<id> --tail 100

# Logs with timestamps
docker logs bot-<id> -t
```

---

## 2. Troubleshooting

### 2.1 Bot Not Responding

**Diagnostic flowchart:**
```
Bot not responding
        │
        ▼
Is container running?
docker ps | grep bot-<id>
        │
   ┌────┴────┐
   No        Yes
   │          │
   ▼          ▼
Check logs   Check WhatsApp session
docker logs  curl webhook info
   │          │
   ▼          ▼
Fix error    Is LiteLLM working?
Restart      Check API key
```

**Check container status:**
```bash
docker ps -a | grep bot-<id>
# If "Exited" - check logs for crash reason
```

**Check WhatsApp session:**
```bash
# Check if WhatsApp is connected in container
docker exec bot-<id> openclaw status
# Look for "whatsapp: connected" in output
```

**Check LiteLLM connectivity:**
```bash
docker exec bot-<id> curl -s https://litellm.ai/api/v1/models | head
```

### 2.2 High Resource Usage

**Identify resource hogs:**
```bash
docker stats --no-stream | sort -k3 -hr  # Sort by CPU
docker stats --no-stream | sort -k4 -hr  # Sort by memory
```

**Check disk usage:**
```bash
df -h /data
du -sh /data/bots/* | sort -hr | head -10
```

**Solutions:**
- Restart the container: `docker-compose restart bot-<id>`
- Increase limits: Edit docker-compose.yml, recreate container
- Upgrade tier: More resources for customer

### 2.3 Container Won't Start

**Check logs:**
```bash
docker logs bot-<id>
```

**Common issues:**

| Error | Cause | Fix |
|-------|-------|-----|
| "TELEGRAM_TOKEN not set" | Missing env var | Check .env file |
| "Cannot connect to database" | DB unreachable | Check RDS security group |
| "Out of memory" | Container OOM | Increase memory limit |
| "Permission denied" | Volume permissions | `chown -R 1000:1000 /data/bots/<id>` |

**Recreate container:**
```bash
docker-compose rm -f bot-<id>
docker-compose up -d bot-<id>
```

### 2.4 Database Issues

**Test RDS connection:**
```bash
mysql -h <rds-endpoint> -u admin -p -e "SELECT 1;"
```

**Check from EC2:**
```bash
nc -zv <rds-endpoint> 3306
```

**If connection fails:**
- Check security group allows EC2 → RDS on port 3306
- Check RDS is running in AWS console
- Check credentials in Secrets Manager

---

## 3. Scaling Operations

### 3.1 When to Scale

**Add another EC2 when:**
- Average CPU > 70% for 24 hours
- Memory usage > 80%
- More than 15-20 active bots
- Response latency degraded

**Monitor:**
```bash
# Real-time stats
docker stats

# Historical (if CloudWatch agent installed)
aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name CPUUtilization \
  --start-time $(date -d "1 hour ago" -u +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Average
```

### 3.2 Add New EC2 Instance

1. Launch new EC2 with same setup:
```bash
# Use same AMI, security group, IAM role
aws ec2 run-instances \
  --image-id <ami-id> \
  --instance-type t3.medium \
  --key-name jarble-key \
  --security-group-ids <sg-id> \
  --iam-instance-profile Name=jarble-ec2-role
```

2. Run setup script on new instance
3. Update deployment logic to use new instance for new bots
4. (Optional) Migrate some bots to balance load

### 3.3 Migrate Bot to Another EC2

```bash
# On source EC2:
docker-compose stop bot-<id>

# Sync data to new EC2:
rsync -avz /data/bots/<id>/ ec2-user@<NEW_IP>:/data/bots/<id>/

# On destination EC2:
# Add bot to docker-compose.yml
docker-compose up -d bot-<id>

# On source EC2 (after verification):
./scripts/remove-bot.sh <id> true
```

---

## 4. Backup & Recovery

### 4.1 Manual Backup

```bash
# Full backup to S3
aws s3 sync /data/bots/ s3://jarble-bot-data/manual-$(date +%Y-%m-%d)/

# Single bot backup
aws s3 sync /data/bots/<id>/ s3://jarble-bot-data/bots/<id>/
```

### 4.2 Restore from Backup

```bash
# List available backups
aws s3 ls s3://jarble-bot-data/

# Restore specific bot
aws s3 sync s3://jarble-bot-data/2026-02-11/<id>/ /data/bots/<id>/
docker-compose up -d bot-<id>
```

### 4.3 Database Backup

**Manual snapshot:**
```bash
aws rds create-db-snapshot \
  --db-instance-identifier jarble-db \
  --db-snapshot-identifier jarble-manual-$(date +%Y%m%d)
```

**Export data:**
```bash
mysqldump -h <rds-endpoint> -u admin -p jarble > jarble-backup.sql
```

---

## 5. Security Incidents

### 5.1 Suspected Compromised Bot

1. **Isolate immediately:**
```bash
docker-compose stop bot-<id>
```

2. **Preserve logs:**
```bash
docker logs bot-<id> > /tmp/incident-bot-<id>.log 2>&1
```

3. **Backup workspace:**
```bash
cp -r /data/bots/<id> /tmp/incident-workspace-<id>
```

4. **Investigate:**
- Check workspace for suspicious files
- Review conversation logs
- Check for API key misuse

5. **Remediate:**
- Disconnect WhatsApp session (user re-links via QR)
- Reset LiteLLM key if necessary
- Notify customer

### 5.2 EC2 Security

**Update packages:**
```bash
sudo yum update -y
```

**Check for unauthorized access:**
```bash
# Recent logins
last -10

# Failed SSH attempts
sudo cat /var/log/secure | grep "Failed password"
```

**Rotate SSH key:**
1. Generate new key pair in AWS
2. Add new public key to `~/.ssh/authorized_keys`
3. Test new key works
4. Remove old key
5. Delete old key pair in AWS

---

## 6. Maintenance

### 6.1 Update Docker

```bash
sudo yum update docker -y
sudo systemctl restart docker
# Containers auto-restart due to restart: unless-stopped
```

### 6.2 Prune Old Resources

```bash
# Remove unused images
docker image prune -a

# Remove unused volumes
docker volume prune

# Full cleanup (caution!)
docker system prune -a
```

### 6.3 EC2 Instance Maintenance

**Before AWS maintenance window:**
1. Backup all bot data to S3
2. Note which bots are running
3. After instance restarts, verify all containers up

```bash
# Verify after restart
docker-compose up -d
docker ps
```

---

## 7. Cost Monitoring

### 7.1 AWS Costs

**Main cost drivers:**
- EC2: ~$30/mo per t3.medium
- RDS: ~$15-30/mo for db.t3.micro
- S3: Minimal (~$1-5/mo)
- Data transfer: Variable

**Check costs:**
```bash
aws ce get-cost-and-usage \
  --time-period Start=$(date -d "30 days ago" +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE
```

### 7.2 LiteLLM Costs

- Check usage at https://litellm.ai/activity
- Pass through to customers with markup
- Monitor for unusual spikes

---

## 8. Contacts & Escalation

| Issue | Contact | Response Time |
|-------|---------|---------------|
| Bot not working | Support email | 24 hours |
| Security incident | Security team | Immediate |
| AWS issues | AWS Support | Per support plan |
| LiteLLM issues | support@litellm.ai | 48 hours |
