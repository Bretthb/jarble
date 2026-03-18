#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Install Kata Containers + Cloud Hypervisor on a Bare-Metal Server
#
# Kata Containers provides MicroVM isolation — each pod runs in a lightweight
# virtual machine with its own kernel. Cloud Hypervisor is the VMM backend,
# chosen for its minimal attack surface and fast boot times.
#
# Prerequisites:
#   - Ubuntu 22.04+ on bare-metal hardware (NOT a VPS)
#   - /dev/kvm available (hardware virtualization support)
#   - K3s agent already installed and joined to the cluster
#   - Root access
#   - x86_64 architecture
#
# Usage:
#   ssh root@<dedicated-server-ip> 'bash -s' < install-kata.sh
#
# What this script does:
#   1. Verifies /dev/kvm is present (bare-metal requirement)
#   2. Downloads and installs Kata Containers static build
#   3. Downloads Cloud Hypervisor binary
#   4. Configures K3s containerd with a kata-clh runtime handler
#   5. Labels the node for kata scheduling
#   6. Restarts K3s agent
#
# After running, apply the RuntimeClass via Terraform:
#   terraform apply -var="enable_kata=true"
#
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

KATA_VERSION="${KATA_VERSION:-3.2.0}"
CLH_VERSION="${CLH_VERSION:-v39.0}"

# ─── Preflight Checks ───────────────────────────────────────────────────────

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: This script must be run as root"
  exit 1
fi

ARCH=$(uname -m)
if [ "$ARCH" != "x86_64" ]; then
  echo "ERROR: Kata Containers only supports x86_64 (detected: $ARCH)"
  exit 1
fi

if [ ! -c /dev/kvm ]; then
  echo "ERROR: /dev/kvm not found."
  echo ""
  echo "Kata Containers requires bare-metal hardware with KVM support."
  echo "This script cannot run on a standard VPS (Hetzner Cloud, etc.)."
  echo ""
  echo "Check virtualization support:"
  echo "  grep -E 'vmx|svm' /proc/cpuinfo"
  echo ""
  echo "If running on dedicated hardware, ensure KVM modules are loaded:"
  echo "  modprobe kvm"
  echo "  modprobe kvm_amd   # or kvm_intel"
  exit 1
fi

if ! systemctl is-active --quiet k3s-agent && ! systemctl is-active --quiet k3s; then
  echo "ERROR: K3s is not running on this node"
  echo "Install K3s agent first, then re-run this script."
  exit 1
fi

echo "=== Installing Kata Containers $KATA_VERSION + Cloud Hypervisor $CLH_VERSION ==="
echo ""

# ─── Install Kata Containers ────────────────────────────────────────────────

echo "Downloading Kata Containers static build..."
curl -fsSL "https://github.com/kata-containers/kata-containers/releases/download/$KATA_VERSION/kata-static-$KATA_VERSION-$ARCH.tar.xz" \
  -o /tmp/kata-static.tar.xz

echo "Extracting to /opt/kata/..."
tar xf /tmp/kata-static.tar.xz -C /
rm /tmp/kata-static.tar.xz

# Symlink kata binaries to PATH
ln -sf /opt/kata/bin/kata-runtime /usr/local/bin/kata-runtime
ln -sf /opt/kata/bin/containerd-shim-kata-v2 /usr/local/bin/containerd-shim-kata-v2

# Verify
kata-runtime --version
echo "✓ Kata Containers $KATA_VERSION installed"

# ─── Install Cloud Hypervisor ────────────────────────────────────────────────

echo "Downloading Cloud Hypervisor $CLH_VERSION..."
curl -fsSL "https://github.com/cloud-hypervisor/cloud-hypervisor/releases/download/$CLH_VERSION/cloud-hypervisor-static" \
  -o /opt/kata/bin/cloud-hypervisor
chmod +x /opt/kata/bin/cloud-hypervisor

# Verify
/opt/kata/bin/cloud-hypervisor --version
echo "✓ Cloud Hypervisor $CLH_VERSION installed"

# ─── Configure containerd ──────────────────────────────────────────────────

echo "Configuring containerd for kata-clh handler..."

CONTAINERD_CONFIG="/var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl"
mkdir -p "$(dirname "$CONTAINERD_CONFIG")"

# Check if kata config already exists
if grep -q "runtimes.kata-clh" "$CONTAINERD_CONFIG" 2>/dev/null; then
  echo "✓ containerd already configured for kata-clh — skipping"
else
  if [ ! -f "$CONTAINERD_CONFIG" ]; then
    cat > "$CONTAINERD_CONFIG" <<'HEADER_EOF'
# K3s containerd config template
version = 2

[plugins."io.containerd.internal.v1.opt"]
  path = "/var/lib/rancher/k3s/agent/containerd"

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc]
  runtime_type = "io.containerd.runc.v2"

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
  SystemdCgroup = true
HEADER_EOF
  fi

  cat >> "$CONTAINERD_CONFIG" <<'KATA_EOF'

# Kata Containers with Cloud Hypervisor
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata-clh]
  runtime_type = "io.containerd.kata.v2"
  privileged_without_host_devices = true
  [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata-clh.options]
    ConfigPath = "/opt/kata/share/defaults/kata-containers/configuration-clh.toml"
KATA_EOF

  echo "✓ kata-clh handler added to containerd config"
fi

# ─── Label Node ─────────────────────────────────────────────────────────────

echo "Labeling node for Kata scheduling..."

# Get this node's hostname
NODE_NAME=$(hostname)

# If kubectl is available on this node (K3s server), label directly
# Otherwise, print instructions for labeling from the master
if command -v kubectl &>/dev/null && kubectl get nodes &>/dev/null 2>&1; then
  kubectl label node "$NODE_NAME" "jarble.ai/runtime-capable=kata" --overwrite
  kubectl label node "$NODE_NAME" "jarble.ai/server-type=dedicated" --overwrite
  echo "✓ Node labeled: jarble.ai/runtime-capable=kata"
else
  echo ""
  echo "NOTE: kubectl not available on this node (agent-only)."
  echo "Label the node from the master:"
  echo "  kubectl label node $NODE_NAME jarble.ai/runtime-capable=kata --overwrite"
  echo "  kubectl label node $NODE_NAME jarble.ai/server-type=dedicated --overwrite"
fi

# ─── Restart K3s ────────────────────────────────────────────────────────────

echo "Restarting K3s agent to apply containerd changes..."

if systemctl is-active --quiet k3s; then
  systemctl restart k3s
  echo "✓ K3s server restarted"
elif systemctl is-active --quiet k3s-agent; then
  systemctl restart k3s-agent
  echo "✓ K3s agent restarted"
fi

# ─── Verify ─────────────────────────────────────────────────────────────────

sleep 5

echo ""
echo "=== Kata Installation Complete ==="
echo ""
echo "Verify from the master node:"
echo "  kubectl get nodes -l jarble.ai/runtime-capable=kata"
echo "  kubectl get runtimeclass"
echo ""
echo "Test Kata isolation:"
echo "  kubectl run kata-test --image=busybox --rm -it --restart=Never \\"
echo "    --overrides='{\"spec\":{\"runtimeClassName\":\"kata-clh\"}}' -- uname -a"
echo ""
echo "Expected: uname should show a Kata kernel version, not the host kernel"
