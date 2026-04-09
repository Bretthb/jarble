# `jarble` Namespace Security Hardening — PSS + NetworkPolicy

**Date:** 2026-04-07
**Status:** APPLIED — PSS warn+audit labels live, NetworkPolicies live, t1 verified healthy
**Related:** Bot Teams rescue Phase 5 (commit `bc8735b`), Wave 2 Team 2 (Hetzner egress firewall)
**Owner:** Infrastructure / Platform Security

---

## Problem

After Phase 5 of the Bot Teams rescue, every bot pod runs on its own dedicated
Hetzner VPS via hard scheduling affinity. That walls off **cross-tenant compute**
at the hypervisor boundary. Wave 2 Team 2 then closed the **VPS-level egress**
hole by attaching `hcloud_firewall.agent_egress` to every agent worker.

What was still missing inside Kubernetes:

1. **No Pod Security Standards** on the `jarble` namespace. Any pod manifest
   could request `privileged: true`, mount `hostPath: /`, run as root with all
   Linux capabilities, and so on. There was no admission-time guardrail.
2. **No NetworkPolicy** in the `jarble` namespace. Inside the cluster, a
   compromised bot pod could:
   - Scan and connect to other tenant bots' pod IPs
   - Probe the kubelet on other nodes (`:10250`)
   - Reach the K3s API server (`:6443`) and any in-cluster services
   - Reach the Hetzner Cloud metadata service at `169.254.169.254` and read
     the cloud-init payload (which embeds `K3S_JOIN_TOKEN`) — an SSRF leak
     that the Hetzner-level firewall does **not** see, because the metadata
     service is served from the host hypervisor itself (link-local 169.254/16
     bypasses the cloud firewall).

This document records what was applied in this wave and what is still pending
before we can flip Pod Security Standards from `warn`/`audit` to `enforce`.

---

## Phase A — Current state (before this change)

| Item | Value |
|------|-------|
| Namespace labels | `kubernetes.io/metadata.name=jarble` (no PSS labels) |
| NetworkPolicies in `jarble` | None |
| NetworkPolicies cluster-wide | None |
| CNI | K3s default — Flannel for the data plane |
| NetworkPolicy enforcer | **kube-router** bundled with K3s (verified — `KUBE-NWPLCY` chains live in iptables, 580 rules present) |
| Cluster topology | Single control-plane node (`jarble-master`, `10.0.1.10`), pod CIDR `10.42/16`, service CIDR `10.43/16` |
| t1 pod | `dep-nljs8499aj7o-bb69bc6cf-qtwh5`, 1/1 Running, 5h uptime |
| t1 security context | `runAsNonRoot: false`, `runAsUser: 0`, `runAsGroup: 0`, `fsGroup: 1000`, `allowPrivilegeEscalation: false` |

t1 was created via `buildSecurityContext("standard")` in
`jarble-api-main/src/k8s/lifecycle.ts:24-40`. Because it runs as **uid 0** with
no seccomp profile and no capability drops, it would be **rejected** by the
PSS `restricted` profile if `enforce` were turned on. That is why this wave
only applies `warn` + `audit`.

### Critical CNI fact

K3s ships with the kube-router netpol controller enabled by default (it's only
disabled when you pass `--disable-network-policy` or use `--flannel-backend=none`).
Verified on the live cluster:

```
$ iptables-save | grep -c KUBE-NWPLCY
580
$ iptables -L -n | grep KUBE-ROUTER
KUBE-ROUTER-INPUT  all  --  ...
KUBE-ROUTER-FORWARD  all  --  ...
KUBE-ROUTER-OUTPUT  all  --  ...
```

NetworkPolicy objects in the `jarble` namespace **will be enforced**. There
is no need to install Calico or Cilium on top of Flannel.

---

## Phase B — PSS warn+audit applied

```bash
kubectl label ns jarble pod-security.kubernetes.io/warn=restricted --overwrite
kubectl label ns jarble pod-security.kubernetes.io/warn-version=latest --overwrite
kubectl label ns jarble pod-security.kubernetes.io/audit=restricted --overwrite
kubectl label ns jarble pod-security.kubernetes.io/audit-version=latest --overwrite
```

**Effect:**
- New pod creations that violate `restricted` log warnings to the API client
  AND emit audit annotations on the pod object
- Existing pods (including t1) keep running unchanged
- Nothing is blocked — `enforce` is intentionally NOT set

**Verification — running a deliberately non-compliant pod fires the warning:**

```
$ kubectl -n jarble run pss-test --image=busybox --restart=Never --command -- sh -c 'echo hi'
Warning: would violate PodSecurity "restricted:latest":
  allowPrivilegeEscalation != false (container "pss-test" must set
    securityContext.allowPrivilegeEscalation=false),
  unrestricted capabilities (container "pss-test" must set
    securityContext.capabilities.drop=["ALL"]),
  runAsNonRoot != true (pod or container "pss-test" must set
    securityContext.runAsNonRoot=true),
  seccompProfile (pod or container "pss-test" must set
    securityContext.seccompProfile.type to "RuntimeDefault" or "Localhost")
pod/pss-test created
```

t1 verified still 1/1 Running after labels were applied.

---

## Phase C — NetworkPolicy default-deny applied

Two policies were applied from `infrastructure/k8s/networkpolicy.yaml`:

### `jarble-default-deny-egress`

Default-deny egress, with **explicit allowlist**:

| Rule | Destination | Ports |
|------|-------------|-------|
| DNS | any namespace (CoreDNS in `kube-system`) | UDP/TCP 53 |
| Public HTTPS | `0.0.0.0/0` **except** 169.254/16, 10/8, 172.16/12, 192.168/16 | TCP 443 |
| Public HTTP | `0.0.0.0/0` **except** 169.254/16, 10/8, 172.16/12, 192.168/16 | TCP 80 |
| K3s API + kubelet + Flannel VXLAN | `10.0.0.0/16` (private node network) | TCP 6443, TCP 10250, UDP 8472 |

Critical detail: the `except` clause on the HTTP/HTTPS rules is **load-bearing**.
The first iteration of this policy used a naive `ports: [80]` rule with no
destination filter, and live testing showed Hetzner metadata at
`http://169.254.169.254/` returning HTTP 200 from inside t1 — the allow-all-80
rule reopened the SSRF vector. The fix is to set
`ipBlock.cidr: 0.0.0.0/0` with `except` covering link-local + RFC1918.

This also has a useful side effect: bots cannot reach **any** in-cluster
HTTP/HTTPS service unless it's on the K3s API port range. That's defense in
depth against bot-to-internal-service pivoting.

### `jarble-default-deny-ingress`

Default-deny ingress, with one allow rule:

| From | Port |
|------|------|
| Pods in namespace `jarble-production` (the API) | TCP 18789 (OpenClaw WS gateway) |

Bot-to-bot ingress is blocked entirely. A compromised bot cannot scan or
connect to any other bot's pod IP.

### Verification from inside t1 (after policies applied)

```
$ kubectl -n jarble exec dep-nljs8499aj7o-bb69bc6cf-qtwh5 -- sh -c \
    'curl -s -o /dev/null -w "%{http_code}\n" --max-time 10 https://api.anthropic.com/'
404                              # HTTPS reachable, 404 from GET / is normal

$ kubectl -n jarble exec dep-nljs8499aj7o-bb69bc6cf-qtwh5 -- sh -c \
    'curl -s -o /dev/null -w "%{http_code}\n" --max-time 5 http://169.254.169.254/'
000  (exit 7)                    # Hetzner metadata BLOCKED

$ kubectl -n jarble exec dep-nljs8499aj7o-bb69bc6cf-qtwh5 -- sh -c \
    'curl -s -o /dev/null -w "%{http_code}\n" --max-time 5 http://1.1.1.1:8080/'
000  (exit 7)                    # Arbitrary port BLOCKED (proves netpol enforcing)

$ kubectl -n jarble exec dep-nljs8499aj7o-bb69bc6cf-qtwh5 -- sh -c \
    'getent hosts api.anthropic.com'
2607:6bc0::10   api.anthropic.com    # DNS works
```

t1 verified still 1/1 Running, 0 restarts, after policies were applied.

---

## Path to PSS `enforce`

The `enforce` label is intentionally **not** set. Before it can land safely:

### 1. `lifecycle.ts:buildSecurityContext("standard")` must change

Today (`jarble-api-main/src/k8s/lifecycle.ts:24-40`), the "standard" profile
returns a pod-spec security context with:

```ts
runAsNonRoot: false
runAsUser: 0
runAsGroup: 0
allowPrivilegeEscalation: false
```

To pass PSS `restricted`, every bot pod will need:

```ts
runAsNonRoot: true
runAsUser: 1000
runAsGroup: 1000
allowPrivilegeEscalation: false
seccompProfile: { type: "RuntimeDefault" }
capabilities: { drop: ["ALL"] }
```

### 2. The OpenClaw runtime image must work as uid 1000

The current OpenClaw image (`runtimes/openclaw/Dockerfile`) writes to `/data`,
runs `npm install` against `/data/runtime/node_modules`, and so on. These
operations assume root-owned filesystem permissions.

The init container `config-init` already runs `chown` against `/data`, so the
ownership setup is feasible — the work is:

1. Audit `runtimes/openclaw/Dockerfile` for any hardcoded uid/gid expectations
2. Add `USER 1000:1000` (or equivalent) to the runtime stage
3. Have the init container `chown -R 1000:1000 /data` so the main container
   can write to its PVC
4. Test on a single bot end-to-end (cold-start, npm install, chat round-trip,
   storage usage, log streaming) before flipping the flag for all tenants

### 3. Flip PSS to enforce

Once the OpenClaw image is verified non-root-safe:

```bash
kubectl label ns jarble pod-security.kubernetes.io/enforce=restricted --overwrite
kubectl label ns jarble pod-security.kubernetes.io/enforce-version=latest --overwrite
```

Target wave: **Wave 4** (after the runtime hardening ticket lands).

### 4. Monitoring during the warn-mode window

While we are in warn+audit mode, every PSS violation generates:

- A `Warning:` line in the kubectl response when the pod is created
- An audit annotation on the pod object: `pod-security.kubernetes.io/audit-violations`

Recommended alerting:

- Sentry breadcrumb in the deployment-creation path that captures the
  warning text from the K8s API response and tags it `pss.violation`
- Cron job that runs `kubectl -n jarble get pods -o jsonpath='{.items[*].metadata.annotations.pod-security\.kubernetes\.io/audit-violations}'` and pages if any are non-empty
- Track the count over time so we know when the runtime image fix has
  brought it to zero — that's the green light to flip `enforce`

---

## Rollback

If anything breaks, the fastest rollback is namespace-scoped:

```bash
# Remove PSS labels
kubectl label ns jarble pod-security.kubernetes.io/warn-
kubectl label ns jarble pod-security.kubernetes.io/warn-version-
kubectl label ns jarble pod-security.kubernetes.io/audit-
kubectl label ns jarble pod-security.kubernetes.io/audit-version-

# Remove NetworkPolicies
kubectl -n jarble delete networkpolicy jarble-default-deny-egress
kubectl -n jarble delete networkpolicy jarble-default-deny-ingress
```

The Terraform state and the rest of the cluster are untouched.

---

## Files

- `infrastructure/k8s/networkpolicy.yaml` — the two NetworkPolicy manifests
- `docs/audits/namespace-security-hardening.md` — this document
- Live cluster: `jarble` namespace labels + 2 NetworkPolicy objects

## Files explicitly NOT touched in this wave

- `jarble-api-main/src/k8s/lifecycle.ts` — runtime hardening is Wave 4
- `runtimes/openclaw/**` — runtime image hardening is Wave 4
- `infrastructure/terraform/**` — Hetzner-level egress is Wave 2 Team 2
