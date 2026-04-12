# Agent VPS Egress Firewall — Network Hardening Plan

**Date:** 2026-04-07
**Status:** APPLIED (code changes landed; awaits `terraform apply` + Kubero env var)
**Related:** Phase 5 of Agent Teams rescue (commit `bc8735b`) — enforced 1:1 VPS-per-agent isolation
**Owner:** Infrastructure / Platform Security

---

## Problem

After Phase 5 of the Agent Teams rescue, every agent pod runs on its own dedicated
Hetzner Cloud VPS via K8s scheduling constraints. This walls off **cross-tenant
compute** at the hypervisor (KVM) boundary. But the **network egress story is
wide open**:

1. The shared `hcloud_firewall.cluster` (`infrastructure/terraform/main.tf:61`)
   only declares INGRESS rules. Hetzner Cloud firewalls default to
   "outbound: allow all" until at least one egress rule is declared.
2. A compromised agent can therefore:
   - Query the Hetzner metadata service at `169.254.169.254` (SSRF) and read
     `cloud-init` user-data — which embeds `K3S_JOIN_TOKEN`. Joining the cluster
     as a rogue agent becomes trivial after that.
   - Scan the private network `10.0.0.0/16` and probe other agent VPSes' kubelet
     (`:10250`) and K3s API (`:6443`) ports.
   - Run crypto-mining stratum traffic, DDoS external targets, or exfiltrate
     data over HTTPS.
3. The cluster firewall is also attached to **master** (`main.tf:142`) and
   **Coolify** (`coolify.tf:22`). Tightening it directly would break
   cert-manager → Let's Encrypt, GHCR pulls, and apt updates on those nodes.

The right fix: a **separate** Hetzner firewall for agent workers, attached
**only** to auto-scaled VPSes by `nodeManager.ts`, plus a defense-in-depth
iptables rule baked into cloud-init that blocks the metadata service before
K3s even joins.

---

## Phase A — iptables metadata block in cloud-init [APPLIED]

**File:** `jarble-api-main/src/k8s/nodeManager.ts` (in `buildCloudInit`,
around lines 141–185)

Added before the K3s install/join step:

```bash
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq open-iscsi nfs-common curl iptables iptables-persistent

iptables -I OUTPUT -d 169.254.169.254/32 -j DROP
if command -v ip6tables >/dev/null 2>&1; then
  ip6tables -I OUTPUT -d fe80::/10 -j DROP || true
fi

mkdir -p /etc/iptables
iptables-save > /etc/iptables/rules.v4
if command -v ip6tables-save >/dev/null 2>&1; then
  ip6tables-save > /etc/iptables/rules.v6 || true
fi
systemctl enable netfilter-persistent || true
```

- `iptables-persistent` is installed so the rule survives reboots via
  `netfilter-persistent.service`.
- `DEBIAN_FRONTEND=noninteractive` prevents `iptables-persistent` from prompting
  about saving current rules (which would hang cloud-init).
- The rule is inserted with `-I` (prepend) so it takes effect even if K3s/CNI
  later add OUTPUT chain rules.
- Takes effect on every NEW auto-scaled worker. Existing workers are unaffected
  until they roll over.

**Why this is layer 1 even though Hetzner firewall covers it:** the iptables
drop runs *during* cloud-init, before the Hetzner firewall ID is even attached
to the server. There's a small window where a compromised image could query
metadata; closing it locally eliminates that window. Belt and suspenders.

---

## Phase B — `hcloud_firewall.agent_egress` resource [APPLIED]

**File:** `infrastructure/terraform/main.tf` (new resource added immediately
after `hcloud_firewall.cluster`, around line 120)

Added a brand-new `hcloud_firewall.agent_egress` resource with **only egress
rules** (no ingress — it inherits ingress allowances from the cluster firewall
which is also attached). Allowlist:

| Direction | Protocol | Port  | Destination       | Purpose                            |
|-----------|----------|-------|-------------------|------------------------------------|
| out       | udp      | 53    | 0.0.0.0/0, ::/0   | DNS                                |
| out       | tcp      | 53    | 0.0.0.0/0, ::/0   | DNS over TCP                       |
| out       | tcp      | 443   | 0.0.0.0/0, ::/0   | HTTPS — LLM APIs, GHCR, MCPs       |
| out       | tcp      | 80    | 0.0.0.0/0, ::/0   | HTTP — apt, K3s installer redirect |
| out       | tcp      | 10250 | 10.0.0.0/16       | K3s kubelet (private network)      |
| out       | tcp      | 6443  | 10.0.0.0/16       | K3s API server (private network)   |
| out       | udp      | 8472  | 10.0.0.0/16       | Flannel VXLAN (private network)    |
| out       | udp      | 123   | 0.0.0.0/0, ::/0   | NTP time sync                      |

**Critical Hetzner semantic:** Hetzner Cloud firewalls default to *allow-all*
egress, but the moment **any** rule with `direction = "out"` is declared, the
default flips to *deny-all* egress. Everything not in the allowlist above is
dropped at the Hetzner network layer:

- 169.254.169.254 (Hetzner metadata SSRF — also blocked by iptables)
- Arbitrary high TCP ports (port scanning, exploit shells, crypto-mining stratum)
- SMB/CIFS (445), outbound SSH (22), IRC, etc.
- 10.0.0.0/16 traffic outside the kubelet/API/VXLAN allowlist (cuts lateral moves
  between agent VPSes)

**Multi-firewall composition:** When both `hcloud_firewall.cluster` and
`hcloud_firewall.agent_egress` are attached to the same server, Hetzner combines
them additively — ingress is the union of allowed sources, egress is the
intersection of allowed destinations. So existing inbound K3s traffic still
works, and outbound is now restricted to the agent_egress allowlist.

A new output `agent_egress_firewall_id` was added to `outputs.tf` so the user
can pipe the value into Kubero env vars after `terraform apply`.

---

## Phase C — Wire `agent_egress` into nodeManager.ts [APPLIED]

**File:** `jarble-api-main/src/k8s/nodeManager.ts`

Two changes inside `provisionNode()`:

1. Read a new env var alongside the existing `HETZNER_FIREWALL_ID`:
   ```ts
   const agentEgressFirewallId = parseInt(
     process.env.HETZNER_AGENT_EGRESS_FIREWALL_ID || "0"
   );
   ```

2. Build the firewalls array dynamically and pass to the Hetzner POST `/servers`
   call:
   ```ts
   const firewallsToAttach: Array<{ firewall: number }> = [
     { firewall: firewallId },
     ...(agentEgressFirewallId ? [{ firewall: agentEgressFirewallId }] : []),
   ];
   ```

3. The success log line now reports whether the egress firewall was attached,
   and emits a WARNING if `HETZNER_AGENT_EGRESS_FIREWALL_ID` is missing.

**Backwards compatibility:** if the env var is unset (or `0`), the new firewall
is silently skipped and behavior is identical to today. The code is safe to
deploy before `terraform apply` runs.

---

## Phase D — Documentation [APPLIED]

This file. Status of all phases marked APPLIED above.

---

## How to deploy

The code changes have already landed in the worktree. To complete the rollout:

### 1. Apply the Terraform change

```bash
cd infrastructure/terraform
terraform plan   # review the new hcloud_firewall.agent_egress resource
terraform apply  # creates the firewall in Hetzner Cloud
```

After `terraform apply`, capture the new firewall ID:

```bash
terraform output -raw agent_egress_firewall_id
# → e.g. 1234567
```

### 2. Set the env var on the API deployment in Kubero

Open the Kubero dashboard at `kubero.jarble.ai`, edit the
`jarble-api-kuberoapp-web` deployment in the `jarble-production` namespace, and
add:

```
HETZNER_AGENT_EGRESS_FIREWALL_ID=1234567
```

(The value from step 1 above.)

Save & roll the deployment. The next time `nodeManager.ts` provisions an
auto-scaled VPS, it will attach **both** the cluster firewall and the new
egress firewall.

### 3. Verify on a fresh worker

After the first new auto-scaled worker comes up:

```bash
ssh root@<worker-ip>

# 1. iptables rule is active and persisted
iptables -L OUTPUT -n -v | grep 169.254.169.254
# → DROP rule visible at top of OUTPUT chain

cat /etc/iptables/rules.v4 | grep 169.254
# → -A OUTPUT -d 169.254.169.254/32 -j DROP

# 2. Metadata service is unreachable
curl --max-time 5 http://169.254.169.254/hetzner/v1/metadata/public-ipv4
# → curl: (28) Connection timed out

# 3. Outbound HTTPS still works
curl -sI https://api.openrouter.ai/api/v1/auth/key | head -1
# → HTTP/2 401 (or 200) — connection succeeds

# 4. Outbound on a non-allowlisted port is blocked
curl --max-time 5 https://example.com:8443
# → curl: (28) Connection timed out
```

### 4. Existing workers

Existing auto-scaled VPSes provisioned BEFORE this change remain unrestricted.
To force them onto the new posture, either:

- Drain & delete each one (the watcher will reprovision them with the new
  cloud-init + firewall on the next pending pod), or
- Use the Hetzner Cloud console / API to attach `agent_egress` to existing
  servers manually.

---

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Egress allowlist blocks legitimate agent traffic | Low | Medium | All major LLM APIs (Anthropic, OpenAI, OpenRouter, Google) and MCP servers use HTTPS:443. WebSockets ride on 443 too. NTP/DNS/HTTP covered. Worst case: temporarily detach the firewall via Hetzner console. |
| iptables-persistent install hangs cloud-init | Low | High (worker fails to join) | `DEBIAN_FRONTEND=noninteractive` prevents the prompt. |
| Existing workers unprotected | Certain | Medium | Documented in "Existing workers" section. Drain-and-replace recommended. |
| Master/Coolify accidentally affected | Very Low | High | New firewall is ONLY referenced from `nodeManager.ts`. Terraform never attaches it to master or coolify. |

---

## Rollback

If something breaks:

1. **Code rollback:** `git revert` the commits and redeploy the API.
2. **Firewall detach (without code rollback):** unset
   `HETZNER_AGENT_EGRESS_FIREWALL_ID` in Kubero and roll the deployment.
   Existing workers keep the firewall until they're recycled, but new ones
   won't get it.
3. **Nuclear option (immediate, all workers):** in the Hetzner Cloud console,
   delete the `jarble-cluster-agent-egress` firewall. Hetzner will detach it
   from every server it's attached to. The iptables rule still blocks
   metadata, but everything else returns to default-allow.
4. **iptables rollback per-worker:** `iptables -D OUTPUT -d 169.254.169.254/32 -j DROP &&
   iptables-save > /etc/iptables/rules.v4`.

---

## What's NOT covered (future work)

- **Egress filtering by destination FQDN/CIDR** — Hetzner firewalls only filter
  by IP/CIDR + port, not by hostname. A determined attacker could still
  exfiltrate data over HTTPS:443 to any IP that resolves. Mitigating this
  requires a forward proxy (Squid, mitmproxy, or Cloudflare Gateway) with an
  allowlist of LLM provider hostnames.
- **DNS filtering** — Agents can still issue arbitrary DNS queries. Pointing
  resolv.conf at a filtered DNS server (e.g., NextDNS, AdGuard, or a
  self-hosted Pi-hole) would close DNS-based exfil.
- **Egress NetworkPolicy at the K8s layer** — Calico/Cilium NetworkPolicies
  could enforce this per-pod instead of per-VPS. With 1:1 VPS-per-agent
  scheduling that's redundant, but worth revisiting if we ever revert to
  multi-tenant nodes.
- **Hetzner Cloud Load Balancer egress** — out of scope; LBs only forward
  traffic, they don't initiate it.
