# Bugs & Fixes Log (K8s Local Testing — Feb 2026)

## Fixed Bugs

### 1. `execInPodWithStdin` writes 0 bytes (CRITICAL)
**File**: `jarble-api-main/src/k8s/deployment.ts:966`
**Symptom**: `/data/config/openclaw.json` written as 0-byte file
**Root cause**: Used raw websocket `ws.send()` + `ws.close()` in immediate succession. The websocket closed before stdin data was flushed. Also passed `null` for stdin param, so the K8s exec API didn't set up a stdin channel.
**Fix**: Replaced with a proper `stream.Readable` passed as the stdin parameter to `exec.exec()`. Removed the raw websocket `.then(ws => ...)` approach entirely.

### 2. SQLite in-memory DB wiped on server restart
**File**: `jarble-api-main/src/db/index.ts:32`
**Symptom**: Every tsx watch restart lost all deployment data, platform credentials, user sessions
**Root cause**: `new Database(":memory:")` — in-memory SQLite doesn't persist
**Fix**: Changed to `new Database(dbPath)` using file-based `local.db` in project root

### 3. Claude Max OAuth tokens (`sk-ant-oat*`) validation fails
**File**: `jarble-api-main/src/trpc/routers/openrouter.ts:71`
**Symptom**: "Invalid API key" error in wizard for Claude Max subscription tokens
**Root cause**: Anthropic's `/v1/models` endpoint returns 401 for OAuth tokens regardless of auth method (Bearer or x-api-key). These tokens are valid but can't be validated via the standard API.
**Fix**: Auto-pass tokens with `sk-ant-oat` prefix before making any API call. Also added Bearer auth header support for these tokens in the Anthropic validation case.

### 4. Debug endpoint missing `platformCredentials` table
**File**: `jarble-api-main/src/index.ts:1013`
**Symptom**: `/debug/db` showed 0 platformCredentials even when rows existed
**Root cause**: The debug endpoint didn't query the `platformCredentials` table
**Fix**: Added `const platCreds = await db.query.platformCredentials.findMany()` and included in response

### 5. OpenClaw dmPolicy fallback allowed "open" mode
**File**: `jarble-api-main/src/runtimes/handlers/openclaw.ts:101`
**Symptom**: Grace window approach (`dmPolicy: "open"`) didn't work reliably
**Root cause**: Config used `creds.dmPolicy || channelConfig.dmPolicy || "pairing"` which allowed the saved "open" value through
**Fix**: Hardcoded `channelConfig.dmPolicy = "pairing"` for Discord/Telegram — always use pairing mode

## Known Issues (Unfixed)

### A. npm cache corruption on PVC (`ENOTEMPTY`)
**Symptom**: Pod crashes with `ENOTEMPTY: directory not empty, rename '/data/.npm/_npx/...'`
**Root cause**: Concurrent npm operations on Longhorn PVC, possibly interrupted installs leaving locked directories
**Workaround**: `rm -rf /data/.npm /data/runtime/node_modules /data/.initialized` then delete pod
**Proper fix needed**: Entrypoint should clear npm cache on failed install, or use a pre-built image with openclaw baked in

### B. Deployment status stuck at "creating"
**Symptom**: DB shows `status: "creating"` even when pod is Running (1/1)
**Root cause**: The deployment creation poller times out during the slow npm install phase (2-3 min). The status update code runs after polling completes, but by then the pod may have crashed and restarted.
**Workaround**: Debug endpoint `POST /debug/deployment/:id/status` to manually set
**Proper fix needed**: Background status reconciliation job that periodically checks K8s pod status and updates DB

### C. ConfigSync partial failure — writes files but doesn't update Secret
**Symptom**: `/data/config/openclaw.json` has correct content but K8s Secret missing `TELEGRAM_BOT_TOKEN`
**Root cause**: `updateDeploymentSecret` may throw (K8s API error) after `writeConfigsToPvc` succeeds. The catch block only sets error on DB if status is "creating" (which it isn't yet at that point).
**Proper fix needed**: Better error handling in configSync — either atomic success or rollback. Consider separate try/catch for each step.

### D. OpenClaw ignores model from openclaw.json
**Symptom**: Gateway shows `agent model: anthropic/claude-opus-4-6` regardless of config
**Root cause**: OpenClaw gateway uses its own default model selection, overriding the JSON config. It reads from env vars instead.
**Impact**: Model selection works via K8s Secret (`LLM_MODEL` env var), not via openclaw.json

### E. Config path mismatch (configSync vs OpenClaw)
**Symptom**: configSync writes to `/data/config/openclaw.json`, OpenClaw reads from `/data/.openclaw/openclaw.json`
**Impact**: Channel enable/disable via openclaw.json doesn't take effect. OpenClaw relies on env vars for actual credentials.
**Note**: This is acceptable for now because OpenClaw's "doctor" auto-detects tokens from env vars and enables channels automatically.

### F. Telegram bot token conflict (409)
**Symptom**: Two pods using the same Telegram bot token causes HTTP 409 from Telegram API
**Root cause**: Multiple deployments configured with the same bot token, or stale deployments still running
**Fix**: Scale down conflicting deployments, or implement a check for token uniqueness
