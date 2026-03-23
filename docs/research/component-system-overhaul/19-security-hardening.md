# Sandbox Security Hardening — Implementation Plan

**Date**: 2026-02-28
**Agent**: security-hardener
**Status**: Complete

---

## Current State

CSP was already partially hardened (`default-src 'none'` with `TRUSTED_CDN_ORIGINS` allowlist). Better than initial research indicated.

## Remaining Vulnerabilities (7)

1. **`connect-src *`** — sandbox can `fetch()` ANY URL (data exfiltration)
2. **`img-src * data: blob:`** — tracking pixels from arbitrary domains
3. **`font-src * data:`** — font loading from arbitrary domains
4. **PostMessage uses `"*"` target origin** — no origin validation
5. **No `allow` attribute on iframe** — doesn't restrict browser APIs
6. **No watchdog timer** — infinite loops can't be killed
7. **Library URLs not checked against CDN allowlist at CSP level**

## New CSP Policy

```javascript
const csp = [
  `default-src 'none'`,
  `script-src 'unsafe-inline' 'unsafe-eval' ${cdnOrigins}`,
  `style-src 'unsafe-inline' ${cdnOrigins}`,
  `img-src ${cdnOrigins} data: blob:`,
  `font-src ${cdnOrigins} data:`,
  `media-src ${cdnOrigins} data: blob:`,
  `connect-src ${cdnOrigins}`,          // KEY: no more wildcard
  `worker-src blob:`,
  `frame-src 'none'`,
].join("; ");
```

## CDN Allowlist (10 domains)

| Domain | Justification |
|--------|--------------|
| `cdn.jsdelivr.net` | Primary npm CDN (Three.js, D3, Chart.js) |
| `cdnjs.cloudflare.com` | Second-largest CDN |
| `unpkg.com` | npm CDN mirror |
| `cdn.tailwindcss.com` | Tailwind CSS play CDN |
| `esm.sh` | ESM module CDN |
| `threejs.org` | Three.js official |
| `d3js.org` | D3.js official |
| `cdn.plot.ly` | Plotly.js CDN |
| `fonts.googleapis.com` | Google Fonts CSS |
| `fonts.gstatic.com` | Google Fonts files |

## Double-Iframe Architecture (Future)

For marketplace code components:
- **Outer iframe** (sandbox.jarble.ai): Different origin, server-controlled CSP
- **Inner iframe** (srcdoc): Opaque origin, maximum isolation
- **Bridge**: JSON-RPC 2.0 postMessage with origin validation

## Breaking Changes

| Scenario | Impact | Mitigation |
|----------|--------|------------|
| Sandbox `fetch()` to external APIs | BREAKS | Use MCP tools for data, pass via props |
| Non-CDN image URLs | BREAKS | Use base64 in props or proxy through bot |
| WebSocket to live feeds | BREAKS | Use MCP tools for live data |
| YouTube iframe embeds | BREAKS | Use `video` component instead |

## Migration Strategy

1. Deploy as `Content-Security-Policy-Report-Only` for 1 week
2. Monitor for violations
3. Switch to enforcing mode
4. Add server-side library URL validation (log-only first, then reject)
