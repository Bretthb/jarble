---
name: K8s Infrastructure Setup (Apr 3, 2026)
description: Hetzner K3s cluster setup — Kubero, cert-manager, RBAC, API pod deployment, Neon DB migration, K8s dashboard
type: project
---

## Cluster Architecture (as of Apr 3, 2026)

| Subdomain | Service | Namespace |
|-----------|---------|-----------|
| kubero.jarble.ai | Kubero dashboard | kubero |
| api.jarble.ai | Jarble API (KuberoApp) | jarble-production |
| k8s.jarble.ai | Kubernetes Dashboard v2.7.0 | kubernetes-dashboard |
| dev.jarble.ai | Frontend | Vercel |

**Master node**: 178.156.230.13

## What Was Set Up

1. **cert-manager v1.14.5** — letsencrypt-prod ClusterIssuer (HTTP-01 via Traefik), TLS on kubero.jarble.ai + api.jarble.ai
2. **CoreDNS** — Forward changed to 1.1.1.1 + 8.8.8.8 (cluster DNS couldn't resolve external domains)
3. **RBAC** — ClusterRole `jarble-api` with full pod/deployment/secret/service/configmap/PVC/namespace/node/ingress/replicaset access. Bindings for default SA in `jarble` and `jarble-production` namespaces
4. **Kubero** — Pipeline "jarble" + phase "production" = namespace `jarble-production`. Apps in `jarble` namespace are invisible to Kubero UI
5. **K8s Dashboard** — v2.7.0 with skip-login, Traefik IngressRoute with ServersTransport, cluster-admin binding
6. **Neon DB** — Develop branch (ep-blue-credit-aitceucu-pooler) migrated with deployment_secrets, organizations, org_members, org_invites tables + org_id column on deployments

## API Pod Config
- DB_PROVIDER=postgres (was defaulting to MySQL)
- DATABASE_URL → Neon develop branch
- FRONTEND_URL=https://dev.jarble.ai (CORS)
- NODE_ENV=development (production blocked by missing STRIPE_WEBHOOK_SECRET + AUTH0_M2M_SECRET)
- HETZNER_MAX_MANAGED_SERVERS=17
- AUTOSCALE_ENABLED=false (not yet enabled)

## Kubero Quirks
- Namespace = `{pipeline}-{phase}` (hardcoded)
- `readOnlyRootFilesystem: true` — prevents entrypoint.sh execution, hence inline CMD in Dockerfile
- KUBERO_USERS is double base64 encoded (Kubero decodes once, K8s secret decodes once)
- Pipeline buildpack spec needs `fetch.securityContext` or Kubero crashes

## Bot Pod Visibility
- Auto-scaled bot pods (nodeManager.ts) deploy to `jarble` namespace as raw K8s Deployments — NOT in Kubero
- Bot pods visible in K8s Dashboard (all namespaces)

## Pending
- **Credential rotation needed**: SSH key, Hetzner API token, GitHub PAT, Neon API key, Kubero password (all exposed in session)
- AUTOSCALE_ENABLED → flip to true when ready
- Longhorn had "no ready nodes" errors — recovered after reboot, needs monitoring
- Stripe not configured (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET)
- AUTH0_M2M_SECRET not set
- React #418 hydration error — cosmetic Auth0Provider SSR mismatch

**Why:** This is the first production-like deployment of the Jarble API on the Hetzner K3s cluster. Understanding the namespace layout (jarble vs jarble-production) and Kubero quirks is critical for future deployments and debugging.

**How to apply:** When deploying API changes, push to ghcr.io/jarble-ai/api:latest and let Kubero pick it up in jarble-production namespace. Bot pods go to jarble namespace separately.
