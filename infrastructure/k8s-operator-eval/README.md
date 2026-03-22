# OpenClaw K8s Operator — Evaluation Guide

## Overview

This directory contains artifacts for evaluating the [OpenClaw K8s Operator](https://github.com/openclaw-rocks/k8s-operator) (`openclaw.rocks/v1alpha1`) as a replacement for our manual K8s resource management (~420 lines across 8 module files in `jarble-api-main/src/k8s/`).

**Goal**: Deploy one operator-managed instance in a staging namespace (`jarble-eval`) and verify compatibility with our exec-based workflows (configSync, pairing, diagnostics, component I/O).

**Scope**: Evaluation only — no production code changes. If evaluation passes, Phase C will migrate `k8s/lifecycle.ts` to CRD-based creation.

## Prerequisites

- `kubectl` configured with cluster access
- Helm 3.x installed
- Access to `ghcr.io/openclaw-rocks/charts/openclaw-operator`
- A valid LLM API key for test instance

## Step 1: Install the Operator

```bash
# Create operator namespace
kubectl create namespace openclaw-operator-system

# Install via Helm
helm install openclaw-operator \
  oci://ghcr.io/openclaw-rocks/charts/openclaw-operator \
  --namespace openclaw-operator-system \
  --create-namespace \
  --version "0.1.x"  # Pin to latest 0.1.x — check GitHub for current version

# Verify operator is running
kubectl get pods -n openclaw-operator-system
# Expected: openclaw-operator-controller-manager-xxx  Running
```

### Verify CRD Installed

```bash
kubectl get crd openclawinstances.openclaw.rocks
# Should show the CRD with creation timestamp
```

## Step 2: Create Test Namespace and Resources

```bash
# Create evaluation namespace
kubectl create namespace jarble-eval

# Apply test Secret (edit first — add real LLM key)
kubectl apply -f test-secret.yaml

# Apply test ConfigMap
kubectl apply -f test-configmap.yaml
```

## Step 3: Deploy OpenClawInstance CR

```bash
# Review the CR first
cat example-instance.yaml

# Apply (dry-run to validate YAML)
kubectl apply --dry-run=client -f example-instance.yaml

# Apply for real
kubectl apply -f example-instance.yaml

# Watch pod creation
kubectl get pods -n jarble-eval -w
# Expected: test-eval-agent-0  Running  (StatefulSet ordinal)
```

## Step 4: Run Compatibility Tests

### Pod Discovery

```bash
# Check what labels the operator sets on pods
kubectl get pods -n jarble-eval --show-labels

# Our code uses: app=dep-{deploymentId}
# Operator may use: app.kubernetes.io/instance=test-eval-agent or similar
# THIS IS CRITICAL — if labels differ, findPodForDeployment() needs updating
```

### PVC Mount Path

```bash
# Check where PVC is mounted
kubectl exec -n jarble-eval test-eval-agent-0 -- mount | grep -E "(longhorn|pvc)"

# Check if /data exists (our current path)
kubectl exec -n jarble-eval test-eval-agent-0 -- ls -la /data/ 2>/dev/null || echo "/data not found"

# Check if /home/openclaw exists (operator's expected path)
kubectl exec -n jarble-eval test-eval-agent-0 -- ls -la /home/openclaw/ 2>/dev/null || echo "/home/openclaw not found"
```

### Exec Compatibility

```bash
# Basic exec test
kubectl exec -n jarble-eval test-eval-agent-0 -- whoami

# Write a test file to PVC
kubectl exec -n jarble-eval test-eval-agent-0 -- sh -c "echo 'test' > /data/test-write.txt && cat /data/test-write.txt"
# If /data fails, try /home/openclaw:
kubectl exec -n jarble-eval test-eval-agent-0 -- sh -c "echo 'test' > /home/openclaw/test-write.txt && cat /home/openclaw/test-write.txt"

# Verify write persists (delete pod, let StatefulSet recreate)
kubectl delete pod -n jarble-eval test-eval-agent-0
kubectl wait --for=condition=Ready pod/test-eval-agent-0 -n jarble-eval --timeout=120s
kubectl exec -n jarble-eval test-eval-agent-0 -- cat /data/test-write.txt  # or /home/openclaw/
```

### Gateway Health

```bash
# Port-forward to check gateway health endpoint
kubectl port-forward -n jarble-eval test-eval-agent-0 18789:18789 &
curl -s http://localhost:18789/healthz
# Expected: 200 OK

# Kill port-forward
kill %1
```

### Storage Usage (df)

```bash
# Our status.ts uses: df -B1 /data
kubectl exec -n jarble-eval test-eval-agent-0 -- df -B1 /data 2>/dev/null || \
kubectl exec -n jarble-eval test-eval-agent-0 -- df -B1 /home/openclaw
```

### Config Merge Mode

```bash
# Check if operator-managed config exists
kubectl exec -n jarble-eval test-eval-agent-0 -- cat /home/openclaw/.openclaw/openclaw.json 2>/dev/null || \
kubectl exec -n jarble-eval test-eval-agent-0 -- cat /data/.openclaw/openclaw.json

# Write a config file via exec (simulating configSync)
kubectl exec -n jarble-eval test-eval-agent-0 -- sh -c "mkdir -p /data/config && echo '{\"test\":true}' > /data/config/test.json && cat /data/config/test.json"
```

### Process Restart (.reload Marker)

```bash
# Check if PID file exists (restart loop support)
kubectl exec -n jarble-eval test-eval-agent-0 -- cat /data/.openclaw.pid 2>/dev/null || echo "No PID file"

# Touch .reload marker and check if process restarts
kubectl exec -n jarble-eval test-eval-agent-0 -- touch /data/.reload
# Watch logs to see if entrypoint detects .reload
kubectl logs -n jarble-eval test-eval-agent-0 -f --tail=20
```

### Read-Only Root Filesystem

```bash
# Check if root filesystem is read-only
kubectl exec -n jarble-eval test-eval-agent-0 -- touch /root/test 2>&1
# Expected: "Read-only file system" if operator enforces readOnlyRootFilesystem

# Verify /tmp is writable
kubectl exec -n jarble-eval test-eval-agent-0 -- touch /tmp/test && echo "tmp writable"
```

### Resource Cleanup

```bash
# Check what resources the operator created
kubectl get all,pvc,secret,configmap,pdb,networkpolicy,servicemonitor -n jarble-eval -l app.kubernetes.io/instance=test-eval-agent

# Delete the CR — verify cascade cleanup
kubectl delete openclawinstance test-eval-agent -n jarble-eval

# Verify everything is gone
kubectl get all,pvc -n jarble-eval
# PVC may be retained depending on operator's reclaim policy
```

## Step 5: Record Results

Fill in this checklist after running the tests:

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1 | Operator installs via Helm | | |
| 2 | CRD accepted by API server | | |
| 3 | Pod starts and reaches Running | | |
| 4 | Pod labels match or can be adapted | | Record actual labels |
| 5 | PVC mount path identified | | Record actual path |
| 6 | `kubectl exec` works | | |
| 7 | File writes to PVC persist | | |
| 8 | Gateway `/healthz` responds | | |
| 9 | `df` works on PVC mount | | |
| 10 | Config files readable from expected paths | | |
| 11 | Process restart via `.reload` works | | |
| 12 | Read-only root FS confirmed | | |
| 13 | CR deletion cascades all resources | | |

## Go / No-Go Criteria

### Go (proceed to Phase C migration)

All of these must pass:

- [ ] Pod exec works with standard `kubectl exec`
- [ ] PVC is writable from main container at a known, consistent mount path
- [ ] ConfigMap files are copied to PVC by operator's init chain
- [ ] Gateway health endpoint responds on expected port (18789)
- [ ] Pod labels are discoverable (we can adapt `findPodForDeployment()` selector)
- [ ] Process restart via `.reload` marker works (or operator provides equivalent)
- [ ] `df` storage usage check works on the PVC mount

### No-Go (stay with current approach)

Any of these blocks adoption:

- [ ] Exec blocked by operator-imposed security policy (PodSecurityPolicy, seccomp, etc.)
- [ ] PVC mount path is not configurable and conflicts with OpenClaw runtime expectations
- [ ] Operator's config merge mode overwrites our configSync-written files on restart
- [ ] Gateway token is auto-generated but not readable back from the Secret (we need it for chat proxy)
- [ ] Label scheme change requires major refactor across all 8 K8s modules
- [ ] Read-only root FS prevents necessary runtime operations (npm install, apt-get)

## Cleanup

```bash
# Remove test instance
kubectl delete openclawinstance test-eval-agent -n jarble-eval 2>/dev/null

# Remove test resources
kubectl delete -f test-secret.yaml 2>/dev/null
kubectl delete -f test-configmap.yaml 2>/dev/null

# Remove evaluation namespace
kubectl delete namespace jarble-eval

# Optionally remove operator (only after evaluation complete)
helm uninstall openclaw-operator -n openclaw-operator-system
kubectl delete namespace openclaw-operator-system
```

## Related Files

- `mapping.md` — Complete field mapping from our K8s modules to operator CRD
- `example-instance.yaml` — OpenClawInstance CR matching our deployment spec
- `test-secret.yaml` — Template Secret for test instance
- `test-configmap.yaml` — Template ConfigMap for test instance
