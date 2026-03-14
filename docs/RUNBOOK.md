# Jarble Platform Runbook

Operational reference for deploying, configuring, and maintaining the Jarble platform. Intended for the dev team and Claude Code sessions.

> **Keep this up to date.** After any infra change, env var update, or architectural decision — update the relevant section here AND in `CLAUDE.md` if applicable.

---

## Table of Contents

- [Environment Matrix](#environment-matrix)
- [Deploy & Release](#deploy--release)
- [Common Operations](#common-operations)
- [Decision Log](#decision-log)

---

## Environment Matrix

### Auth0

| Setting | Local Dev | Production |
|---------|-----------|------------|
| Tenant | `jarble-dev.us.auth0.com` | `jarble.us.auth0.com` |
| Client ID | Vercel/`.env.local`: `NEXT_PUBLIC_AUTH0_CLIENT_ID` | Vercel: `NEXT_PUBLIC_AUTH0_CLIENT_ID` |
| API Identifier (audience) | `https://api.jarble.ai` | `https://api.jarble.ai` |
| Where tenant is set (frontend) | `Jarble-mvp/.env.local` → `NEXT_PUBLIC_AUTH0_DOMAIN` | Vercel env var → `NEXT_PUBLIC_AUTH0_DOMAIN` |
| Where tenant is set (API) | `jarble-api-main/.env` → `AUTH0_DOMAIN` | K8s secret `jarble-api-secrets` → `AUTH0_DOMAIN` |
| Post Login Action | Not required for dev | `Beta Gate + Role Claim` — blocks unapproved users, sets role claim |

### Stripe

| Setting | Local Dev | Production |
|---------|-----------|------------|
| Mode | Test (`sk_test_*`) | Test (`sk_test_*`) — switch to Live when ready |
| Secret key location | `jarble-api-main/.env` → `STRIPE_SECRET_KEY` | K8s secret `jarble-api-secrets` → `STRIPE_SECRET_KEY` |
| Publishable key location | `Jarble-mvp/.env.local` → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Vercel env var → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` |
| Webhook secret location | `jarble-api-main/.env` → `STRIPE_WEBHOOK_SECRET` | K8s secret `jarble-api-secrets` → `STRIPE_WEBHOOK_SECRET` |
| Webhook endpoint | `localhost:3001/api/stripe/webhook` (use Stripe CLI) | `https://api.jarble.ai/api/stripe/webhook` |

**Important**: Test and Live mode use separate customer IDs. When switching modes, clear `stripe_customer_id` on all users in the DB.

### Database

| Setting | Local Dev | Production |
|---------|-----------|------------|
| Provider | SQLite (file: `jarble-api-main/local.db`) | PostgreSQL (Neon, serverless pooler) |
| Connection | `USE_SQLITE=true` in env | K8s secret `jarble-api-secrets` → `DATABASE_URL` |
| Migrations | Auto via `db/init.ts` on startup | Manual: `drizzle-pg/` SQL files run via `kubectl exec` |
| Studio | `npm run db:studio` | Not available in prod — use `kubectl exec` + raw SQL |

### API Secrets (K8s)

All API env vars in production live in K8s secret `jarble-api-secrets` in namespace `jarble`.

| Key | Purpose | How to update |
|-----|---------|---------------|
| `AUTH0_DOMAIN` | Auth0 tenant for JWT verification (currently `jarble.us.auth0.com`) | `kubectl patch secret jarble-api-secrets -n jarble -p '{"stringData":{"AUTH0_DOMAIN":"<value>"}}'` |
| `AUTH0_AUDIENCE` | Expected JWT audience | Same patch pattern |
| `DATABASE_URL` | Neon PostgreSQL connection string | Same patch pattern |
| `STRIPE_SECRET_KEY` | Stripe API key | Same patch pattern |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification | Same patch pattern |
| `API_KEY_ENCRYPTION_KEY` | AES-256-GCM key for platform credentials | Same patch pattern |
| `FRONTEND_URL` | CORS origin (`https://jarble.ai`) | Same patch pattern |
| `PROMETHEUS_URL` | Prometheus server URL (default: `http://prometheus.monitoring.svc.cluster.local:9090`) | Same patch pattern. Only needed if Prometheus runs outside `monitoring` namespace |
| `RESEND_API_KEY` | Resend API key for beta welcome emails (optional — skips gracefully if not set) | Same patch pattern |

After patching any secret, restart the API: `kubectl rollout restart deployment/jarble-api -n jarble`

### Frontend Env Vars (Vercel)

All `NEXT_PUBLIC_*` vars are **baked at build time**. Changing them in Vercel requires a redeploy.

| Key | Purpose |
|-----|---------|
| `NEXT_PUBLIC_API_URL` | API base URL (`https://api.jarble.ai`) |
| `NEXT_PUBLIC_AUTH0_DOMAIN` | Auth0 tenant domain |
| `NEXT_PUBLIC_AUTH0_CLIENT_ID` | Auth0 SPA client ID |
| `NEXT_PUBLIC_AUTH0_AUDIENCE` | Auth0 API identifier |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |
| `ENABLE_EXPERIMENTAL_COREPACK` | Must be `1` (pnpm support) |

### Manual Configurations (not in code)

These are configured via dashboards, not code. Track changes in the [Decision Log](#decision-log).

| System | What's Configured | Where to Change |
|--------|-------------------|-----------------|
| Auth0 (prod) | Application settings, callback URLs, Post Login Actions, user `app_metadata` | `jarble.us.auth0.com` dashboard |
| Auth0 (dev) | Same as above for local dev | `jarble-dev.us.auth0.com` dashboard |
| Stripe | Webhook endpoints, products, prices | Stripe Dashboard |
| Cloudflare | DNS records (`api.jarble.ai` → master IP) | Cloudflare Dashboard |
| Vercel | Env vars, domain (`jarble.ai`), build settings | Vercel Dashboard |
| GHCR | Container registry, pull secret PAT | GitHub Settings → Packages |

---

## Deploy & Release

### Shipping API Changes

```
Code change → Push to main → GitHub Actions builds image → Manual pod restart
```

1. **Push code** to `main` branch
2. **Wait for CI** — `build-api-image.yml` builds and pushes `ghcr.io/jarble-ai/api:latest`
   - Only triggers when `jarble-api-main/` or `shared/` files change
   - Check status: `gh run list --workflow=build-api-image.yml --limit=3`
3. **Restart pods** (manual — no CD yet):
   ```bash
   export KUBECONFIG="C:\Users\tanne\kubeconfig.yaml"
   kubectl rollout restart deployment/jarble-api -n jarble
   ```
4. **Verify**:
   ```bash
   kubectl get pods -n jarble -l app=jarble-api
   # Wait for new pods to be Running, old ones Terminating
   curl https://api.jarble.ai/health
   ```

### Shipping Frontend Changes

```
Code change → Push to main → Vercel auto-deploys
```

1. **Push code** to `main` branch (changes in `Jarble-mvp/`)
2. Vercel auto-detects and deploys — no manual step needed
3. If only env vars changed (no code): trigger a redeploy via empty commit:
   ```bash
   git commit --allow-empty -m "chore: trigger Vercel redeploy" && git push
   ```

### Running Database Migrations (Production)

Migrations are SQL files in `jarble-api-main/drizzle-pg/`. Run them manually:

```bash
export KUBECONFIG="C:\Users\tanne\kubeconfig.yaml"

# Get a pod name
kubectl get pods -n jarble -l app=jarble-api -o name | head -1

# Run the migration SQL
kubectl exec -n jarble <pod-name> -- node -e '
const pg = require("pg");
const c = new pg.Client(process.env.DATABASE_URL);
c.connect()
  .then(() => c.query(`YOUR SQL HERE`))
  .then(r => { console.log(JSON.stringify(r, null, 2)); return c.end(); })
  .catch(e => { console.error(e); process.exit(1); });
'
```

### Updating K8s Secrets

```bash
export KUBECONFIG="C:\Users\tanne\kubeconfig.yaml"

# Patch a single value
kubectl patch secret jarble-api-secrets -n jarble \
  -p '{"stringData":{"KEY_NAME":"new-value"}}'

# Restart API to pick up new values
kubectl rollout restart deployment/jarble-api -n jarble
```

### Inviting a Beta User

1. Go to `jarble.us.auth0.com` → User Management → Users
2. Find or create the user
3. Set `app_metadata`:
   ```json
   { "beta_approved": true }
   ```
4. For admin access, add `"role": "super_admin"` to the same metadata

---

## Common Operations

### Check API Health
```bash
export KUBECONFIG="C:\Users\tanne\kubeconfig.yaml"
curl https://api.jarble.ai/health
kubectl get pods -n jarble -l app=jarble-api
kubectl logs -n jarble -l app=jarble-api --tail=50
```

### Check a Bot Deployment Pod
```bash
kubectl get pods -n jarble -l app=dep-<deploymentId>
kubectl logs -n jarble -l app=dep-<deploymentId> --tail=50
```

### Query Production Database
```bash
kubectl exec -n jarble <api-pod> -- node -e '
const pg = require("pg");
const c = new pg.Client(process.env.DATABASE_URL);
c.connect()
  .then(() => c.query("SELECT id, email, role FROM users"))
  .then(r => { console.log(JSON.stringify(r.rows, null, 2)); return c.end(); });
'
```

### Force Reset a Stuck Deployment
```sql
UPDATE deployments SET status = 'pending' WHERE id = '<deploymentId>';
```

### Deploy/Update Monitoring Stack
```bash
export KUBECONFIG="C:\Users\tanne\kubeconfig.yaml"

# Apply all monitoring manifests
kubectl apply -f jarble-api-main/k8s/monitoring/namespace.yaml
kubectl apply -f jarble-api-main/k8s/monitoring/prometheus.yaml
kubectl apply -f jarble-api-main/k8s/monitoring/node-exporter.yaml
kubectl apply -f jarble-api-main/k8s/monitoring/kube-state-metrics.yaml
kubectl apply -f jarble-api-main/k8s/monitoring/grafana.yaml  # optional

# Verify
kubectl get pods -n monitoring
kubectl get svc -n monitoring
```

### Check Prometheus Health
```bash
export KUBECONFIG="C:\Users\tanne\kubeconfig.yaml"
kubectl get pods -n monitoring -l app=prometheus
kubectl logs -n monitoring -l app=prometheus --tail=20

# Test query from API pod
kubectl exec -n jarble deployment/jarble-api -- node -e "
fetch('http://prometheus.monitoring.svc.cluster.local:9090/api/v1/query?query=up')
  .then(r => r.json()).then(j => console.log(JSON.stringify(j.data.result, null, 2)));
"
```

---

## Decision Log

Track key architectural and operational decisions. Newest first.

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-11 | Switched Auth0 prod tenant from `jarble-dev.us.auth0.com` to `jarble.us.auth0.com` | Separate dev and prod tenants for isolation. `jarble-dev` remains for local dev. |
| 2026-03-11 | Added beta gating via Auth0 Post Login Action | Block public signups — only users with `app_metadata.beta_approved` can access the platform. |
| 2026-03-11 | Implemented RBAC with `super_admin` / `user` roles | Need platform admin capabilities. DB is authoritative for roles, JWT claim is informational. |
| 2026-03-13 | Added Prometheus monitoring stack + admin metrics dashboard | Cluster observability: node CPU/memory/disk, pod metrics, alert rules (crash loops, high resource usage). Prometheus v2.48.0 + node-exporter + kube-state-metrics in `monitoring` namespace. Frontend at `/admin/metrics` polls via tRPC every 30s. |
| 2026-03-11 | Built admin dashboard at `/admin` (8 pages) | Platform visibility: manage users, deployments, billing, audit logs from one place. |
| 2026-03-11 | Added audit logging on all admin mutations | Compliance and accountability. Logs to `audit_logs` table with userId, action, IP, metadata. |
| 2026-03-11 | Security review: explicit column selects in admin queries | Prevent leaking `llmApiKey`, `auth0Id`, `stripeCustomerId` through admin endpoints. |
| 2026-03-04 | Deployed to Hetzner K3s (3 nodes) with Longhorn storage | Self-hosted for cost control. Longhorn for persistent volumes. |
| 2026-03-04 | Chose Neon PostgreSQL for production DB | Serverless, auto-scaling, branching for dev. SQLite for local dev simplicity. |
| 2026-03-04 | Stripe in TEST mode for initial deployment | Validate full flow before switching to live payments. |

---

## Keeping Docs in Sync

When you make changes that affect operations, update **all** of these:

1. **This file** (`docs/RUNBOOK.md`) — env vars, deploy steps, decisions
2. **`CLAUDE.md`** — architecture, file references, patterns
3. **Memory files** (`~/.claude/projects/.../memory/`) — current state, gotchas

A good rule: if you'd need to tell someone (or Claude) about the change in the next session, write it down now.
