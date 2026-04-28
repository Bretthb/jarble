---
name: Autoscaler label PATCH silently fails, leaves node unschedulable
description: Auto-scaled K3s worker joins cluster but missing jarble.ai/auto-scaled label, so agent pod stays Pending forever
type: project
---

# Autoscaler label PATCH silent failure (Apr 24, 2026)

**Symptom:** Agent pod stuck Pending for hours/days. `kubectl describe` shows
`FailedScheduling: 0/N nodes are available: ... node(s) didn't match Pod's node affinity/selector`.
A dedicated worker named `jarble-auto-{deploymentId}` exists, is Ready, has the
`jarble.ai/workload=agent:NoSchedule` taint applied, but is **missing** the
`jarble.ai/auto-scaled=true` label.

**Why:** Agent pod spec has a hard node affinity (`requiredDuringSchedulingIgnoredDuringExecution`)
on `jarble.ai/auto-scaled In ["true"]`. See `jarble-api-main/src/k8s/lifecycle.ts:113-160`.
If the labeling PATCH at `jarble-api-main/src/k8s/nodeManager.ts:497-513` fails (network
blip, K8s API throttle, race with kubelet still registering the node), the catch block
logs "Failed to label auto-scaled node (non-fatal)" and execution continues. The taint
PATCH at line 518-537 is a separate request that often succeeds. Then the node is marked
`ready` at line 539-541 — but no agent pod can ever land on it because the required label
is missing AND the taint repels everything else from the shared pool. The pod is
permanently unschedulable until someone manually labels the node.

**How to apply:** When investigating "deployment stuck initializing/creating for hours",
check `kubectl describe node jarble-auto-{deploymentId} | grep jarble.ai`. If the taint
is present but the label is not, this bug is the cause. Quick unblock:
`kubectl label node jarble-auto-{id} jarble.ai/auto-scaled=true jarble.ai/role=agent jarble.ai/managed-node-id={dbId}`.
Real fix: make the label PATCH fatal (throw + trigger node cleanup) OR add a verification
read-back + retry loop OR add a periodic reconciler that re-labels any auto-scaled node
missing the label. Same family as JAR-130 (duplicate-InternalIP cloud-init bug).

**Indicator the diagnosis is right:** `managedNodes` row in DB shows `status=ready`,
`readyAt` set, but `kubectl get nodes -l jarble.ai/auto-scaled=true` does NOT include
this node.
