# Agent Egress Firewall — Hardening Plan

**Created**: 2026-04-07 as Phase 5 follow-up to Bot Teams rescue
**Status**: NOT APPLIED — waiting for user decision
**Related**: `docs/audits/qa-bot-teams-2026-04-07.md`, PHASE 5 commit

## Context

Phase 5 of the Bot Teams rescue enforced hard 1:1 VPS-per-agent isolation
via required nodeAffinity + podAntiAffinity. That makes the "my deployment
= my VPS = my agent = my data" model physically enforced: each bot gets
its own Hetzner Cloud VPS (a KVM VM), and the hypervisor boundary walls
off cross-tenant access.

**But container escape on the VPS is still a concern.** A bot with shell
execution (which OpenClaw gives it by design) could theoretically exploit
a kernel CVE to escape the container and gain root on the Linux guest OS.
Once rooted on the VPS, the attacker's blast radius is limited by whatever
egress and lateral access the VPS has.

Today, that blast radius is **larger than it needs to be** because the
Hetzner Cloud firewall (`infrastructure/terraform/main.tf:61`) has zero
egress rules. Hetzner firewalls default to "outbound: allow all" unless
explicit egress rules say otherwise. So a compromised agent VPS can:

1. Scan the entire Hetzner private network (10.0.0.0/16) for other VPSes
2. Exploit kubelet on port 10250 of other nodes (if not separately locked down)
3. Reach the K3s API server on master:6443 (auth-protected but one more
   layer to get through)
4. Query the Hetzner metadata service at `169.254.169.254` (SSRF vector —
   could leak cloud credentials if the VPS has any)
5. Run crypto-mining against any pool on the internet
6. Launch DDoS attacks against external targets
7. Exfiltrate data to attacker-controlled endpoints

## Why the current firewall can't just be tightened

`hcloud_firewall.cluster` (main.tf:61-119) is applied to **both** master
(`main.tf:142`) **and** Coolify (`coolify.tf:22`). If we add egress rules
to it, they apply to everything — which breaks master's ability to pull
container images, cert-manager fetching from Let's Encrypt, Kubero
pulling from GHCR, etc.

Master needs permissive egress. **Agent workers need restrictive egress.**
These are different roles that deserve different firewalls.

## Recommended fix — separate agent-egress firewall

### 1. Add a new Terraform resource

File: `infrastructure/terraform/main.tf` (append after line 119)

```hcl
# ─── Agent Worker Egress Firewall ──────────────────────────────────────────
# Applied to auto-scaled agent VPSes in addition to the cluster firewall.
# Blocks lateral cluster moves and metadata-service SSRF while allowing
# outbound HTTPS for LLM providers and web browsing (which bots need).
resource "hcloud_firewall" "agent_egress" {
  name = "${var.cluster_name}-agent-egress"

  # ── INGRESS ─────────────────────────────────────────────────────────────
  # Same as cluster firewall — bots don't need any extra inbound ports
  # beyond what the cluster firewall already allows (10250, 8472, 2379-2380
  # on the private network).

  # ── EGRESS ──────────────────────────────────────────────────────────────
  # BLOCK metadata service SSRF vector (most critical)
  # Hetzner's cloud-init metadata lives at 169.254.169.254. A bot with
  # SSRF or shell access could query this to leak VPS-level credentials.
  # There is no legitimate reason for an agent bot to reach this endpoint
  # at runtime (cloud-init already ran at boot time).
  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "any"
    destination_ips = ["169.254.169.254/32"]
    # NOTE: Hetzner firewall rules are implicit-allow. To BLOCK, we need
    # to use a different mechanism — iptables on the VPS itself, or NOT
    # list 169.254.169.254 in an allowlist and rely on default-deny.
    # See "Approach comparison" below.
  }

  # If using allowlist approach (recommended):
  #
  # Allow DNS (TCP/UDP 53)
  # Allow HTTPS (TCP 443) to the internet — bots need to reach LLM providers
  #   and arbitrary websites for browsing tools
  # Allow HTTP (TCP 80) to the internet — for non-TLS endpoints bots might hit
  # Allow private K3s traffic (10.0.0.0/16 on 10250, 8472, 6443)
  # Deny everything else including 169.254.0.0/16 (link-local)

  # Actual rules TBD after verifying Hetzner firewall semantics for egress.
}
```

### 2. Wire the new firewall into `nodeManager.ts`

File: `jarble-api-main/src/k8s/nodeManager.ts:234`

Current:
```ts
firewalls: [{ firewall: firewallId }],
```

New:
```ts
const agentEgressFirewallId = parseInt(process.env.HETZNER_AGENT_EGRESS_FIREWALL_ID || "0");
// ...
firewalls: [
  { firewall: firewallId },
  ...(agentEgressFirewallId ? [{ firewall: agentEgressFirewallId }] : []),
],
```

Then set `HETZNER_AGENT_EGRESS_FIREWALL_ID` in the API env from the new
Terraform output.

### 3. Master stays on cluster firewall only

Master (`main.tf:142`) still only has `hcloud_firewall.cluster.id`. No
change. Master keeps permissive egress because it needs it.

## Approach comparison: allowlist vs denylist

Hetzner Cloud firewall rules are implicit-allow within a direction: if you
add any `out` rule, only those destinations are allowed; everything else
is denied. This is the default behavior for `direction = "out"` rules.

**Approach A — Allowlist** (recommended):
- Allow: 0.0.0.0/0 tcp/443 (HTTPS anywhere, for LLM APIs + web browsing)
- Allow: 0.0.0.0/0 tcp/80 (HTTP anywhere, for websites bots might browse)
- Allow: 0.0.0.0/0 tcp/udp/53 (DNS)
- Allow: 10.0.0.0/16 tcp/10250, tcp/6443, udp/8472 (internal K3s)
- **Deny (implicit): everything else, including 169.254.169.254**

✅ Pros: simple, explicitly blocks metadata service + lateral private-network moves
❌ Cons: bots can still exfiltrate data via HTTPS POST to any internet endpoint

**Approach B — Denylist via host-level iptables** (defense in depth):
- Apply via cloud-init: `iptables -A OUTPUT -d 169.254.169.254 -j DROP`
- Keeps Hetzner firewall permissive but blocks the one critical IP at the node level
- Can be combined with Approach A for belt-and-suspenders

**Approach C — Egress proxy (HTTP/HTTPS proxy with allowlist)**:
- Deploy a forward proxy (Squid, Privoxy) on master
- Configure bot VPSes to route all outbound HTTP/HTTPS through the proxy
- Proxy enforces per-domain allowlist
- Bots can only reach allowlisted LLM providers + allowlisted search engines

✅ Pros: strongest control, blocks data exfil to unknown domains
❌ Cons: biggest operational surface, breaks web browsing to new sites, needs proxy maintenance

## Immediate mitigation (NO terraform change needed)

If the user wants some protection before the full firewall overhaul, the
easiest win is iptables on each new worker via cloud-init:

File: `jarble-api-main/src/k8s/nodeManager.ts:buildCloudInit()` (append to
the shell script that runs at worker boot)

```bash
# Block Hetzner metadata service (SSRF vector)
iptables -A OUTPUT -d 169.254.169.254/32 -j DROP
ip6tables -A OUTPUT -d fe80::/10 -j DROP
# Block lateral moves to other K3s nodes' kubelet ports
# (uncomment if you want to prevent bot-to-bot scanning — note this may
# break Longhorn replica sync if Longhorn uses kubelet exec, verify first)
# iptables -A OUTPUT -d 10.0.0.0/16 -p tcp --dport 10250 -j DROP
```

This gives you the most critical defense (metadata service) without
touching Terraform or the Hetzner Cloud API.

## What I'd ship next

**Pick one:**

1. **Minimum viable hardening** (30 min): iptables rule in cloud-init to
   block `169.254.169.254`. No Terraform, no firewall change. Applied to
   all future auto-workers automatically. Existing master + existing
   workers unaffected.

2. **Full separate firewall** (2-4 hours): new Terraform resource,
   `nodeManager.ts` change, new env var, new terraform apply, test on a
   fresh bot deployment, verify LLM calls still work, verify bot web
   browsing still works.

3. **Egress proxy** (1-2 days): deploy Squid on master, configure bots
   to route through it, per-domain allowlist, monitoring for blocked
   requests.

**My vote**: #1 now as a quick win, #2 scheduled for the next ops window,
skip #3 unless you're serving high-risk tenants.

## Files referenced

- `C:\Users\brett\jarble\infrastructure\terraform\main.tf` — current firewall def
- `C:\Users\brett\jarble\infrastructure\terraform\coolify.tf` — firewall reuse
- `C:\Users\brett\jarble\jarble-api-main\src\k8s\nodeManager.ts:167-290` — provisioning + firewall attach + cloud-init
- `C:\Users\brett\jarble\.claude\rules\autoscaling.md` — autoscaling context
