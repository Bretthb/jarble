# Pre-Deployment Checklist

> Complete these items before deploying Jarble MVP to production.
> **Architecture:** EC2 + Docker (not Fargate/Organizations for MVP)

---

## 1. AWS Account Setup

| Item | Status | Notes |
|------|--------|-------|
| [ ] AWS account created | | Single account for MVP |
| [ ] IAM admin user (not root) | | MFA enabled |
| [ ] Billing alerts configured | | $50, $100 thresholds |
| [ ] Region selected | | us-east-1 |

---

## 2. Secrets & Credentials

| Item | Status | How to get |
|------|--------|------------|
| [ ] LiteLLM API key | | https://litellm.ai/keys |
| [ ] Auth0 domain + client ID | | Auth0 Dashboard |
| [ ] Auth0 client secret | | Auth0 Dashboard → Applications |
| [ ] Database password | | Generate secure password |
| [ ] EC2 SSH key pair | | AWS Console → EC2 → Key Pairs |

**Store in AWS Secrets Manager:**
```bash
# LiteLLM key
aws secretsmanager create-secret \
  --name jarble/litellm-api-key \
  --secret-string "sk-or-v1-xxxx"

# Database URL
aws secretsmanager create-secret \
  --name jarble/database-url \
  --secret-string "mysql://user:pass@host/jarble"
```

---

## 3. Database (RDS)

| Item | Status | Notes |
|------|--------|-------|
| [ ] RDS MySQL instance created | | Aurora or MySQL 8.0 |
| [ ] Database `jarble` created | | `CREATE DATABASE jarble;` |
| [ ] Security group allows EC2 | | Port 3306 from EC2 SG |
| [ ] Drizzle migrations run | | `npx drizzle-kit push` |
| [ ] Seed data loaded | | Tiers, platforms tables |

**RDS Settings:**
- Instance: db.t3.micro (MVP) or db.t3.small
- Storage: 20GB gp2
- Multi-AZ: No (MVP)
- Backup: 7 days retention

---

## 4. EC2 Instance

| Item | Status | Notes |
|------|--------|-------|
| [ ] EC2 instance launched | | t3.medium |
| [ ] SSH key configured | | Key pair from step 2 |
| [ ] Security group created | | See rules below |
| [ ] IAM role attached | | S3 + Secrets Manager access |
| [ ] Docker installed | | Run ec2-setup.sh |
| [ ] docker-compose installed | | Included in setup script |
| [ ] /data/bots directory created | | Persistent storage |

**Security Group Rules:**
```
Inbound:
- SSH (22) from your IP only
- (No inbound needed for bots - they connect outbound)

Outbound:
- All traffic (WhatsApp Web, LiteLLM, etc.)
```

**EC2 Bootstrap:**
```bash
ssh -i jarble-key.pem ec2-user@<EC2_IP>
curl -O https://raw.githubusercontent.com/your-org/jarble/main/infra/ec2-setup.sh
chmod +x ec2-setup.sh
./ec2-setup.sh
```

---

## 5. S3 Buckets

| Item | Status | Notes |
|------|--------|-------|
| [ ] `jarble-skill-templates` created | | Bot templates |
| [ ] `jarble-bot-data` created | | Backups |
| [ ] Default template uploaded | | SOUL.md, AGENTS.md, etc. |
| [ ] Bucket policies configured | | EC2 role can read/write |

```bash
# Create buckets
aws s3 mb s3://jarble-skill-templates
aws s3 mb s3://jarble-bot-data

# Upload default template
aws s3 cp ./templates/default/ s3://jarble-skill-templates/default/ --recursive
```

---

## 6. Auth0 Configuration

| Item | Status | Notes |
|------|--------|-------|
| [ ] Application created | | Regular Web Application |
| [ ] Callback URLs configured | | https://jarble.ai/api/auth/callback |
| [ ] Logout URLs configured | | https://jarble.ai |
| [ ] Google social connection | | Optional but recommended |
| [ ] GitHub social connection | | Optional |

**Auth0 URLs:**
```
Allowed Callback URLs:
  http://localhost:3000/api/auth/callback
  https://jarble.ai/api/auth/callback
  https://staging.jarble.ai/api/auth/callback

Allowed Logout URLs:
  http://localhost:3000
  https://jarble.ai
  https://staging.jarble.ai
```

---

## 7. Vercel Deployment

| Item | Status | Notes |
|------|--------|-------|
| [ ] Vercel project created | | Import from GitHub |
| [ ] Environment variables set | | See list below |
| [ ] Custom domain configured | | jarble.ai |
| [ ] Production branch set | | main |

**Environment Variables:**
```
AUTH0_SECRET=<random-32-char-string>
AUTH0_BASE_URL=https://jarble.ai
AUTH0_ISSUER_BASE_URL=https://jarble-dev.us.auth0.com
AUTH0_CLIENT_ID=<from-auth0>
AUTH0_CLIENT_SECRET=<from-auth0>
DATABASE_URL=mysql://user:pass@rds-endpoint/jarble
EC2_HOST=<ec2-public-ip>
EC2_SSH_KEY=<base64-encoded-private-key>
```

---

## 8. Bot Deployment Scripts

| Item | Status | Notes |
|------|--------|-------|
| [ ] deploy-bot.sh on EC2 | | /home/ec2-user/scripts/ |
| [ ] remove-bot.sh on EC2 | | /home/ec2-user/scripts/ |
| [ ] restart-bot.sh on EC2 | | /home/ec2-user/scripts/ |
| [ ] Scripts executable | | chmod +x |
| [ ] Scripts tested manually | | Deploy test bot |

---

## 9. Monitoring & Alerts

| Item | Status | Notes |
|------|--------|-------|
| [ ] CloudWatch agent installed | | On EC2 |
| [ ] CPU alarm (>80%) | | SNS notification |
| [ ] Disk alarm (>80%) | | SNS notification |
| [ ] docker stats logging | | Cron every 5 min |

---

## 10. Backup & Recovery

| Item | Status | Notes |
|------|--------|-------|
| [ ] S3 backup cron configured | | Daily at 3am |
| [ ] RDS automated backups | | 7 day retention |
| [ ] Test restore procedure | | Document steps |

---

## 11. Testing Checklist

| Test | Status | Notes |
|------|--------|-------|
| [ ] Auth0 login works | | Google + email |
| [ ] New user redirects to onboarding | | /onboarding/new |
| [ ] Bot creation saves to DB | | Check bots table |
| [ ] Deploy creates container | | docker ps shows bot |
| [ ] Bot responds in WhatsApp | | Send test message |
| [ ] Bot persists memory | | Check /data/bots/{id}/ |
| [ ] Dashboard shows bot status | | Status: active |

---

## 12. Go-Live Checklist

| Item | Status | Notes |
|------|--------|-------|
| [ ] All tests passing | | See testing checklist |
| [ ] DNS configured | | jarble.ai → Vercel |
| [ ] SSL certificate active | | Auto via Vercel |
| [ ] Error monitoring setup | | Sentry or similar |
| [ ] Support email configured | | support@jarble.ai |
| [ ] Documentation updated | | User-facing docs |

---

## Quick Reference

### SSH to EC2
```bash
ssh -i jarble-key.pem ec2-user@<EC2_IP>
```

### Check running bots
```bash
docker ps
docker stats
```

### Deploy a bot manually
```bash
./scripts/deploy-bot.sh <bot-id> free
```

### View bot logs
```bash
docker logs bot-<id> -f
```

### RDS connection
```bash
mysql -h <rds-endpoint> -u admin -p jarble
```
