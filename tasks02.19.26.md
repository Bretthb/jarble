# Tasks - 02/19/26

## Pending

### 1. Fix Telegram pairing flow and make it smoother
Current issues with Telegram pairing:
- The "starting" phase polls for pod readiness but UX could be improved
- Config file write to PVC times out (30s) due to kubectl exec stdin issues
- User has to wait for pod restart before pairing becomes available

Improvements needed:
- Investigate why execInPodWithStdin hangs (WebSocket/stdin handling)
- Add better progress indicators during bot startup
- Consider pre-warming or caching npm install to speed up first boot
- Ensure auto-approve pairing flow works reliably end-to-end

---

### 2. Add re-pair/repair option in deployment config mode
Allow users to re-pair platforms from the DeploymentConfiguration sidebar (config mode), not just during initial onboarding.

Requirements:
- Add "Reconnect" or "Re-pair" button for connected platforms in config tab
- For Telegram: trigger new pairing flow without losing existing config
- For WhatsApp: show QR code again for re-pairing
- Handle edge cases: what happens to existing conversations/state when re-pairing
- Update platformCredentials router to support re-pairing mutations

---

### 3. Research: Hot config reload vs pod restart for platform integration
Investigate whether OpenClaw supports hot-reloading platform credentials without requiring a full pod restart.

**Research questions:**
1. Does OpenClaw watch for config file changes and auto-reload?
2. Can we signal OpenClaw to reload config via the gateway API (port 18789)?
3. Can platform tokens be injected at runtime via the gateway or a management API?
4. What's the impact on active conversations during config reload vs restart?

**Current behavior:**
- configSync writes config to PVC + updates K8s Secret + restarts pod
- Pod restart takes 1-2 min on first boot, ~30s on subsequent boots
- This causes brief downtime for the bot

**Ideal behavior:**
- User adds platform credentials → bot picks them up within seconds
- No pod restart needed
- Existing conversations continue uninterrupted

**Check OpenClaw docs/code for:**
- File watcher behavior (already exists: /data/config watcher)
- Gateway management endpoints
- Plugin hot-reload capabilities

---

### 4. Investigate deployment deletion and K8s resource cleanup
Research and document what happens when a deployment is deleted from the Jarble platform.

**Questions to answer:**
1. Does deleting a deployment in the DB trigger K8s resource cleanup?
2. Are all 4 K8s resources properly deleted? (Deployment, Secret, PVC, Service)
3. What happens to the PVC data (conversation history, config)?
4. Is there a grace period or soft-delete before permanent removal?
5. What if the K8s delete fails - is the DB deletion rolled back?
6. Are there orphaned resources if deletion partially fails?

**Current K8s resources per deployment:**
- Deployment: `dep-{deploymentId}`
- Secret: `secret-{deploymentId}`
- PVC: `pvc-{deploymentId}` (20Gi Longhorn)
- Service: ClusterIP for inter-pod communication

**Check:**
- `deployment.ts` for delete functions
- `trpc/routers/deployment.ts` for delete mutation
- Any background cleanup/reconciler for orphaned resources

---

## Completed Today (02/19/26)

- [x] Fixed configSync to update K8s secret BEFORE PVC write
- [x] Added 30s timeout to execInPodWithStdin to prevent hangs
- [x] Made PVC config write failures non-fatal
- [x] Added "starting" phase UI for Telegram pairing in OnboardingWizard
- [x] Added debug endpoint `/debug/deployment/:id/sync-config`
- [x] Verified TELEGRAM_BOT_TOKEN now appears in K8s secrets
- [x] Confirmed Telegram pairing requests working
