# K8s Local Testing Notes

## Current Status (2026-02-19)

### What We're Testing
- End-to-end deployment flow from Next.js frontend through K8s pod creation
- WhatsApp QR code pairing flow via OpenClaw

### Current Issue: QR Code Not Scannable
The WhatsApp QR code displays in the frontend but is NOT scannable by WhatsApp. We've tried:
1. **Canvas rendering** - Parsing ASCII art and rendering to canvas (didn't work)
2. **Inverted colors** - Inverting the parsing logic (didn't work)
3. **Terminal-style display** - White text on black background (current approach, still not working)

**Root cause theory**: The ASCII art QR codes from OpenClaw use unicode block characters (▄█▀) which don't render cleanly at small font sizes in browsers. The anti-aliasing and font rendering create noise instead of clean squares.

### Potential Solutions to Try
1. **Proxy OpenClaw's web UI** - OpenClaw has a built-in web UI at port 18789 with proper QR rendering
2. **Get raw QR data from Baileys** - The underlying WhatsApp library outputs raw QR strings before ASCII conversion
3. **Use a QR code image library** - Generate PNG/SVG on the server side
4. **Larger font size** - Try rendering at 8-10px instead of 6px

---

## Local K8s Environment Setup

### Prerequisites
- Docker Desktop running
- k3d installed (`choco install k3d` or `scoop install k3d`)
- kubectl installed and configured

### Cluster Setup (Already Done)
```bash
# Create k3d cluster (already exists)
k3d cluster create jarble --servers 1 --agents 0

# Verify cluster
kubectl --context k3d-jarble get nodes
```

### Required Namespaces
```bash
kubectl --context k3d-jarble create ns jarble
kubectl --context k3d-jarble create ns jarble-bots
```

### Storage Class (Already Created)
The cluster has a `longhorn` storage class mapped to `local-path`:
```bash
kubectl --context k3d-jarble get storageclasses
```

### GHCR Pull Secret
For pulling OpenClaw images from GitHub Container Registry:
```bash
kubectl --context k3d-jarble create secret docker-registry ghcr-pull-secret \
  --docker-server=ghcr.io \
  --docker-username=YOUR_GITHUB_USERNAME \
  --docker-password=YOUR_GITHUB_PAT \
  -n jarble
```

---

## Running the Services

### Terminal 1: API Server
```bash
cd jarble-api-main
set USE_SQLITE=true
npm run dev
```
- Runs on port 3001
- Uses in-memory SQLite (resets on restart)
- Debug endpoints at `/debug/db`, `/debug/deployment/:id/status`

### Terminal 2: Frontend
```bash
cd Jarble-mvp
npm run dev
```
- Runs on port 3000

---

## Testing Deployment Flow

### 1. Create Deployment via Wizard
- Go to http://localhost:3000
- Login with Auth0
- Create new deployment (OpenClaw runtime)

### 2. Fix Deployment Status (SQLite workaround)
Since the K8s deployment happens async and SQLite is in-memory, status may not update:
```bash
# Check deployment ID from API logs
# Then manually update status:
curl -X POST http://localhost:3001/debug/deployment/DEPLOYMENT_ID/status \
  -H "Content-Type: application/json" \
  -d '{"status":"running"}'
```

### 3. Enable WhatsApp Plugin in Pod
```bash
# Get pod name
kubectl --context k3d-jarble get pods -n jarble

# Enable WhatsApp (use the correct path!)
kubectl --context k3d-jarble exec -n jarble POD_NAME -- \
  sh -c "cd /data/runtime && node node_modules/openclaw/openclaw.mjs plugins enable whatsapp"

# Restart pod to apply
kubectl --context k3d-jarble delete pod POD_NAME -n jarble
```

### 4. Test QR Code
- Click "Connect WhatsApp" in the deployment config page
- QR code should appear (but currently not scannable)

---

## Key Files Modified

### Frontend
- `Jarble-mvp/components/WhatsAppQrModal.tsx` - QR code modal display
- `Jarble-mvp/hooks/useQrStream.ts` - SSE stream for QR data
- `Jarble-mvp/lib/asciiQrToCanvas.ts` - ASCII art to canvas conversion (not working)

### API
- `jarble-api-main/src/index.ts` - WhatsApp QR streaming endpoint at `/api/deployments/:id/whatsapp/qr`
- `jarble-api-main/src/k8s/deployment.ts` - K8s deployment creation (namespace: `jarble`)

---

## Common Issues & Fixes

### Port 3001 Already in Use
```bash
netstat -ano | findstr :3001
taskkill //F //PID <PID>
```

### Insufficient CPU for New Pods
```bash
# Delete old deployments
kubectl --context k3d-jarble delete deployment dep-XXXXX -n jarble
```

### Pod Stuck in Pending
```bash
kubectl --context k3d-jarble describe pod POD_NAME -n jarble
# Check Events section for reason
```

### WhatsApp Plugin Not Working
Make sure to:
1. Enable the plugin: `npx openclaw plugins enable whatsapp`
2. Restart the pod (delete it, deployment will recreate)

---

## OpenClaw QR Code Output Format

The CLI command `npx openclaw channels login --channel whatsapp` outputs ASCII art like:
```
▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
█ ▄▄▄▄▄ █▄ █ ▄ ▄▀▄▄█▀ ▀█▀▄▀    ▄▀▀▀ █▄▄▄██ ▄   ▄ ██ ▄▄▄▄▄ █
█ █   █ ██▀██  ▀ ▀▀ ▄▀█▀▀▀ ▀ ▀ ▄▀ ▀ ▀▀▀▀  ██ ▀▄▄ ██ █   █ █
...
```

Characters used:
- `█` (full block) - represents filled area
- `▀` (upper half block)
- `▄` (lower half block)
- ` ` (space) - represents empty area

The challenge is rendering these cleanly in a browser at sizes small enough to be a scannable QR code.

---

## Next Steps

1. **Try OpenClaw Web UI proxy** - Add an API endpoint that proxies the OpenClaw web UI (port 18789)
2. **Investigate Baileys raw QR** - Check if we can intercept raw QR data before ASCII conversion
3. **Try server-side QR generation** - Parse ASCII on server and generate PNG
4. **Test with larger font sizes** - May need 10px+ to render cleanly
