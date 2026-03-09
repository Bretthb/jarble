"use client";

import { Shield } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

export default function SecurityPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Shield className="h-5 w-5" />
        </div>
        <h1 className="font-serif text-3xl font-medium tracking-tight">
          Security
        </h1>
      </div>

      {/* Overview */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
        <p className="text-muted-foreground leading-relaxed">
          Jarble follows a security-first design across every layer of the stack. User-generated code runs in sandboxed iframes with no same-origin access. Platform credentials are encrypted at rest with AES-256-GCM. Pods run as non-root with all Linux capabilities dropped. Every API input is validated with Zod schemas before processing.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          The architecture applies defense-in-depth: the same CDN allowlist is enforced both server-side (before data reaches the client) and client-side (in the sandbox CSP). Library URLs, HTML content, and component props all pass through independent validation layers.
        </p>
      </section>

      {/* Sandbox Security */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Sandbox Security</h2>
        <p className="text-muted-foreground leading-relaxed">
          Custom components that execute arbitrary HTML, CSS, and JavaScript run inside a sandboxed iframe. The iframe uses the <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">sandbox</code> attribute with a minimal permission set:
        </p>
        <pre className="bg-secondary rounded-lg p-4 text-sm font-mono overflow-x-auto">
{`sandbox="allow-scripts allow-popups"`}
        </pre>
        <p className="text-muted-foreground leading-relaxed">
          Notably, <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">allow-same-origin</code> is absent. This means the iframe runs at an opaque origin and cannot access the parent page&apos;s DOM, cookies, localStorage, or any same-origin APIs. Communication between the parent and sandbox happens exclusively through <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">postMessage</code> with a structured bridge protocol.
        </p>

        <h3 className="text-lg font-medium mt-4">Heartbeat Watchdog</h3>
        <p className="text-muted-foreground leading-relaxed">
          Every sandbox iframe sends a heartbeat ping to the parent every 5 seconds via <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">setInterval</code>. If the parent misses 3 consecutive heartbeats (15 seconds of silence), the sandbox is killed and a &quot;Sandbox timed out&quot; error is shown. This protects against infinite loops and runaway computation. Because <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">setInterval</code> continues firing regardless of user JavaScript execution, animations and long-running scripts do not trigger false timeouts.
        </p>

        <h3 className="text-lg font-medium mt-4">Error Rate Limiting</h3>
        <p className="text-muted-foreground leading-relaxed">
          When a sandbox component crashes, users can click &quot;Fix Component&quot; to send the error back to the bot for repair. To prevent infinite fix loops (where the bot keeps generating broken code), each card is limited to 3 fix attempts per 60-second window. After the limit is reached, the card shows a manual retry prompt instead of auto-sending to the bot.
        </p>
      </section>

      {/* Content Security Policy */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Content Security Policy</h2>
        <p className="text-muted-foreground leading-relaxed">
          Sandbox iframes inject a CSP meta tag that restricts which external resources can be loaded. Only scripts, styles, and fonts from 10 trusted CDN origins are permitted. The allowlist is centralized in a shared package and enforced in two places:
        </p>
        <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
          <li><strong>Server-side</strong>: The <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">uiBlockParser</code> validates library URLs against the allowlist before they reach the client. Untrusted URLs are stripped.</li>
          <li><strong>Client-side</strong>: The sandbox <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">buildDocument()</code> function constructs a CSP meta tag from the same allowlist, so even if a URL bypasses server validation, the browser will block it.</li>
        </ul>

        <h3 className="text-lg font-medium mt-4">Trusted CDN Origins</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Origin</TableHead>
              <TableHead>Purpose</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono text-sm">https://cdn.jsdelivr.net</TableCell>
              <TableCell>General-purpose CDN for npm packages.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">https://cdnjs.cloudflare.com</TableCell>
              <TableCell>Cloudflare-hosted open source libraries.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">https://unpkg.com</TableCell>
              <TableCell>npm package CDN.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">https://cdn.tailwindcss.com</TableCell>
              <TableCell>Tailwind CSS play CDN for sandbox styling.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">https://esm.sh</TableCell>
              <TableCell>ESM module CDN for modern JavaScript imports.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">https://threejs.org</TableCell>
              <TableCell>Three.js 3D visualization library.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">https://d3js.org</TableCell>
              <TableCell>D3.js data visualization library.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">https://cdn.plot.ly</TableCell>
              <TableCell>Plotly charting library.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">https://fonts.googleapis.com</TableCell>
              <TableCell>Google Fonts stylesheet loading.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">https://fonts.gstatic.com</TableCell>
              <TableCell>Google Fonts file serving.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      {/* Credential Encryption */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Credential Encryption</h2>
        <p className="text-muted-foreground leading-relaxed">
          All messaging platform tokens (Telegram, Discord, Slack, WhatsApp, Teams, Messenger) are encrypted before storage using AES-256-GCM authenticated encryption. Each encryption operation generates a random 16-byte initialization vector (IV), ensuring that identical plaintext values produce different ciphertext.
        </p>
        <pre className="bg-secondary rounded-lg p-4 text-sm font-mono overflow-x-auto">
{`// Encrypted format stored in the database:
enc:<iv-hex>:<auth-tag-hex>:<ciphertext-hex>

// Example:
enc:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6:f1e2d3c4b5a6...:<encrypted-data>

// Algorithm: AES-256-GCM
// Key: 32-byte (256-bit) from API_KEY_ENCRYPTION_KEY env var
// IV: 16 bytes, randomly generated per encryption
// Auth tag: 16 bytes, provides integrity verification`}
        </pre>
        <p className="text-muted-foreground leading-relaxed">
          The GCM auth tag provides integrity verification, preventing tampering with stored ciphertext. When credentials are returned to the frontend, they are decrypted server-side and then masked (first 4 and last 4 characters shown, middle replaced with asterisks).
        </p>
        <p className="text-muted-foreground leading-relaxed">
          In local development mode (when <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">API_KEY_ENCRYPTION_KEY</code> is not set), credentials are stored with a <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">plain:</code> prefix. The decryption path handles both formats gracefully.
        </p>
      </section>

      {/* Response Headers */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Response Headers</h2>
        <p className="text-muted-foreground leading-relaxed">
          The Next.js frontend applies security response headers to all routes via <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">next.config.ts</code>. The <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">X-Powered-By</code> header is also disabled to reduce information leakage.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Header</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Purpose</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono text-sm">X-Content-Type-Options</TableCell>
              <TableCell className="font-mono text-sm">nosniff</TableCell>
              <TableCell>Prevents browsers from MIME-type sniffing responses away from the declared content type.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">X-Frame-Options</TableCell>
              <TableCell className="font-mono text-sm">DENY</TableCell>
              <TableCell>Prevents the site from being embedded in iframes on other domains (clickjacking protection).</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">Strict-Transport-Security</TableCell>
              <TableCell className="font-mono text-sm whitespace-normal">max-age=63072000; includeSubDomains; preload</TableCell>
              <TableCell>Enforces HTTPS for 2 years across all subdomains with HSTS preload eligibility.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">Referrer-Policy</TableCell>
              <TableCell className="font-mono text-sm">strict-origin-when-cross-origin</TableCell>
              <TableCell>Sends the full URL as referrer for same-origin requests, only the origin for cross-origin.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">Permissions-Policy</TableCell>
              <TableCell className="font-mono text-sm whitespace-normal">camera=(), microphone=(), geolocation=(), payment=()</TableCell>
              <TableCell>Disables access to camera, microphone, geolocation, and Payment Request APIs.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      {/* Pod Security */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Pod Security</h2>
        <p className="text-muted-foreground leading-relaxed">
          Each bot deployment runs in an isolated Kubernetes pod with a hardened security context. The following measures are applied at the container level:
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Measure</TableHead>
              <TableHead>Configuration</TableHead>
              <TableHead>Purpose</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-semibold">Non-root user</TableCell>
              <TableCell className="font-mono text-sm">runAsUser: 1000, runAsGroup: 1000, runAsNonRoot: true</TableCell>
              <TableCell>Prevents container processes from running as root, limiting privilege escalation.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Drop all capabilities</TableCell>
              <TableCell className="font-mono text-sm">{`securityContext.capabilities.drop: ["ALL"]`}</TableCell>
              <TableCell>Removes all Linux capabilities (NET_RAW, SYS_ADMIN, etc.).</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Service account disabled</TableCell>
              <TableCell className="font-mono text-sm">automountServiceAccountToken: false</TableCell>
              <TableCell>Prevents pods from accessing the Kubernetes API.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Network policy</TableCell>
              <TableCell>Custom NetworkPolicy in jarble namespace</TableCell>
              <TableCell>Restricts egress to LLM API endpoints, messaging platforms, and DNS. Blocks cloud metadata (169.254.169.254) and localhost.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Liveness/readiness probes</TableCell>
              <TableCell className="font-mono text-sm">TCP probe on port 18789</TableCell>
              <TableCell>Detects unhealthy pods and triggers automatic restarts.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      {/* Authentication */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Authentication</h2>
        <p className="text-muted-foreground leading-relaxed">
          Authentication uses Auth0 with RS256-signed JWTs. The API verifies tokens on every request using JWKS (JSON Web Key Sets) fetched from the Auth0 domain. Key rotation is handled automatically by the JWKS client with caching.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          Every protected procedure enforces ownership checks. A user can only read, modify, or delete resources they own. For example, the deployment router verifies <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">deployment.userId === ctx.user.id</code> on every mutation. Marketplace operations verify creator profile ownership before allowing component or service modifications.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          Admin operations (marketplace moderation) are restricted to a hardcoded set of admin user IDs. This is an interim measure that will be replaced with role-based access control.
        </p>
      </section>

      {/* Input Validation */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Input Validation</h2>
        <p className="text-muted-foreground leading-relaxed">
          All tRPC procedure inputs are validated with Zod schemas. Invalid inputs are rejected with a <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">BAD_REQUEST</code> error before any business logic executes.
        </p>
        <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-2">
          <li>
            <strong>Server-side library URL validation</strong>: The <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">uiBlockParser</code> validates all library URLs in <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">jarble_ui</code> blocks against the CDN allowlist before forwarding to the client.
          </li>
          <li>
            <strong>HTML sanitization</strong>: User-facing HTML content is sanitized with DOMPurify on the client. The sandbox <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">sanitizeHtmlProp()</code> function extracts and validates embedded scripts and styles, stripping untrusted URLs.
          </li>
          <li>
            <strong>Component props validation</strong>: Every component rendered on the canvas passes through Zod schema validation. Props that fail validation are first run through the AutoFix repair pipeline (20 rules, 30+ aliases) before a second validation attempt.
          </li>
          <li>
            <strong>Manifest validation</strong>: Marketplace component submissions are validated against 13 rules covering manifest structure, <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">configSchema</code> correctness, and SDK version compatibility.
          </li>
        </ul>
      </section>

      {/* Component Expansion Limits */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Component Expansion Limits</h2>
        <p className="text-muted-foreground leading-relaxed">
          To prevent denial-of-service via excessively large component payloads, two hard limits are enforced:
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Limit</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Purpose</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-semibold">Maximum children</TableCell>
              <TableCell className="font-mono text-sm">50</TableCell>
              <TableCell>Caps the number of child elements in list-type components (stat_grid, data_table rows, etc.).</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Serialized size limit</TableCell>
              <TableCell className="font-mono text-sm">256 KB</TableCell>
              <TableCell>Maximum JSON-serialized size of a single component&apos;s props. Prevents memory exhaustion from very large data payloads.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
