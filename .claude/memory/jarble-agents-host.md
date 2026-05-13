---
name: jarble-agents host IP
description: SSH/host IP for the jarble-agents node in the Hetzner K3s cluster
type: reference
originSessionId: 6682e5b7-6cc5-4401-8126-644209832680
---
`jarble-agents` node is at **178.156.231.154**.

SSH:
```bash
ssh -i ~/.ssh/id_ed25519 root@178.156.231.154
```

**Key gotcha:** `jarble-agents` uses `~/.ssh/id_ed25519` (NOT `id_ed25519_hetzner`). The `_hetzner` key works on `jarble-master` (178.156.230.13) but is rejected on `jarble-agents`. Verified 2026-05-02 via verbose SSH (key offered, server returned `Permission denied (publickey,password)` for the `_hetzner` key but accepted `id_ed25519`).

Related: K3s master is at `178.156.230.13`. Auth is SSH key only — no passwords stored per the Secret Handling rule.
