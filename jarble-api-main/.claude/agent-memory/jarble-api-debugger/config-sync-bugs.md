---
name: ConfigSync model switching bugs
description: Two bugs in model switching flow — stale .env on PVC after Tier 3 restart, and openclaw.json path mismatch
type: project
---

## Bugs Found (2026-03-17)

### Bug 1: Stale .env overrides K8s Secret envFrom after Tier 3 pod restart
- ConfigSync Tier 3 updates the K8s Secret (correct envFrom values) but does NOT write `.env` to the PVC
- The entrypoint sources `/data/config/.env` which has STALE values from a previous Tier 2 run
- This `source` overrides the correct K8s envFrom env vars, so the gateway starts with wrong model/provider
- **Fix**: Tier 3 should write `.env` to the PVC before triggering restart, or the entrypoint should prefer envFrom over .env

### Bug 2: openclaw.json path mismatch — renderConfigs writes to wrong location
- `renderConfigs` writes to `${home}/.openclaw/openclaw.json` → `/data/.openclaw/openclaw.json`
- OpenClaw gateway reads from `${home}/.openclaw/.openclaw/openclaw.json` → `/data/.openclaw/.openclaw/openclaw.json` (double .openclaw)
- ConfigSync writes to the wrong path; gateway never picks up the new model from the config file
- Only the env var route works (if .env is correct, which Bug 1 prevents)
- **Fix**: Change renderConfigs to write to `${home}/.openclaw/.openclaw/openclaw.json`

### Bug 3 (minor): No PID file on current image
- `/data/.openclaw.pid` doesn't exist on the running image, so Tier 2 (process restart) NEVER works
- Every secret change falls to Tier 3 (full pod restart), costing 30-60s downtime
- `signalProcessRestart` checks `/data/.openclaw.pid` but the correct path may be different

### Bug 4 (cosmetic): getPodConfig and diagnose read from wrong openclaw.json path
- Both read from `${home}/.openclaw/openclaw.json` (configSync-written file)
- This gives correct values for configSync's view, but DOESN'T reflect what the gateway actually uses
- May cause misleading "model match" results in diagnose

### Key Paths (legacy mode, HOME=/data)
- ConfigSync writes: `/data/config/.env`, `/data/config/openclaw.json`, `/data/.openclaw/openclaw.json`
- Gateway reads: `/data/.openclaw/.openclaw/openclaw.json`
- Entrypoint sources: `/data/config/.env`
- K8s Secret: mounted as envFrom on container
- PID file expected: `/data/.openclaw.pid` (doesn't exist on current image)

**How to apply:** When debugging model switch issues, always check the double-nested `.openclaw` path. When investigating configSync failures, check whether the Tier 2 PID file exists on the target image.
