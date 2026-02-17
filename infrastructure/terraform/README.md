# Jarble K3s Cluster — Terraform

Provisions a K3s cluster on Hetzner Cloud with Longhorn storage and Traefik ingress.

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5
- [Hetzner Cloud API token](https://console.hetzner.cloud/projects) (project → Security → API Tokens)
- SSH key pair (`ssh-keygen -t rsa -b 4096`)

## Quick Start

```bash
# 1. Copy and fill in your variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your Hetzner token

# 2. Initialize Terraform
terraform init

# 3. Preview what will be created
terraform plan

# 4. Create the cluster
terraform apply

# 5. Get your kubeconfig
scp root@<MASTER_IP>:/etc/rancher/k3s/k3s.yaml ./kubeconfig.yaml
sed -i 's/127.0.0.1/<MASTER_IP>/g' ./kubeconfig.yaml
export KUBECONFIG=./kubeconfig.yaml

# 6. Verify cluster
kubectl get nodes
```

## CI/CD Pipeline

Infrastructure changes are managed through GitHub Actions (`.github/workflows/terraform.yml`).
State is stored in [Terraform Cloud](https://app.terraform.io) (free tier) with locking.

### Automatic Triggers

- **Pull Request** — When files in `infrastructure/terraform/` change, the pipeline runs `fmt -check`, `validate`, and `plan`, posting the plan output as a PR comment.
- **Push to main** — When changes land on main, the pipeline runs plan + apply with a manual approval gate (requires approval in the GitHub UI).

### Manual Dispatch

Go to **Actions > Terraform > Run workflow** and select a mode:

| Mode | What it does |
|------|-------------|
| `plan-only` | Run plan without applying |
| `apply` | Run plan + apply (requires environment approval) |
| `destroy` | Destroy all infrastructure (requires confirmation string + approval) |

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `HCLOUD_TOKEN` | Hetzner Cloud API token |
| `TF_API_TOKEN` | Terraform Cloud API token (for remote state) |
| `SSH_PUBLIC_KEY` | SSH public key content for server access |

### Local Development

Local terraform commands still work — state is shared via Terraform Cloud:

```bash
terraform login   # One-time: authenticates with Terraform Cloud
terraform init
terraform plan
terraform apply
```

## Adding Worker Nodes

Change `agent_count` in `terraform.tfvars` and re-apply:

```bash
# Scale from 2 to 4 workers
# Edit terraform.tfvars: agent_count = 4
terraform apply
```

## What Gets Created

| Resource | Details |
|----------|---------|
| 1x Master node | K3s server, Traefik ingress, Longhorn |
| Nx Agent nodes | K3s agents (default: 2) |
| Private network | 10.0.0.0/16 for inter-node communication |
| Firewall | SSH, HTTP, HTTPS, K3s API, internal traffic |
| Floating IP | Static IP for DNS/ingress |

## DNS Setup

After `terraform apply`, point your DNS records:

```
api.jarble.ai  → <master_ip>
*.jarble.ai    → <master_ip>
```

## Deploying Jarble

After cluster is ready:

```bash
# Apply Jarble K8s manifests
kubectl apply -f ../../jarble-api-main/k8s/deployment.yaml

# Create secrets
kubectl create secret generic jarble-api-secrets \
  --namespace jarble \
  --from-literal=DATABASE_URL="your-db-url" \
  --from-literal=AUTH0_DOMAIN="jarble-dev.us.auth0.com" \
  --from-literal=AUTH0_AUDIENCE="https://api.jarble.ai" \
  --from-literal=OPENROUTER_API_KEY="your-key" \
  --from-literal=STRIPE_SECRET_KEY="your-key"
```

## Teardown

```bash
terraform destroy
```
