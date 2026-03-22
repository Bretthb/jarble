# Deployment & Infrastructure

## Architecture

```
Hetzner Cloud (Terraform-managed)
└── K3s Cluster
    └── Namespace: jarble
        ├── Per-deployment resources:
        │   ├── Deployment:  dep-{id}       (1 replica, container: runtime)
        │   ├── Secret:      secret-{id}    (LLM keys, platform tokens)
        │   ├── PVC:         pvc-{id}       (Longhorn 20Gi, mounted /data)
        │   └── Service:     ClusterIP      (port 18789)
        └── Shared:
            ├── Jarble API (Express + tRPC)
            ├── NetworkPolicy (egress restrictions)
            └── Longhorn storage controller
```

## Container Image

`ghcr.io/jarble-ai/openclaw:latest` — Node.js 22 + OpenClaw runtime.

Pod runs as non-root (uid=1000), all capabilities dropped, no service account token.

## ConfigSync Pipeline

Triggered by credential save/delete or service install/uninstall:

```
DB state
  → buildDeploymentFields()    # Load creds, skills, service snippets
  → renderConfigs()            # Write soul.md, openclaw.json, skills/*.json
  → getSecretEntries()         # Build K8s secret entries
  → writeConfigsToPvc()        # kubectl exec: write files to /data/config/
  → updateDeploymentSecret()   # Replace K8s Secret
  → restartDeployment()        # Scale 0 → 1
  → poll readiness             # 30 × 2s = 60s max
  → update DB status           # "running" or "failed"
```

## Terraform

Infrastructure defined in `infrastructure/`:
- Hetzner Cloud servers
- K3s cluster config
- Auth0 tenant config
- Longhorn storage

```bash
cd infrastructure
terraform plan
terraform apply
```

## Known Issues

- **npm cache corruption**: `ENOTEMPTY` on PVC → clear `/data/.npm`, delete pod
- **Status stuck "creating"**: Polling timeout during slow npm install
- **Telegram 409 conflict**: Two pods with same bot token → scale down stale deployments
