# K3s + Longhorn Terraform

Deploy a production-ready K3s cluster with Longhorn distributed storage on Hetzner Cloud.

## What Gets Created

```
┌─────────────────────────────────────────────────────────────┐
│  Hetzner Cloud                                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ Control Plane   │  │ Worker 1        │  │ Worker 2     │ │
│  │ cx32 (~€8/mo)   │  │ cx43 (~€16/mo)  │  │ cx43         │ │
│  │                 │  │                 │  │              │ │
│  │ • K3s Server    │  │ • K3s Agent     │  │ • K3s Agent  │ │
│  │ • Traefik       │  │ • Longhorn      │  │ • Longhorn   │ │
│  │ • Longhorn      │  │ • Bot Pods      │  │ • Bot Pods   │ │
│  └────────┬────────┘  └────────┬────────┘  └──────┬───────┘ │
│           │                    │                   │         │
│           └────────────────────┴───────────────────┘         │
│                    Private Network (10.0.0.0/16)             │
└─────────────────────────────────────────────────────────────┘

Total: ~€40/mo for 10 bots capacity
```

## Quick Start

### 1. Prerequisites

```bash
# Install Terraform
brew install terraform  # macOS
# or: https://developer.hashicorp.com/terraform/downloads

# Install kubectl
brew install kubectl

# Get Hetzner API token
# https://console.hetzner.cloud/projects/*/security/tokens
```

### 2. Configure

```bash
cd infra/k3s-terraform

# Copy example config
cp terraform.tfvars.example terraform.tfvars

# Edit with your values
nano terraform.tfvars
```

### 3. Deploy

```bash
# Initialize Terraform
terraform init

# Preview changes
terraform plan

# Deploy everything (~10 minutes)
terraform apply
```

### 4. Use the Cluster

```bash
# Set kubeconfig
export KUBECONFIG=$(pwd)/kubeconfig.yaml

# Verify nodes
kubectl get nodes
# NAME             STATUS   ROLES                  AGE   VERSION
# jarble-control   Ready    control-plane,master   5m    v1.28.5+k3s1
# jarble-worker-1  Ready    <none>                 3m    v1.28.5+k3s1
# jarble-worker-2  Ready    <none>                 3m    v1.28.5+k3s1

# Verify Longhorn
kubectl -n longhorn-system get pods

# Check storage class
kubectl get storageclass
# NAME                 PROVISIONER          AGE
# longhorn (default)   driver.longhorn.io   2m
```

### 5. Deploy a Bot

```bash
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: bot-test-pvc
  namespace: jarble
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: longhorn
  resources:
    requests:
      storage: 2Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bot-test
  namespace: jarble
spec:
  replicas: 1
  selector:
    matchLabels:
      app: bot-test
  template:
    metadata:
      labels:
        app: bot-test
    spec:
      containers:
      - name: bot
        image: jarble/bot:base
        volumeMounts:
        - name: workspace
          mountPath: /app/workspace
      volumes:
      - name: workspace
        persistentVolumeClaim:
          claimName: bot-test-pvc
EOF
```

## Scaling

### Add More Workers

```hcl
# In terraform.tfvars
worker_count = 4  # Change from 2 to 4
```

```bash
terraform apply
```

### Upgrade Server Types

```hcl
# Bigger workers for more bots per node
worker_type = "cx53"  # 16 vCPU, 32GB = 8 bots each
```

## Costs

| Config | Nodes | Bot Capacity | Monthly Cost |
|--------|-------|--------------|--------------|
| Minimal | 1 control + 1 worker | 6 bots | ~€24/mo |
| Standard | 1 control + 2 workers | 10 bots | ~€40/mo |
| Growth | 1 control + 4 workers | 18 bots | ~€72/mo |
| Scale | 1 control + 8 workers | 34 bots | ~€136/mo |

## Destroy

```bash
terraform destroy
```

## Troubleshooting

### Nodes not joining
```bash
# Check K3s token on control plane
ssh root@<CONTROL_IP> cat /var/lib/rancher/k3s/server/node-token

# Check K3s agent logs on worker
ssh root@<WORKER_IP> journalctl -u k3s-agent -f
```

### Longhorn issues
```bash
# Check Longhorn pods
kubectl -n longhorn-system get pods

# Check storage
kubectl get pv,pvc -A
```

### Reset and retry
```bash
terraform destroy
terraform apply
```
