# Pod Security Audit (from OpenClaw report — Feb 2026)

## 🔴 Critical Issues

### 1. Running as root (uid=0)
All containers run as root. Should use a non-root user with minimal permissions.
**Fix**: Add `securityContext` to pod spec:
```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  fsGroup: 1000
```
**Blocker**: PVC directories are owned by root. Need to chown during init or use an initContainer.

### 2. Secrets exposed as environment variables
These secrets are visible via `env` command inside the pod:
- `ANTHROPIC_API_KEY` — LLM provider API key
- `TELEGRAM_BOT_TOKEN` — messaging platform token
- `OPENROUTER_API_KEY` — when using OpenRouter
- `OPENCLAW_GATEWAY_TOKEN` — gateway auth token
- `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` — when configured

**Fix**: Mount secrets as files instead of env vars:
```yaml
volumes:
  - name: secrets
    secret:
      secretName: secret-{deploymentId}
containers:
  - volumeMounts:
      - name: secrets
        mountPath: /run/secrets
        readOnly: true
```
Then read from files: `cat /run/secrets/ANTHROPIC_API_KEY`
**Blocker**: OpenClaw reads from env vars. Would need OpenClaw to support file-based secrets, or use an entrypoint wrapper that loads files into env.

### 3. K8s service account token mounted
The default service account token is mounted at `/var/run/secrets/kubernetes.io/serviceaccount/`.
The pod could attempt K8s API calls (RBAC denied, but token is still present).
**Fix**: Disable auto-mounting:
```yaml
automountServiceAccountToken: false
```

### 4. Full outbound internet access
No NetworkPolicy restricting egress. Pod can reach any external IP.
**Fix**: Add NetworkPolicy allowing only:
- Egress to LLM provider APIs (api.anthropic.com, api.openai.com, openrouter.ai)
- Egress to messaging platforms (api.telegram.org, discord.com, slack.com)
- Egress to DNS (kube-dns)
- Egress to jarble-api service (for config webhooks)

## 🟡 Medium Priority

### 5. Capabilities not minimized
Container has more Linux capabilities than needed.
**Fix**: Drop all and add only required:
```yaml
securityContext:
  capabilities:
    drop: ["ALL"]
    add: ["NET_BIND_SERVICE"]  # only if needed
```

### 6. No resource limits enforced by K8s
While the DB has `cpuLimit` and `memoryMb`, these need to be applied to the pod spec:
```yaml
resources:
  limits:
    cpu: "2"
    memory: "2Gi"
  requests:
    cpu: "500m"
    memory: "512Mi"
```

### 7. PVC permissions too open
`/data/` has mode `drwxrwxrwx` (777). Should be more restrictive.

## 🟢 Good

- No cloud metadata endpoint accessible
- RBAC denies K8s API requests (service account has no roles)
- DNS resolution works correctly
- External connectivity works (needed for LLM APIs and messaging platforms)
- Persistent storage on `/data` via Longhorn PVC

## Priority Order for Fixes
1. `automountServiceAccountToken: false` — easy, no breaking changes
2. Drop capabilities — easy, minimal risk
3. Resource limits in pod spec — straightforward
4. NetworkPolicy for egress — moderate effort
5. Non-root user — requires PVC ownership changes
6. Secrets as files — requires OpenClaw changes or entrypoint wrapper
