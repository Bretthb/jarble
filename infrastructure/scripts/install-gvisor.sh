#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Install gVisor (runsc) on a K3s Worker Node
#
# gVisor provides user-space kernel isolation for container workloads.
# It intercepts application syscalls and handles them in a sandboxed
# user-space kernel, preventing direct host kernel access.
#
# Prerequisites:
#   - Ubuntu 22.04 (or compatible Debian-based distro)
#   - K3s agent already installed and running
#   - Root access
#   - x86_64 architecture
#
# Usage:
#   ssh root@<worker-ip> 'bash -s' < install-gvisor.sh
#
# What this script does:
#   1. Installs the runsc binary from gVisor's APT repository
#   2. Configures K3s containerd to register a "runsc" runtime handler
#   3. Restarts K3s agent to pick up the new containerd config
#
# After running on all workers, apply the RuntimeClass via Terraform:
#   terraform apply -var="enable_gvisor=true"
#
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ─── Preflight Checks ───────────────────────────────────────────────────────

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: This script must be run as root"
  exit 1
fi

ARCH=$(uname -m)
if [ "$ARCH" != "x86_64" ]; then
  echo "ERROR: gVisor only supports x86_64 (detected: $ARCH)"
  exit 1
fi

if ! systemctl is-active --quiet k3s-agent && ! systemctl is-active --quiet k3s; then
  echo "ERROR: K3s is not running on this node"
  exit 1
fi

echo "=== Installing gVisor (runsc) ==="

# ─── Install runsc ──────────────────────────────────────────────────────────

echo "Adding gVisor APT repository..."
curl -fsSL https://gvisor.dev/archive.key | gpg --batch --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" \
  > /etc/apt/sources.list.d/gvisor.list

apt-get update -qq
apt-get install -y -qq runsc

# Verify installation
RUNSC_VERSION=$(runsc --version 2>&1 | head -1)
echo "✓ Installed: $RUNSC_VERSION"

# ─── Configure containerd ──────────────────────────────────────────────────

echo "Configuring containerd for gVisor..."

CONTAINERD_CONFIG="/var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl"
mkdir -p "$(dirname "$CONTAINERD_CONFIG")"

# Check if gVisor config already exists
if grep -q "runtimes.runsc" "$CONTAINERD_CONFIG" 2>/dev/null; then
  echo "✓ containerd already configured for runsc — skipping"
else
  # K3s uses a containerd config template. We append the runsc handler.
  # If the template doesn't exist yet, create it with the K3s default header.
  if [ ! -f "$CONTAINERD_CONFIG" ]; then
    cat > "$CONTAINERD_CONFIG" <<'HEADER_EOF'
# K3s containerd config template
# See: https://docs.k3s.io/advanced#configuring-containerd

version = 2

[plugins."io.containerd.internal.v1.opt"]
  path = "/var/lib/rancher/k3s/agent/containerd"

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc]
  runtime_type = "io.containerd.runc.v2"

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
  SystemdCgroup = true
HEADER_EOF
  fi

  cat >> "$CONTAINERD_CONFIG" <<'GVISOR_EOF'

# gVisor (runsc) runtime handler
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc]
  runtime_type = "io.containerd.runsc.v1"

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc.options]
  TypeUrl = "io.containerd.runsc.v1.options"
GVISOR_EOF

  echo "✓ runsc handler added to containerd config"
fi

# ─── Restart K3s ────────────────────────────────────────────────────────────

echo "Restarting K3s to apply containerd changes..."

# Detect whether this is a server or agent node
if systemctl is-active --quiet k3s; then
  systemctl restart k3s
  echo "✓ K3s server restarted"
elif systemctl is-active --quiet k3s-agent; then
  systemctl restart k3s-agent
  echo "✓ K3s agent restarted"
fi

# ─── Verify ─────────────────────────────────────────────────────────────────

sleep 5

# Quick test: run a container with gVisor
echo ""
echo "=== gVisor Installation Complete ==="
echo ""
echo "Verify from the master node:"
echo "  kubectl get nodes"
echo "  kubectl run gvisor-test --image=busybox --rm -it --restart=Never \\"
echo "    --overrides='{\"spec\":{\"runtimeClassName\":\"gvisor\"}}' -- dmesg | head"
echo ""
echo "Expected: dmesg output should show 'Starting gVisor' instead of the host kernel"
