# Jarble Production Setup Guide

Onboarding reference for a new Claude Code instance or developer machine. Covers the live production environment, not local dev. For local dev setup, see `CLAUDE.md` and `docs/DEVELOPER-GUIDE.md`.

**Current branch**: `develop`
**Production frontend**: https://dev.jarble.ai (develop branch on Vercel)
**Production API**: https://api.jarble.ai (K3s on Hetzner)

---

## Table of Contents

1. [Infrastructure Overview](#1-infrastructure-overview)
2. [Local Machine Setup](#2-local-machine-setup)
3. [MCP Servers in Claude Code](#3-mcp-servers-in-claude-code)
4. [Environment Variables Reference](#4-environment-variables-reference)
5. [Common Operations](#5-common-operations)
6. [Deploy and Release](#6-deploy-and-release)
7. [Auth0 Configuration](#7-auth0-configuration)
8. [Monitoring](#8-monitoring)
9. [Known Issues and TODO](#9-known-issues-and-todo)
10. [Architecture Quick Reference](#10-architecture-quick-reference)

---

## 1. Infrastructure Overview

### Hetzner K3s Cluster

Three nodes on Hetzner Cloud (Ashburn, VA, `us-east` zone):

| Node | Role | Private IP | Server type |
|------|------|-----------|-------------|
| `jarble-master` | K3s control plane | `10.0.1.10` | cpx21 (3 vCPU, 4GB RAM) |
| `jarble-agent-1` | Worker | `10.0.1.20` | cpx21 (3 vCPU, 4GB RAM) |
| `jarble-agent-2` | Worker | `10.0.1.21` | cpx21 (3 vCPU, 4GB RAM) |

Each worker node has a 100 GB Hetzner Block Storage volume mounted at `/var/lib/longhorn` for Longhorn persistent volumes.

Cluster networking:
- Private network: `10.0.0.0/16`, subnet `10.0.1.0/24`
- Ingress: Traefik (K3s built-in), with a floating IP pointing at the master
- TLS: cert-manager with Let's Encrypt HTTP-01 challenges via Traefik
- DNS: Cloudflare, `api.jarble.ai` and `*.jarble.ai` both point to the master's public IP

Namespace layout:
- `jarble` — API deployment, bot pods, secrets, PVCs
- `monitoring` — Prometheus, node-exporter, kube-state-metrics
- `cert-manager` — cert-manager controllers
- `kube-system` — K3s system pods, Traefik, CoreDNS

### Neon PostgreSQL

Serverless PostgreSQL via Neon. The `develop` branch uses the `develop` database branch. Connection string is stored in the K8s secret `jarble-api-secrets.DATABASE_URL` and is the `postgresql://` pooler URL (not direct).

The API uses `DB_PROVIDER=postgres` in production. Drizzle ORM with `drizzle-pg/` migration files. Migrations run automatically via `entrypoint.sh` on pod startup.

### Vercel (Frontend)

Next.js 15 frontend deployed on Vercel. The `develop` branch deploys to `dev.jarble.ai`. The `main` branch is the production branch (currently not in active use, develop is the working branch).

All `NEXT_PUBLIC_*` environment variables are baked at build time. Changing them requires a redeploy.

Container image: built from `jarble-api-main/Dockerfile` with monorepo context (includes `shared/`). Published to `ghcr.io/jarble-ai/api:latest` via GitHub Actions.

---

## 2. Local Machine Setup

### Prerequisites

Install these before working on the repo:

```bash
# Node.js 22 (required — matches Dockerfile base image)
# Install via nvm or https://nodejs.org

# kubectl
# macOS: brew install kubectl
# Linux: https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/
# Windows: winget install Kubernetes.kubectl

# GitHub CLI
# macOS: brew install gh
# Linux/Windows: https://cli.github.com/
gh auth login

# Vercel CLI (optional, for triggering deploys)
npm install -g vercel
```

### Clone and Initialize

```bash
git clone https://github.com/jarble-ai/jarble.git
cd jarble
git checkout develop

# Restore Claude Code memory, install npm deps, set up CodeGraphContext
bash scripts/setup.sh
```

The setup script:
1. Copies `.claude/memory/*.md` to your local Claude projects memory directory so context is available immediately
2. Runs `npm install` in `Jarble-mvp/` and `jarble-api-main/`
3. Optionally sets up the CodeGraphContext Docker container (code analysis MCP)

### Kubeconfig Setup

The cluster kubeconfig lives on the master node. Fetch it once and store it at `~/.kube/jarble-prod.yaml`:

```bash
# Get the master's public IP first (from Hetzner console or terraform output)
MASTER_IP="<master-public-ip>"

# Copy kubeconfig from master (requires SSH access)
scp root@$MASTER_IP:/etc/rancher/k3s/k3s.yaml ~/.kube/jarble-prod.yaml

# Replace 127.0.0.1 with the real master IP
sed -i "s/127.0.0.1/$MASTER_IP/g" ~/.kube/jarble-prod.yaml

# Test
KUBECONFIG=~/.kube/jarble-prod.yaml kubectl get nodes
```

Expected output:
```
NAME               STATUS   ROLES                  AGE
jarble-master      Ready    control-plane,master   ...
jarble-agent-1     Ready    <none>                 ...
jarble-agent-2     Ready    <none>                 ...
```

All `kubectl` commands in this guide assume you export the kubeconfig first:

```bash
export KUBECONFIG=~/.kube/jarble-prod.yaml
```

On Windows (PowerShell):
```powershell
$env:KUBECONFIG = "C:\Users\<you>\.kube\jarble-prod.yaml"
```

The RUNBOOK.md uses `C:\Users\tanne\kubeconfig.yaml` — substitute your actual path.

### SSH Access

```bash
ssh root@<master-public-ip>
ssh root@<agent-1-public-ip>
ssh root@<agent-2-public-ip>
```

SSH key must be the one registered in Hetzner for this cluster. If you don't have it, get the private key from the team.

---

## 3. MCP Servers in Claude Code

Configured in `.claude/settings.json`. These are available in every Claude Code session in this repo.

### codegraphcontext

Local code graph analysis server. Requires Docker running.

```json
{
  "command": "bash",
  "args": ["scripts/cgc-mcp.sh"],
  "env": { "PYTHONIOENCODING": "utf-8" }
}
```

Run `bash scripts/codegraph/setup.sh` once to start the Docker container.

### jarble-debug

Connects to a locally running API instance for debugging. Requires the API dev server running on port 3001.

```json
{
  "command": "bash",
  "args": ["scripts/jarble-debug-mcp.sh"],
  "env": { "JARBLE_API_URL": "http://localhost:3001" }
}
```

### playwright

Browser automation for UI testing and QA. Launches a browser you can drive from Claude Code.

```json
{
  "command": "node",
  "args": ["...npx-cli.js", "-y", "@playwright/mcp@latest"]
}
```

### chrome-devtools

Chrome DevTools Protocol access — network requests, console, performance profiling, screenshots.

```json
{
  "command": "node",
  "args": ["...npx-cli.js", "-y", "chrome-devtools-mcp@latest", "--autoConnect"]
}
```

### sentry

Access Sentry error tracking — list issues, get event details, update issue status.

```json
{
  "command": "node",
  "args": ["...npx-cli.js", "-y", "@sentry/mcp-server@latest", "--access-token", "<token>"]
}
```

Token stored in `.claude/settings.json`. Scoped to the Jarble Sentry org.

### vercel

Vercel platform management — list deployments, check build logs, manage env vars, trigger redeployments.

```json
{
  "command": "node",
  "args": ["...npx-cli.js", "-y", "--package", "@vercel/sdk", "--", "mcp", "start", "--bearer-token", "<token>"]
}
```

Token stored in `.claude/settings.json`.

### auth0

Auth0 Management API access via MCP. Manage applications, users, actions, logs, resource servers.

```json
{
  "command": "node",
  "args": ["...npx-cli.js", "-y", "@auth0/auth0-mcp-server", "run", "--tools", "*"],
  "env": { "DEBUG": "auth0-mcp" }
}
```

The Auth0 MCP requires you to run `mcp__auth0__auth0_save_credentials_to_file` once to authenticate. Credentials are cached locally.

---

## 4. Environment Variables Reference

### API (K8s Secret: `jarble-api-secrets`, namespace `jarble`)

These are the actual keys the API pods read from `envFrom.secretRef`. The template is at `jarble-api-main/k8s/secrets.yaml.example`.

| Key | Value / Notes |
|-----|---------------|
| `PORT` | `3001` |
| `NODE_ENV` | `production` |
| `FRONTEND_URL` | `https://dev.jarble.ai` (CORS origin) |
| `DB_PROVIDER` | `postgres` |
| `DATABASE_URL` | Neon PostgreSQL pooler URL (`postgresql://...`) |
| `AUTH0_DOMAIN` | `jarble-dev.us.auth0.com` (develop branch uses dev tenant) |
| `AUTH0_AUDIENCE` | `https://api.jarble.ai` |
| `AUTH0_M2M_SECRET` | Shared secret for Auth0 webhook callbacks (optional) |
| `AUTH0_MGMT_CLIENT_ID` | Auth0 Management API client ID (for email resend) |
| `AUTH0_MGMT_CLIENT_SECRET` | Auth0 Management API client secret |
| `OPENROUTER_API_KEY` | `sk-or-...` Platform key for managed LLM routing |
| `OPENROUTER_MANAGEMENT_KEY` | Provisioning tenant API keys for managed plans |
| `API_KEY_ENCRYPTION_KEY` | 64-char hex string (32 bytes AES-256-GCM). Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `STRIPE_SECRET_KEY` | `sk_test_...` — not yet configured, feature disabled |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` — not yet configured |
| `STRIPE_PRICE_PRO` | Stripe price ID for Pro plan |
| `STRIPE_PRICE_AGENCY` | Stripe price ID for Agency plan |
| `RESEND_API_KEY` | `re_...` Optional, for beta welcome emails |
| `ADMIN_USER_IDS` | Comma-separated Auth0 user IDs for admin router access |
| `PROMETHEUS_URL` | Default: `http://prometheus.monitoring.svc.cluster.local:9090` |

To view current values (requires kubectl access):

```bash
kubectl get secret jarble-api-secrets -n jarble -o jsonpath='{.data}' | \
  python3 -c "import sys,json,base64; d=json.load(sys.stdin); [print(f'{k}: {base64.b64decode(v).decode()}') for k,v in d.items()]"
```

### Frontend (Vercel Environment Variables)

Set in the Vercel dashboard under Project Settings > Environment Variables. These are baked at build time.

| Key | Develop branch value |
|-----|----------------------|
| `NEXT_PUBLIC_API_URL` | `https://api.jarble.ai` |
| `NEXT_PUBLIC_AUTH0_DOMAIN` | `jarble-dev.us.auth0.com` |
| `NEXT_PUBLIC_AUTH0_CLIENT_ID` | `1VR30862RmZIFR44UIM8aVHYEt3K2Rsh` |
| `NEXT_PUBLIC_AUTH0_AUDIENCE` | `https://api.jarble.ai` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_...` — not yet active |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` |

---

## 5. Common Operations

### Check API Health

```bash
curl https://api.jarble.ai/health

# Check pods
kubectl get pods -n jarble -l app=jarble-api

# Tail logs (last 100 lines across all API replicas)
kubectl logs -n jarble -l app=jarble-api --tail=100 --follow
```

### Restart the API

```bash
kubectl rollout restart deployment/jarble-api -n jarble

# Watch rollout progress
kubectl rollout status deployment/jarble-api -n jarble
```

### Check a Bot Pod

Bot pods are named `dep-{deploymentId}-...` and carry the label `app=dep-{deploymentId}`.

```bash
# List all bot pods
kubectl get pods -n jarble -l jarble.ai/type=bot

# Logs for a specific bot
kubectl logs -n jarble -l app=dep-<deploymentId> --tail=50

# Describe pod (events, resource usage, restart count)
kubectl describe pod -n jarble -l app=dep-<deploymentId>
```

### Restart a Stuck Bot Pod

```bash
kubectl delete pod -n jarble -l app=dep-<deploymentId>
# K8s recreates it automatically from the Deployment
```

If the pod is stuck in `creating` status in the Jarble DB:

```bash
# Use the debug endpoint (dev/staging only)
curl -X POST https://api.jarble.ai/debug/deployment/<deploymentId>/status \
  -H "Content-Type: application/json" \
  -d '{"status":"running"}'
```

### Clear a Corrupted Bot PVC

npm cache corruption on Longhorn PVCs (`ENOTEMPTY` errors) requires clearing the npm cache and reinstalling:

```bash
# Exec into the bot pod
kubectl exec -n jarble -it <pod-name> -- sh

# Inside the pod:
rm -rf /data/.npm /data/runtime/node_modules /data/.initialized
exit

# Delete the pod so K8s recreates it fresh
kubectl delete pod -n jarble <pod-name>
```

### Update a K8s Secret

```bash
# Patch a single key
kubectl patch secret jarble-api-secrets -n jarble \
  -p '{"stringData":{"KEY_NAME":"new-value"}}'

# Restart API to pick up changes
kubectl rollout restart deployment/jarble-api -n jarble
```

To add or replace the entire secret from the template:

```bash
cp jarble-api-main/k8s/secrets.yaml.example jarble-api-main/k8s/secrets.yaml
# Edit secrets.yaml — fill in real values
kubectl apply -f jarble-api-main/k8s/secrets.yaml
rm jarble-api-main/k8s/secrets.yaml  # never commit this
kubectl rollout restart deployment/jarble-api -n jarble
```

### Query the Production Database

```bash
# Get a pod name
POD=$(kubectl get pods -n jarble -l app=jarble-api -o name | head -1)

# Run a query
kubectl exec -n jarble $POD -- node -e '
const { Client } = require("pg");
const c = new Client(process.env.DATABASE_URL);
c.connect()
  .then(() => c.query("SELECT id, email, created_at FROM users ORDER BY created_at DESC LIMIT 10"))
  .then(r => { console.log(JSON.stringify(r.rows, null, 2)); return c.end(); })
  .catch(e => { console.error(e); process.exit(1); });
'
```

### Run a Database Migration

Migrations are SQL files in `jarble-api-main/drizzle-pg/`. The entrypoint runs them automatically on startup, but if you need to run one manually:

```bash
POD=$(kubectl get pods -n jarble -l app=jarble-api -o name | head -1)

kubectl exec -n jarble $POD -- node -e '
const { Client } = require("pg");
const c = new Client(process.env.DATABASE_URL);
c.connect()
  .then(() => c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS new_column TEXT`))
  .then(r => { console.log("Done"); return c.end(); })
  .catch(e => { console.error(e); process.exit(1); });
'
```

### Trigger a Vercel Redeploy

Code changes on `develop` deploy automatically. For config-only changes (env var updates with no code change):

```bash
# Empty commit to trigger Vercel
git commit --allow-empty -m "chore: trigger Vercel redeploy"
git push origin develop
```

Or use the Vercel MCP in Claude Code: ask it to redeploy the `dev.jarble.ai` deployment.

Or use the Vercel dashboard: Deployments > find the latest > Redeploy.

### SSH into a Node

```bash
# Master (K3s API, etcd)
ssh root@<master-public-ip>

# Worker nodes (where bot pods run)
ssh root@<agent-1-public-ip>
ssh root@<agent-2-public-ip>

# Check Longhorn volume mount
ssh root@<agent-ip> "df -h /var/lib/longhorn"
```

### Set Up the GHCR Pull Secret

Bot pods and the API deployment pull from `ghcr.io/jarble-ai`. A pull secret must exist in the `jarble` namespace.

```bash
# Create with a GitHub PAT that has read:packages scope
kubectl create secret docker-registry ghcr-pull-secret \
  -n jarble \
  --docker-server=ghcr.io \
  --docker-username=<github-username> \
  --docker-password=<github-pat>
```

---

## 6. Deploy and Release

### Shipping API Changes

The workflow is: code change on `develop` → push → GitHub Actions builds and pushes image → manual pod restart.

```bash
# 1. Push your change
git push origin develop

# 2. Trigger the build workflow manually (or wait for it to trigger on push to main)
gh workflow run "Build API Image" --ref develop

# 3. Watch the build
gh run list --workflow=build-api-image.yml --limit=3
gh run watch <run-id>

# 4. Once the image is pushed, restart pods
kubectl rollout restart deployment/jarble-api -n jarble
kubectl rollout status deployment/jarble-api -n jarble

# 5. Verify
curl https://api.jarble.ai/health
```

Note: the `build-api-image.yml` workflow triggers automatically on push to `main` when `jarble-api-main/` or `shared/` files change. For the `develop` branch, trigger it manually with `gh workflow run`.

The image is published to `ghcr.io/jarble-ai/api:latest` (plus a SHA tag for rollbacks).

### Rolling Back the API

```bash
# Find previous image SHA tags
gh api /orgs/jarble-ai/packages/container/api/versions --jq '.[].metadata.container.tags'

# Update the deployment to use a specific SHA
kubectl set image deployment/jarble-api api=ghcr.io/jarble-ai/api:<sha> -n jarble
kubectl rollout status deployment/jarble-api -n jarble
```

### Shipping Frontend Changes

Vercel deploys automatically on every push to `develop`. No manual step needed unless env vars changed.

```bash
git push origin develop
# Vercel picks up the change within ~1 minute
# Monitor at: vercel.com/dashboard or via Vercel MCP
```

### Applying K8s Manifest Changes

```bash
# API deployment (RBAC, Deployment spec, Service, Ingress)
kubectl apply -f jarble-api-main/k8s/deployment.yaml

# Network policies for bot pods
kubectl apply -f jarble-api-main/k8s/network-policy.yaml

# cert-manager ClusterIssuer (TLS)
kubectl apply -f jarble-api-main/k8s/cert-manager.yaml
```

### Inviting a Beta User

1. Go to `jarble-dev.us.auth0.com` (Auth0 dashboard, dev tenant)
2. User Management > Users > find or create the user
3. Edit `app_metadata`:
   ```json
   { "beta_approved": true }
   ```
4. For admin access, add `"role": "super_admin"` to the same metadata

---

## 7. Auth0 Configuration

### Tenants

| Tenant | Used For |
|--------|----------|
| `jarble-dev.us.auth0.com` | develop branch (current production) |
| `jarble.us.auth0.com` | main branch (production when promoted) |

The develop branch uses the dev tenant end-to-end: the API K8s secret has `AUTH0_DOMAIN=jarble-dev.us.auth0.com`, and Vercel env vars have `NEXT_PUBLIC_AUTH0_DOMAIN=jarble-dev.us.auth0.com`.

### Application (jarble-dev tenant)

- **Name**: jarble
- **Type**: Single Page Application
- **Client ID**: `1VR30862RmZIFR44UIM8aVHYEt3K2Rsh`
- **Allowed Callback URLs**: includes `https://dev.jarble.ai/api/auth/callback` and Vercel preview URLs
- **Allowed Logout URLs**: `https://dev.jarble.ai`
- **Allowed Web Origins**: `https://dev.jarble.ai`

### Post Login Action

Action name: "Jarble — Sync Email Verification"

This action runs after every login and does two things:
1. Blocks users without `app_metadata.beta_approved = true` (beta gating)
2. Sets a `role` claim on the JWT from `app_metadata.role`

To manage this action: use the Auth0 MCP (`mcp__auth0__auth0_list_actions`, `mcp__auth0__auth0_get_action`, `mcp__auth0__auth0_update_action`) or the Auth0 dashboard.

### RBAC

Roles are stored in `app_metadata.role` on the Auth0 user. Values:
- `user` (default)
- `super_admin` (access to `/admin/*` routes)

The database `users.role` column is the authoritative source. The JWT claim is informational only.

---

## 8. Monitoring

Prometheus monitoring stack runs in the `monitoring` namespace.

| Component | What it monitors |
|-----------|-----------------|
| `prometheus` | Scrapes all targets, stores metrics |
| `node-exporter` | Per-node CPU, memory, disk, network |
| `kube-state-metrics` | Pod states, deployment status, resource requests |
| `grafana` (optional) | Dashboards |

### Check Monitoring Health

```bash
kubectl get pods -n monitoring

# Prometheus logs
kubectl logs -n monitoring -l app=prometheus --tail=20

# Test a query from inside the cluster
kubectl exec -n jarble deployment/jarble-api -- node -e "
fetch('http://prometheus.monitoring.svc.cluster.local:9090/api/v1/query?query=up')
  .then(r => r.json())
  .then(j => console.log(JSON.stringify(j.data.result, null, 2)));
"
```

### Admin Metrics Dashboard

Available at `https://dev.jarble.ai/admin/metrics` for users with `super_admin` role. Polls via tRPC every 30 seconds. Shows node CPU/memory/disk, pod metrics, and alert rules (crash loops, high resource usage).

### Apply/Update Monitoring Stack

```bash
kubectl apply -f jarble-api-main/k8s/monitoring/namespace.yaml
kubectl apply -f jarble-api-main/k8s/monitoring/prometheus.yaml
kubectl apply -f jarble-api-main/k8s/monitoring/node-exporter.yaml
kubectl apply -f jarble-api-main/k8s/monitoring/kube-state-metrics.yaml
kubectl apply -f jarble-api-main/k8s/monitoring/grafana.yaml  # optional
```

---

## 9. Known Issues and TODO

| Issue | Status | Notes |
|-------|--------|-------|
| Stripe not configured | Blocked on STRIPE_SECRET_KEY | Billing UI renders but payment flow is disabled. `is_free=true` set on test deployments to bypass subscription enforcement. |
| Bot system prompt not applied | Bug | The OpenClaw runtime uses its default personality. The custom system prompt configured by users is not being passed through. |
| Subscription enforcement bypassed | Intentional (dev) | `is_free=true` on test deployments. Must be reverted before launch. |
| Auth0Provider SSR hydration warning | Cosmetic | Mismatch between server-rendered and client-rendered Auth0 state. Does not affect functionality. Fix: move Auth0Provider reads into component body (already partially addressed in commit `2118815`). |
| Provisioning screen is full-page | UX bug | Should render as a banner/overlay, not replace the full page during deployment. |
| Vercel production branch | Pending | The `main` branch deployment to `jarble.ai` needs to be set up when ready to promote from develop. |
| npm cache corruption on PVCs | Recurring | Longhorn PVCs occasionally get `ENOTEMPTY` errors during `npx openclaw`. Fix: see "Clear a Corrupted Bot PVC" in Common Operations above. |
| `creating` status stuck | Known | Deployment creation sets status to `creating` but readiness polling sometimes times out. Fix: use debug endpoint to force status. |

---

## 10. Architecture Quick Reference

### Request Flows

**Chat message:**
```
Browser (dev.jarble.ai)
  -> POST /api/tambo-agent (Vercel Next.js route handler)
  -> API: jarble-api-main/src/routes/tamboAgent.ts
  -> chatViaHTTP(pod:18789/v1/chat/completions)
  -> SSE stream: text deltas + UI render blocks + reasoning events
  -> Browser: typewriter reveal + canvas card rendering
```

**Bot deployment:**
```
Frontend (deployment wizard)
  -> tRPC deployment.create (creates DB record)
  -> tRPC deployment.deploy
  -> API: creates PVC + Secret + ConfigMap + K8s Deployment
  -> K8s: schedules pod on a worker node
  -> OpenClaw entrypoint: npm install + start gateway on :18789
  -> API polls for readiness (GET /health on pod)
  -> Status: creating -> running
```

**Auth flow:**
```
Browser -> Auth0 (login)
  -> redirect back with code
  -> Auth0 SDK exchanges code for JWT
  -> JWT stored in session
  -> tRPC calls: Authorization: Bearer <jwt>
  -> API: validates JWT via Auth0 JWKS at /health (Auth0 domain)
  -> Extracts userId (sub claim), role claim
```

**Flow (orchestration) execution:**
```
Frontend -> POST /api/flows/:flowId/execute (gets executionId)
  -> Client reconnects to GET /api/flows/executions/:executionId/stream
  -> FlowEngine executes DAG in topological order
  -> Each node emits jarble.flow.step.* SSE events
  -> Deployment nodes call bots via chatViaHTTP
  -> Results passed via {{stepN_result.field}} template vars
```

### K8s Resource Naming

```
API Deployment:    jarble-api          (namespace: jarble)
API Secret:        jarble-api-secrets  (namespace: jarble)
Bot Pod:           dep-{id}-{rs}-{rand}(namespace: jarble)
Bot Secret:        secret-{id}         (namespace: jarble)
Bot PVC:           pvc-{id}            (namespace: jarble, Longhorn, 20Gi RWO)
Bot ConfigMap:     config-{id}         (namespace: jarble)
GHCR Pull Secret:  ghcr-pull-secret    (namespace: jarble)
```

### Config Paths Inside a Bot Pod

```
/data/config/openclaw.json          Written by configSync (Jarble platform)
/data/.openclaw/openclaw.json       Generated by OpenClaw entrypoint (OpenClaw reads this)
/data/.npm/                         npm cache (can be safely deleted if corrupted)
/data/runtime/node_modules/         OpenClaw npm dependencies
/data/.initialized                  Sentinel file — present after first successful init
```

### Ingress and TLS

API traffic: `api.jarble.ai` -> Cloudflare -> master public IP -> Traefik -> `jarble-api` ClusterIP service -> pods on :3001

TLS cert: Let's Encrypt, issued by cert-manager via `letsencrypt-prod` ClusterIssuer. Stored in secret `jarble-api-tls` in namespace `jarble`. Renews automatically.

### GitHub Actions Workflows

| Workflow | File | Triggers |
|----------|------|---------|
| CI (tests + typecheck) | `ci.yml` | Push/PR to `main` |
| Build API image | `build-api-image.yml` | Push to `main` with API/shared changes, manual |
| Build runtime images | `build-runtime-images.yml` | Manual |
| Terraform | `terraform.yml` | Manual |
| Nightly QA | `nightly-qa.yml` | Scheduled, manual |
| PR checks | `pr-checks.yml` | Pull requests |

For `develop` branch, trigger image builds manually:
```bash
gh workflow run "Build API Image" --ref develop
```

---

## Appendix: Terraform (Infrastructure as Code)

Terraform configs in `infrastructure/terraform/`. Used for initial cluster provisioning, not day-to-day operations.

```bash
cd infrastructure/terraform

# First time only
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with Hetzner token and SSH key

terraform init
terraform plan
terraform apply
```

After `terraform apply`, get the kubeconfig:
```bash
terraform output kubeconfig_command
# Run the printed scp command to fetch kubeconfig
```

Terraform manages: Hetzner servers, network, firewall, block storage volumes, floating IP. It does not manage K8s resources (those are kubectl-applied directly).

State is local (`terraform.tfstate`). Store the state file securely — it contains the K3s cluster token and other sensitive outputs.
