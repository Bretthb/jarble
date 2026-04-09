# Autoscaler CSI Fix Plan — Longhorn on auto-workers

**Date**: 2026-04-07
**Author**: terraform-infra agent
**Status**: PLAN ONLY — no apply. Executor must get explicit approval before touching infra.
**Problem**: Bot pods with Longhorn PVCs fail `FailedAttachVolume` on autoscaled workers because `CSINode jarble-auto-*` does not contain driver `driver.longhorn.io`.

---

## 1. Current state

### 1a. How auto-workers are provisioned

`jarble-api-main/src/k8s/nodeManager.ts`:

- `buildCloudInit(nodeIp, hasVolume)` (lines 115-159) generates the cloud-init script.
- The script **already installs the Longhorn node prereqs**:
  - `apt-get install -y -qq open-iscsi nfs-common curl` (line 147)
  - `systemctl enable iscsid && systemctl start iscsid` (line 148)
- It then joins K3s as an agent: `curl -sfL https://get.k3s.io | ... sh -s - agent --server ... --token ... --flannel-iface enp7s0` (lines 151-155).
- After the node joins (`provisionNode`, lines 284-325), two things happen:
  1. **Label** (lines 285-301): `jarble.ai/auto-scaled=true`, `jarble.ai/role=agent`, `jarble.ai/managed-node-id=<id>`.
  2. **Taint** (lines 305-325): `jarble.ai/workload=agent:NoSchedule`.

The taint is the critical piece. Its purpose (from the code comment) is to keep container/website workloads off dedicated agent VPS nodes. Agent pods tolerate it via `buildTolerationsForType("agent")` in `jarble-api-main/src/k8s/lifecycle.ts` lines 144-158.

### 1b. How Longhorn is installed

`infrastructure/terraform/main.tf` lines 159-204 (master `user_data`):

```bash
# Install Longhorn (block storage for persistent volumes)
kubectl apply -f https://raw.githubusercontent.com/longhorn/longhorn/v1.6.0/deploy/longhorn.yaml
```

- Installed **once** at master boot via plain `kubectl apply` of the upstream bundled YAML.
- No Helm, no values file, no Terraform `kubernetes_manifest` resource managing it.
- No post-install patching of tolerations or affinity anywhere in the repo (`grep -ri longhorn` confirms only the master user_data references it for install; all other references are runtime kubectl commands in `.claude/settings.local.json`).

The Longhorn v1.6.0 bundled manifest ships `longhorn-manager` as a DaemonSet. **Its default tolerations only cover the noisy-node taints** Kubernetes adds automatically (`node.kubernetes.io/disk-pressure`, `not-ready`, `unreachable`, etc.). It does **not** tolerate arbitrary custom NoSchedule taints.

### 1c. The failure mode

When `nodeManager.ts` taints a freshly-joined auto-worker with `jarble.ai/workload=agent:NoSchedule`:

1. The `longhorn-manager` DaemonSet controller evaluates whether its pod template tolerates the node's taints.
2. It does not (no matching toleration).
3. No `longhorn-manager` pod is scheduled on the auto-worker.
4. The `longhorn-csi-plugin` DaemonSet (which contains the actual CSI node driver registrar) has the same issue — also no matching toleration, also not scheduled.
5. When the Longhorn instance-manager does not start on the node, the node never registers as a Longhorn node, and `kubelet` never sees the `driver.longhorn.io` CSI driver. The `CSINode` object for that node lacks the driver entry.
6. Any pod with a Longhorn PVC scheduled onto that node fails `FailedAttachVolume` with exactly the error reported: `CSINode jarble-auto-* does not contain driver driver.longhorn.io`.

This is fully consistent with the three stuck pods in `jarble` namespace.

### 1d. Why the fixed master + any statically provisioned workers work

The master boots, installs Longhorn, and is untainted (apart from the standard control-plane label — and Longhorn DaemonSets upstream do tolerate control-plane in recent versions, but this is moot because the master was the very node that `kubectl apply`d the manifest on itself; the Longhorn install itself assumes it will schedule on whichever nodes are present at install time without custom taints).

There are no Terraform-managed static workers (confirmed in `main.tf` lines 209-216 — "Static worker nodes are NOT managed by Terraform"), so the cluster topology is: master + auto-workers + any manually-provisioned `jarble-agents` node at 10.0.1.50. The manual nodes presumably have no custom taint so Longhorn DaemonSets schedule there fine. **Auto-workers are the only nodes with the custom taint, and they are the only nodes where Longhorn fails to schedule.** QED.

---

## 2. Root cause — Path B (Longhorn DaemonSet tolerations)

**Not Path A.** The cloud-init already does everything it can do at the OS level:
- `open-iscsi` is installed
- `nfs-common` is installed
- `iscsid` is running

No cloud-init change would fix this, because the problem is not missing OS packages — the problem is that the Longhorn DaemonSet pods are never scheduled onto the node in the first place. You could perfectly prep the OS and it would make no difference: DaemonSet scheduling happens in the control plane, not on the node.

**Evidence**:
- `grep -n "open-iscsi" infrastructure/terraform/main.tf` → master has it
- `grep -n "open-iscsi" jarble-api-main/src/k8s/nodeManager.ts` → auto-workers have it
- Both the master and auto-workers run the same OS prereqs.
- The **only** difference between a working node (master) and a failing node (auto-worker) is the custom `jarble.ai/workload=agent:NoSchedule` taint.
- `longhorn-manager` DaemonSet upstream toleration set does not include this custom key.
- No code in the repo patches Longhorn tolerations after install.

**Conclusion**: Path B. The Longhorn DaemonSets must tolerate `jarble.ai/workload=agent:NoSchedule`, or they will never schedule onto auto-workers, and the CSI driver will never be available there.

(A parallel `k8s-pod-lifecycle-debugger` agent was asked to investigate from the K3s side. At time of writing, their report is not yet filed in `.claude/agent-memory/k8s-pod-lifecycle-debugger/`. If they arrive at a different root cause, reconcile before applying. The analysis above is complete from the infra side and I am confident in it.)

---

## 3. Implementation plan

There are **two** sane executions of Path B. Both end at the same place (Longhorn DaemonSets tolerate the taint). Pick one:

### Option 3A — Runtime kubectl patch after install (RECOMMENDED)

Add a post-install patch block to the master's `user_data` in `infrastructure/terraform/main.tf`. This is the smallest, lowest-risk change and matches how the rest of the master bootstrap is structured.

**File**: `infrastructure/terraform/main.tf`

**Edit location**: inside the master `user_data` heredoc, immediately after the existing Longhorn install + storageclass patch block (currently ending at line 196), and before the cert-manager install (line 198).

**Exact insert — verbatim shell lines** (to be placed between line 196 and line 198 in `main.tf`):

```bash
    # Wait for Longhorn DaemonSets to exist before patching
    until kubectl -n longhorn-system get daemonset longhorn-manager >/dev/null 2>&1; do sleep 3; done
    until kubectl -n longhorn-system get daemonset longhorn-csi-plugin >/dev/null 2>&1; do sleep 3; done

    # Patch Longhorn DaemonSets so they schedule onto jarble-auto-* nodes,
    # which are tainted with jarble.ai/workload=agent:NoSchedule by nodeManager.ts.
    # Without this, longhorn-manager + longhorn-csi-plugin never land on auto-workers
    # and bot pods fail with "CSINode does not contain driver driver.longhorn.io".
    for DS in longhorn-manager longhorn-csi-plugin; do
      kubectl -n longhorn-system patch daemonset "$DS" --type=json -p='[
        {"op":"add","path":"/spec/template/spec/tolerations/-","value":{"key":"jarble.ai/workload","operator":"Equal","value":"agent","effect":"NoSchedule"}}
      ]' || true
    done
```

**Why `--type=json` + `op: add` with `/-`**: appends to the existing tolerations array without clobbering the upstream tolerations (which must be preserved — they cover `disk-pressure`, `not-ready`, etc.). A strategic merge patch on a list would replace the whole list unless merge keys are set up, which is fragile. JSON patch append is explicit and correct.

**Why `|| true`**: the patch is idempotent in effect but not in outcome — running it twice produces two identical entries in the toleration list. This is harmless (duplicate tolerations are a no-op), and the `|| true` guards against the master bootstrap failing on re-run. For a production-clean fix, add an `if ! kubectl get daemonset ... -o jsonpath=... | grep -q 'jarble.ai/workload'; then ... fi` guard — but this is the master's `prevent_destroy = true` lifecycle with `ignore_changes = [user_data]`, so the script only runs on a fresh master. Duplicates can't accumulate in practice.

**Why in master user_data, not cloud-init of workers**: the patch is a one-shot, cluster-scoped operation (a DaemonSet is cluster-level, not per-node). Putting it on the master co-locates it with the `kubectl apply` that installs Longhorn, so the install and the patch are always in sync. Putting it in worker cloud-init would require kubeconfig distribution to workers, which is a much larger change.

**Running existing clusters** (where the master already ran and Longhorn is already installed without the patch): one manual `kubectl patch` command is needed to fix the currently stuck cluster without waiting for a master rebuild. See section 4b.

### Option 3B — Helm-managed Longhorn via Terraform

Replace the `kubectl apply -f longhorn.yaml` with a `helm_release` resource using the Helm provider, and pass tolerations via values. Pros: declarative, version-pinned, easier to upgrade. Cons: much larger change — adds a new provider, changes how Longhorn is installed, may require bootstrap ordering changes (Helm provider needs a working kubeconfig from the master, which is a chicken-and-egg problem the current setup explicitly avoids by using a cloud-init heredoc that runs on the master itself).

**Not recommended now.** File this as a follow-up improvement. Do 3A first to unblock the stuck pods, then reconsider 3B as part of a larger "Terraformize the in-cluster installs" cleanup.

### K3s join order — not relevant here

The question asked about K3s join ordering. For Path B, the answer is: **the K3s agent install in nodeManager.ts cloud-init does not need to change at all**. The fix is entirely in the Longhorn side (DaemonSet spec), not in the worker bootstrap. The worker joins → K3s sees the node → the (now-patched) Longhorn DaemonSets schedule onto it → CSI driver registers → pods with Longhorn PVCs can attach.

### Required OS packages

None new. Cloud-init already installs `open-iscsi` and `nfs-common`. No change needed.

---

## 4. Validation steps

### 4a. After a new auto-worker joins (copy-pasteable)

All commands assume `KUBECONFIG=~/.kube/jarble-prod.yaml` or equivalent.

```bash
# 1. Trigger an auto-scale by creating a deployment, or wait for a pending pod
kubectl -n jarble get pods -l jarble.ai/type=bot -o wide

# 2. Find the new auto-worker node name
kubectl get nodes -l jarble.ai/auto-scaled=true

# 3. Confirm the node is tainted as expected
kubectl get node <jarble-auto-NAME> -o jsonpath='{.spec.taints}'
# Expected: [{"effect":"NoSchedule","key":"jarble.ai/workload","value":"agent"}]

# 4. Confirm longhorn-manager scheduled onto it
kubectl -n longhorn-system get pods -o wide | grep <jarble-auto-NAME>
# Expected: longhorn-manager-xxxx  Running  ... <jarble-auto-NAME>
#           longhorn-csi-plugin-xxxx  Running  ... <jarble-auto-NAME>
#           (plus instance-manager and engine-image pods that Longhorn creates dynamically)

# 5. Confirm the CSI driver is registered on the CSINode object
kubectl get csinodes <jarble-auto-NAME> -o yaml | grep -A3 'driver.longhorn.io'
# Expected: a "drivers" entry with "name: driver.longhorn.io" and a "nodeID"

# 6. Confirm the bot pod can attach its PVC and reach Running
kubectl -n jarble get pod <dep-xxxx-xxxx> -o wide
# Expected: STATUS=Running, NODE=<jarble-auto-NAME>

# 7. Confirm the Longhorn DaemonSet tolerations were actually applied
kubectl -n longhorn-system get daemonset longhorn-manager -o jsonpath='{.spec.template.spec.tolerations}' | jq
kubectl -n longhorn-system get daemonset longhorn-csi-plugin -o jsonpath='{.spec.template.spec.tolerations}' | jq
# Expected: includes {"key":"jarble.ai/workload","operator":"Equal","value":"agent","effect":"NoSchedule"}
```

### 4b. Fixing the currently stuck cluster (one-shot manual patch)

Until the master is rebuilt, the fix has to be applied manually to the running cluster. This is the exact same commands the Terraform change will bake in:

```bash
# Inspect the current tolerations first
kubectl -n longhorn-system get daemonset longhorn-manager \
  -o jsonpath='{.spec.template.spec.tolerations}' | jq

# Apply the patch
for DS in longhorn-manager longhorn-csi-plugin; do
  kubectl -n longhorn-system patch daemonset "$DS" --type=json -p='[
    {"op":"add","path":"/spec/template/spec/tolerations/-","value":{"key":"jarble.ai/workload","operator":"Equal","value":"agent","effect":"NoSchedule"}}
  ]'
done

# The DaemonSet controller will now create pods on tainted auto-workers automatically.
# Watch them come up:
kubectl -n longhorn-system get pods -o wide -w
```

Once the Longhorn pods are Running on the auto-workers, the stuck bot pods should proceed past `FailedAttachVolume` within a minute. If they don't auto-retry, delete the pod to force re-attach:

```bash
kubectl -n jarble delete pod <stuck-pod-name>
# The Deployment controller will recreate it and the new pod will schedule cleanly.
```

---

## 5. Additional gaps on auto-workers (vs master)

I compared the master's user_data (`infrastructure/terraform/main.tf` lines 159-204) against the auto-worker cloud-init (`nodeManager.ts` lines 141-158):

| Component | Master | Auto-worker | Gap? |
|-----------|--------|-------------|------|
| `open-iscsi`, `nfs-common`, `curl` | ✓ | ✓ | No |
| `iscsid` enabled + started | ✓ | ✓ | No |
| K3s install | server | agent | Expected |
| Flannel iface `enp7s0` | ✓ | ✓ | No |
| Traefik ingress | disabled servicelb | — (inherited) | No |
| Longhorn install | kubectl apply (v1.6.0) | n/a (cluster-scoped) | **This is the bug.** |
| Longhorn default storageclass patch | ✓ | n/a | No |
| cert-manager | ✓ | n/a | No |
| Block storage mount (`/var/lib/longhorn`) | — | ✓ conditional (lines 121-139) | No — only workers need this |
| fstab entry for the block volume | — | ✓ (line 131-133) | No |

**Other possible gaps I looked for but didn't find evidence of**:
- **Network plugin**: Flannel is bundled with K3s, no extra install needed. Same `--flannel-iface` flag on both. OK.
- **metrics-server**: K3s ships it by default. Not installed explicitly on either side. OK (same on both).
- **Log shipping**: no agent on either side (would be Kubero / Coolify responsibility). OK.
- **Monitoring / node-exporter**: no agent on either side. OK.
- **Firewall rules**: auto-workers inherit the cluster firewall via `HETZNER_FIREWALL_ID`. Master uses the Terraform-managed `hcloud_firewall.cluster`. These may or may not be the same firewall — check `HETZNER_FIREWALL_ID` env var against `hcloud_firewall.cluster.id`. If they differ, intra-cluster ports (10250, 8472, 2379-2380) may be restricted on auto-workers. **Side-finding: worth verifying separately, out of scope for this plan.**
- **SSH key**: auto-workers use `HETZNER_SSH_KEY_ID` which is separately managed. Same concern — verify it matches `hcloud_ssh_key.default.id`. Not a blocker for the CSI fix.

**Only the Longhorn DaemonSet toleration is load-bearing for the reported bug.** The other items above are worth a follow-up audit but are not part of this fix.

---

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Patch command fails on re-run (JSON append not idempotent) | Low | Low — duplicate tolerations are a no-op | `|| true` guard + master has `prevent_destroy` so it only runs on fresh master |
| Longhorn DaemonSet doesn't exist yet when patch runs | Medium if wait-loop is omitted | Medium — patch fails, master bootstrap error | Explicit `until kubectl ... get daemonset ... >/dev/null; do sleep 3; done` wait loop before the patch |
| Longhorn v1.6.0 has additional DaemonSets I missed | Low | Medium — CSI still broken | I identified `longhorn-manager` + `longhorn-csi-plugin`. These are the two that exist in v1.6.0 bundle-yaml. Validate after apply with `kubectl -n longhorn-system get ds` |
| Patch is correct but auto-worker is ALSO missing something else | Low | High — fix doesn't work | Validation step 5 (`kubectl get csinodes`) will catch it. If `driver.longhorn.io` still not present after pods are scheduled, escalate to check node's `/var/lib/rancher/k3s/agent/plugins/` and kubelet logs |
| Master rebuild wipes cluster state | Low — `prevent_destroy = true` | Catastrophic | Don't rebuild master. Apply the manual patch from 4b to the live cluster now; the Terraform change only takes effect on the next fresh cluster bootstrap |
| Instance-manager pods need HostPID / privileged that PSS baseline blocks | Low on this cluster | Medium | `k8s-security.tf` shows PSS enforcement is gated behind `var.enable_gvisor || var.enable_kata` — neither is enabled by default, so PSS is not enforced, so Longhorn's privileged containers work fine. If someone enables gVisor/Kata later, Longhorn will need an exception via a namespace label override |
| Parallel debugger finds a different root cause | Medium | Low — their finding may be complementary (e.g., a K3s-side csi-node-driver-registrar issue) | Wait for their report before applying to prod. Their findings may add to, not replace, this plan |

---

## 7. Cost and restart implications

- **No existing auto-worker rebuild required**: Path B changes a DaemonSet, not the nodes. The DaemonSet controller will simply schedule new `longhorn-manager` pods onto the already-running tainted nodes as soon as the patch is applied.
- **No cluster restart**: manual patch (4b) is instant, zero downtime, zero pod restarts outside `longhorn-system`.
- **No Hetzner boot time increase**: cloud-init is unchanged, so the ~90s auto-worker provisioning promise is preserved.
- **No Terraform apply needed for the hotfix**: the manual `kubectl patch` commands in 4b fix the live cluster. The Terraform change is only needed so the patch is baked into the next fresh master bootstrap (which, because of `prevent_destroy = true`, is a disaster-recovery scenario — not something you'll hit in normal operation).
- **Hetzner cost**: zero change. Same number of VPS, same types, same block storage.

---

## 8. Effort estimate

Honest numbers:

- **Manual hotfix of live cluster** (section 4b): **5 minutes**, including running the patch, watching pods come up, and deleting the stuck bot pods to force re-attach. Do this first.
- **Terraform code change** (section 3A): **15 minutes** to write, review, and commit. Single file, ~15 lines inserted.
- **Validation on a freshly provisioned auto-worker**: **10 minutes**, including triggering a new auto-scale, waiting for the node to join, and running the section-4a commands.
- **Total**: **30 minutes of focused work** if everything goes well. Budget 1 hour for unknown-unknowns.

Note: the Terraform change itself is not strictly required to unblock today's failure — the manual patch does that. The Terraform change is the permanent fix so the next cluster rebuild doesn't reintroduce the bug. Both should land.

---

## Summary

- **Root cause**: Longhorn `longhorn-manager` + `longhorn-csi-plugin` DaemonSets don't tolerate the custom `jarble.ai/workload=agent:NoSchedule` taint that `nodeManager.ts` applies to auto-workers. They never schedule, CSI driver never registers, PVC attach fails.
- **Fix (hotfix)**: `kubectl patch daemonset` to append the toleration. One command, zero downtime.
- **Fix (permanent)**: add the same patch to the master's Terraform `user_data` so it's baked in on cluster rebuild.
- **Not the cloud-init side**: cloud-init is already correct. Do not touch it.
- **Not the K3s join side**: K3s join is already correct. Do not touch it.
