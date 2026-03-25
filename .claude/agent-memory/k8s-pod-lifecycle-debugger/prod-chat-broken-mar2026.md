# Production Chat Broken -- March 25, 2026

## Deployment: zc1z2smcja4w (tt1)

### Symptoms
- Pod shows 1/1 Running, 0 restarts
- Diagnostics: Pod OK, DB OK, Gateway "Reachable", Storage "Could not read", Exec "Could not exec"
- Chat messages get no response -- user sees "Sorry, I couldn't reach the bot"
- Restart shows "provisioning" then comes back but still broken

### Root Cause 1: OpenClaw WS Origin Rejection (PRIMARY)

**File**: `jarble-api-main/src/services/openclawGateway.ts` line 127-130
```js
const ws = new WebSocket(wsUrl, {
  origin: "http://localhost",
  handshakeTimeout: 10_000,
});
```

The API connects to the pod at `ws://10.42.x.x:18789` with origin `"http://localhost"`.
OpenClaw validates the Origin header and rejects it because `http://localhost` does not match the Host header.

The config sets `dangerouslyAllowHostHeaderOriginFallback: true`, but this flag only activates when NO Origin header is present. Since the API explicitly sets one, the flag doesn't help.

**Fix**: Either remove the `origin` option entirely (let the flag work), or set it to match the pod IP:
```js
const ws = new WebSocket(wsUrl, {
  // No origin header -- let dangerouslyAllowHostHeaderOriginFallback handle it
  handshakeTimeout: 10_000,
});
```

### Root Cause 2: K3s Exec RBAC (pods/exec needs 'get' verb)

**File**: `jarble-api-main/k8s/deployment.yaml` lines 17-18
```yaml
- apiGroups: [""]
  resources: ["pods/exec"]
  verbs: ["create"]       # <-- Missing "get"
```

K3s v1.29 checks the `get` verb on the initial GET+Upgrade request for WebSocket exec.
The `@kubernetes/client-node` `Exec` class uses GET with Upgrade headers.
Standard K8s maps this to `create`, but K3s v1.29 requires `get` too.

**Confirmed fix**: Adding `get` to pods/exec verbs resolves the 403.
Already patched on the live cluster during investigation.

### Root Cause 3: No Exec Fallback for Auth Errors

**File**: `jarble-api-main/src/routes/tamboAgent.ts` line 1347
```js
const isConnectionError = /ETIMEDOUT|ECONNREFUSED|ECONNRESET|handshake|closed before auth/i.test(e.message);
```

The error "Gateway auth failed: origin not allowed (...)" does not match this regex.
So when the WS gateway fails with an origin error, the code hits `break` (line 1365)
and goes to "All attempts failed" without ever trying the exec fallback.

**Fix**: Add `auth failed|origin not allowed` to the regex, or make the fallback more inclusive.

### Impact Chain
1. Chat request -> getPodAddress returns valid IP + port + token
2. chatViaGateway opens WS to pod IP -> connects OK (7ms)
3. OpenClaw sends connect.challenge -> API sends connect with Ed25519 auth
4. OpenClaw rejects: origin "http://localhost" not allowed
5. Error thrown: "Gateway auth failed: origin not allowed (...)"
6. isConnectionError regex doesn't match -> no exec fallback
7. "All attempts failed" -> user sees error message
8. Even if fallback triggered, exec would also fail (403) due to RBAC issue

### Diagnostic Checks Explained
- "Could not read storage": getDeploymentStorageUsage uses exec (df command) -> 403
- "Could not exec into pod": diagnose.ts exec check -> 403
- "Gateway: Reachable": getPodAddress only checks pod exists + has IP, doesn't test WS auth

### Timeline
- Cluster deployed ~14h before investigation
- RBAC manifest applied from k8s/deployment.yaml (missing get on pods/exec)
- First chat attempt: immediate origin rejection
- All subsequent attempts: same pattern
- exec 403 prevents any fallback or diagnostic exec
