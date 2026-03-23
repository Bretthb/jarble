# Jarble Production Launch Plan

> **Goal**: Get Jarble running in production so clients can deploy AI bots and chat with them.
> **Estimated time**: 2-3 hours of active work (excluding DNS propagation)
> **Monthly cost**: ~$36/mo (Hetzner) + free tiers (Neon DB, Vercel, Auth0)

---

## Agent Team

This plan is executed by 3 specialized AI agents that coordinate via the task system:

| Agent | Role | Owns |
|-------|------|------|
| **production-pm** | Project Manager | Coordination, task tracking, user escalation |
| **infra-ops** | Infrastructure | Terraform, K3s, DNS, TLS, networking |
| **backend-deployer** | Backend | API deployment, database, secrets, Docker |

### Launching the Team

When ready to execute, tell Claude: **"Launch the production team"** — this will:
1. Create a team with all 3 agents
2. Create tasks for each phase
3. Agents work in parallel where possible
4. PM coordinates handoffs and reports progress

---

## Phase 0: Cluster Ready (Infra-Ops)

**Status**: In Progress — Terraform partially applied, SSH key conflict

### Tasks
1. **USER ACTION**: Delete manual SSH key from Hetzner Console → Security → SSH Keys
2. Re-run Terraform: GitHub Actions → Terraform → Run workflow → `apply`
3. Wait for apply to succeed (creates 3 servers + installs K3s)
4. Get kubeconfig:
   ```bash
   scp root@<MASTER_IP>:/etc/rancher/k3s/k3s.yaml ./kubeconfig.yaml
   sed -i 's/127.0.0.1/<MASTER_IP>/g' ./kubeconfig.yaml
   export KUBECONFIG=./kubeconfig.yaml
   ```
5. Verify: `kubectl get nodes` → 3 nodes in Ready state
6. Record the **static IP** from Terraform output (needed for DNS)

### Outputs
- `kubeconfig.yaml` — cluster access
- Static IP — for DNS records

---

## Phase 1: DNS Configuration (Infra-Ops)

**Depends on**: Phase 0 (static IP)

### Decision: Where is jarble.ai managed?
> **NEEDS USER INPUT** — Cloudflare, Namecheap, GoDaddy, Hetzner DNS, etc.

### DNS Records

| Record | Type | Value | Purpose |
|--------|------|-------|---------|
| `api.jarble.ai` | A | `<static_ip>` | API backend (Traefik → K8s Ingress) |
| `jarble.ai` | CNAME | `cname.vercel-dns.com` | Frontend (if Vercel) |
| `www.jarble.ai` | CNAME | `cname.vercel-dns.com` | Frontend redirect |

If self-hosting frontend on K8s instead of Vercel:
| `jarble.ai` | A | `<static_ip>` | Frontend on cluster |

### Verification
- `dig api.jarble.ai` → resolves to static IP
- `curl http://api.jarble.ai` → Traefik responds (even without TLS yet)

---

## Phase 2: Database (Backend-Deployer)

**Depends on**: Nothing (can start immediately, in parallel with Phase 0)

### Decision: Database provider?

| Option | Pros | Cons | Cost |
|--------|------|------|------|
| **Neon** (recommended) | Instant setup, serverless, auto-scaling | 0.5GB free tier limit | Free → $19/mo |
| Supabase | Free tier, dashboard | Slightly more complex | Free → $25/mo |
| Self-hosted (K8s pod) | Full control, no limits | Ops burden, backup responsibility | $0 (uses cluster) |
| Aiven | Hetzner partnership, managed | Paid only | ~$15/mo |

### Steps (using Neon)
1. Sign up at [neon.tech](https://neon.tech)
2. Create project: region **US East** (matches Hetzner `ash` datacenter)
3. Copy connection string: `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`
4. Test from cluster (after Phase 0): `kubectl run pg-test --rm -it --image=postgres:16-alpine -- psql "<connection_string>"`

### Output
- `DATABASE_URL` — connection string for K8s secrets

---

## Phase 3: API Deployment (Backend-Deployer)

**Depends on**: Phase 0 (cluster), Phase 1 (DNS for TLS), Phase 2 (database URL)

### 3a. Cert-Manager ClusterIssuer
```bash
kubectl apply -f jarble-api-main/k8s/cert-manager.yaml
kubectl get clusterissuer   # letsencrypt-prod should be Ready
```

### 3b. GHCR Image Pull Secret

> **NEEDS USER INPUT**: Is the GitHub repo/container registry public or private?

If private:
```bash
kubectl create secret docker-registry ghcr-pull-secret \
  --namespace jarble \
  --docker-server=ghcr.io \
  --docker-username=<github-username> \
  --docker-password=<github-pat-with-read:packages>
```
Then uncomment `imagePullSecrets` in `k8s/deployment.yaml`.

### 3c. Create K8s Secrets
```bash
cd jarble-api-main/k8s
cp secrets.yaml.example secrets.yaml
# Edit secrets.yaml with real values:
```

**Minimum required values:**
| Key | Value | Where to get |
|-----|-------|-------------|
| `PORT` | `3001` | Static |
| `NODE_ENV` | `production` | Static |
| `FRONTEND_URL` | `https://jarble.ai` | Static |
| `DB_PROVIDER` | `postgres` | Static |
| `DATABASE_URL` | `postgresql://...` | Phase 2 output |
| `AUTH0_DOMAIN` | `xxx.auth0.com` | Auth0 dashboard |
| `AUTH0_AUDIENCE` | `https://api.jarble.ai` | Auth0 dashboard |
| `API_KEY_ENCRYPTION_KEY` | 64-char hex | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

**Optional (skip for initial testing):**
| Key | Purpose |
|-----|---------|
| `OPENROUTER_API_KEY` | Included LLM credits (users can BYOK without this) |
| `OPENROUTER_MANAGEMENT_KEY` | Provision per-tenant OpenRouter keys |
| `STRIPE_SECRET_KEY` | Payment processing |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification |
| `AUTH0_MGMT_CLIENT_ID` | Resend verification emails |
| `AUTH0_MGMT_CLIENT_SECRET` | Resend verification emails |

```bash
kubectl apply -f secrets.yaml
```

### 3d. Deploy API
```bash
kubectl apply -f jarble-api-main/k8s/deployment.yaml
kubectl apply -f jarble-api-main/k8s/network-policy.yaml
```

### 3e. Verify
```bash
kubectl get pods -n jarble                     # 2 pods Running
kubectl logs -n jarble -l app=jarble-api       # "migrations complete", "listening on 3001"
kubectl get ingress -n jarble                  # api.jarble.ai with TLS
kubectl get certificate -n jarble              # jarble-api-tls should be Ready
curl https://api.jarble.ai/health              # 200 OK
```

---

## Phase 4: Frontend Deployment

**Depends on**: Phase 3 (API must be reachable)

### Decision: Vercel or self-hosted?

| Option | Pros | Cons |
|--------|------|------|
| **Vercel** (recommended) | Zero-config for Next.js, free tier, automatic HTTPS, global CDN | External dependency |
| K8s (self-hosted) | Single infrastructure | Need Dockerfile, more K8s manifests, no CDN |

### Steps (Vercel — recommended)
1. Go to [vercel.com](https://vercel.com), sign in with GitHub
2. Click **Add New Project** → Import the `jarble` (or `Jarble-AI/jarble`) repo
3. Set **Root Directory** to `Jarble-mvp`
4. Set **Framework Preset** to Next.js
5. Add environment variables:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | `https://api.jarble.ai` |
| `NEXT_PUBLIC_AUTH0_DOMAIN` | `xxx.auth0.com` |
| `NEXT_PUBLIC_AUTH0_CLIENT_ID` | `<from Auth0 dashboard>` |
| `NEXT_PUBLIC_AUTH0_AUDIENCE` | `https://api.jarble.ai` |

6. Deploy
7. Go to **Project Settings → Domains** → Add `jarble.ai`
8. Vercel will give you DNS instructions (usually a CNAME to `cname.vercel-dns.com`)

### Verify
- `https://jarble.ai` loads the landing page
- Login button redirects to Auth0

---

## Phase 5: Auth0 Production Config

**Depends on**: Phase 4 (production URLs known)

### Decision: Production Auth0 tenant or reuse dev?
> **NEEDS USER INPUT** — Do you have a separate production Auth0 tenant?

### Update Auth0 Application Settings

In Auth0 Dashboard → Applications → Your App:

| Setting | Value |
|---------|-------|
| Allowed Callback URLs | `https://jarble.ai/dashboard` |
| Allowed Logout URLs | `https://jarble.ai` |
| Allowed Web Origins | `https://jarble.ai` |

> Keep existing localhost entries for local dev: `http://localhost:3000/dashboard`, etc.

### Auth0 API Settings
- Ensure API with identifier `https://api.jarble.ai` exists
- Check token expiration settings

### Post-Login Action
Verify the post-login action in `infrastructure/auth0/post-login-add-claims.js` is deployed.

---

## Phase 6: Smoke Test (Production-PM)

**Depends on**: All previous phases

### Test Checklist

| # | Test | Expected Result |
|---|------|----------------|
| 1 | Visit `https://jarble.ai` | Landing page loads |
| 2 | Click Sign Up | Auth0 login page appears |
| 3 | Create account | Redirected to dashboard |
| 4 | Check email verification | Verification email received |
| 5 | Click "New Deployment" | Onboarding wizard starts |
| 6 | Select OpenClaw runtime | Runtime selection works |
| 7 | Enter BYOK API key | Key validation passes |
| 8 | Complete wizard | Deployment created, pod starts |
| 9 | Wait for "running" status | SSE status stream shows running |
| 10 | Visit `/d/[id]` | Chat interface loads |
| 11 | Send a message | Bot responds |
| 12 | Check canvas components | UI blocks render correctly |

### If something fails
- **Pod not starting**: `kubectl describe pod -n jarble dep-<id>` + `kubectl logs`
- **API 502**: Check API pods are running, check Ingress, check TLS cert
- **Auth0 error**: Check callback URLs match exactly
- **DB error**: Check DATABASE_URL, check Neon dashboard for connections

---

## Post-Launch (Future)

These are NOT required for initial testing but should be added for production clients:

| Item | Priority | Notes |
|------|----------|-------|
| Stripe integration | High | Add keys to K8s secrets when ready |
| Monitoring (Grafana/Prometheus) | Medium | Manifests in `k8s/monitoring/` |
| Sentry error tracking | Medium | Add `NEXT_PUBLIC_SENTRY_DSN` to Vercel |
| PostHog analytics | Low | Add `NEXT_PUBLIC_POSTHOG_KEY` to Vercel |
| Backup (Longhorn snapshots) | Medium | Configure via Longhorn dashboard |
| Auto-scaling | Low | HPA for API pods |
| Rate limiting | Medium | Traefik middleware |
| Status page | Low | External uptime monitoring |

---

## Architecture Diagram

```
                    ┌──────────────┐
                    │  jarble.ai   │
                    │  (Vercel)    │
                    └──────┬───────┘
                           │ HTTPS
                           ▼
┌──────────────────────────────────────────────────┐
│              Hetzner Cloud (Terraform)            │
│                                                   │
│  ┌─────────────── api.jarble.ai ──────────────┐  │
│  │                                             │  │
│  │    Static IP → Traefik (Master Node)        │  │
│  │         │                                   │  │
│  │         ▼                                   │  │
│  │    ┌──────────┐     ┌──────────────────┐    │  │
│  │    │ Ingress  │────▶│ jarble-api (x2)  │    │  │
│  │    │ (TLS)    │     │ Port 3001        │    │  │
│  │    └──────────┘     └────────┬─────────┘    │  │
│  │                              │              │  │
│  │                    ┌─────────▼──────────┐   │  │
│  │                    │ Creates K8s        │   │  │
│  │                    │ resources for bots │   │  │
│  │                    └─────────┬──────────┘   │  │
│  │                              │              │  │
│  │              ┌───────────────┼──────────┐   │  │
│  │              ▼               ▼          │   │  │
│  │    ┌──────────────┐ ┌──────────────┐    │   │  │
│  │    │ Bot Pod      │ │ Bot Pod      │    │   │  │
│  │    │ (Worker 1)   │ │ (Worker 2)   │    │   │  │
│  │    │ + 20Gi PVC   │ │ + 20Gi PVC   │    │   │  │
│  │    └──────────────┘ └──────────────┘    │   │  │
│  │                                         │   │  │
│  └─────────────────────────────────────────┘   │  │
│                                                │  │
│  ┌──────────────────────────────────────────┐  │  │
│  │ Longhorn (100GB volumes per worker)      │  │  │
│  └──────────────────────────────────────────┘  │  │
└──────────────────────────────────────────────────┘
                           │
                           ▼
                 ┌──────────────────┐
                 │  Neon PostgreSQL  │
                 │  (External DB)   │
                 └──────────────────┘
```

---

## Decisions (Confirmed)

| Question | Answer |
|----------|--------|
| DNS provider | **Cloudflare** |
| GHCR access | **Private** — need image pull secret |
| Auth0 tenant | **Reuse dev tenant** — add production URLs |
| Database | **Neon** (free tier PostgreSQL) |
| Frontend | **Vercel** |
| Stripe | **Include from day 1** |
