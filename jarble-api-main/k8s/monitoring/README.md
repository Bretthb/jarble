# Jarble Monitoring Stack

Prometheus + Grafana monitoring for the Jarble cluster.

## Quick Start

```bash
# Install everything
kubectl apply -f namespace.yaml
kubectl apply -f node-exporter.yaml
kubectl apply -f kube-state-metrics.yaml
kubectl apply -f prometheus.yaml
kubectl apply -f grafana.yaml

# Wait for pods to be ready
kubectl get pods -n monitoring -w
```

## Access Dashboards

**Grafana** (main dashboards):
```bash
kubectl port-forward -n monitoring svc/grafana 3000:3000
# Open http://localhost:3000
# Login: admin / admin (change on first login!)
```

**Prometheus** (raw metrics, debugging):
```bash
kubectl port-forward -n monitoring svc/prometheus 9090:9090
# Open http://localhost:9090
```

## What's Monitored

### Node Metrics (via node-exporter)
- CPU usage per core
- Memory usage (total, available, cached)
- Disk I/O and usage
- Network traffic

### Kubernetes Metrics (via kube-state-metrics)
- Pod counts by namespace/status
- Deployment replicas (desired vs available)
- Container restart counts
- PVC capacity and usage

### Alerts (built-in)
| Alert | Threshold | Description |
|-------|-----------|-------------|
| HighNodeCPU | >80% for 5m | Time to add capacity |
| HighNodeMemory | >85% for 5m | Time to add capacity |
| NodeDiskAlmostFull | >85% | Disk cleanup needed |
| PodCrashLooping | >3 restarts in 15m | Investigate pod |
| PodNotReady | not ready for 10m | Investigate pod |

## Key Metrics for Scaling

**When to add another node:**
- `avg(100 - rate(node_cpu_seconds_total{mode="idle"}[5m]) * 100) > 70` - CPU above 70%
- `(1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)) > 0.8` - Memory above 80%
- Many pods in Pending state due to insufficient resources

**Query examples in Prometheus:**
```promql
# Total running bots
sum(kube_pod_status_phase{phase="Running", namespace="jarble"})

# Bot pods CPU usage
sum(rate(container_cpu_usage_seconds_total{namespace="jarble"}[5m])) by (pod)

# Bot pods memory usage
sum(container_memory_usage_bytes{namespace="jarble"}) by (pod)

# Pods with high restart count
kube_pod_container_status_restarts_total{namespace="jarble"} > 5
```

## Production Considerations

1. **Persistence**: Add PVCs for Prometheus and Grafana data
2. **Alertmanager**: Deploy for email/Slack/Discord alerts
3. **Ingress**: Expose Grafana via Ingress with auth
4. **Retention**: Adjust `--storage.tsdb.retention.time` in Prometheus

## Uninstall

```bash
kubectl delete -f grafana.yaml
kubectl delete -f prometheus.yaml
kubectl delete -f kube-state-metrics.yaml
kubectl delete -f node-exporter.yaml
kubectl delete -f namespace.yaml
```
