"use client";

import { Cpu } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

export default function ArchitecturePage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Cpu className="h-5 w-5" />
        </div>
        <h1 className="font-serif text-3xl font-medium tracking-tight">
          Architecture
        </h1>
      </div>

      {/* System Overview */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">System Overview</h2>
        <p className="text-muted-foreground leading-relaxed">
          Jarble is a monorepo containing a Next.js 15 frontend, an Express + tRPC API backend, shared packages, and infrastructure configuration. Users interact with the frontend, which communicates with the API via type-safe tRPC calls. The API orchestrates Kubernetes pods that run bot runtimes with MCP servers for rich UI rendering.
        </p>
        <pre className="bg-secondary rounded-lg p-4 text-sm font-mono overflow-x-auto leading-relaxed">
{`Monorepo Structure
==================

develop-monorepo/
  |-- Jarble-mvp/              Next.js 15 frontend (App Router, React 19)
  |-- jarble-api-main/         Express + tRPC API backend
  |-- shared/
  |   |-- component-manifest/  Single source of truth for component metadata
  |-- scripts/                 CI/build scripts
  |-- infrastructure/          Terraform IaC + Auth0 config
  |-- runtimes/                Bot runtime implementations`}
        </pre>

        <h3 className="text-lg font-medium mt-4">Architecture Diagram</h3>
        <pre className="bg-secondary rounded-lg p-4 text-sm font-mono overflow-x-auto leading-relaxed">
{`                         +------------------+
                         |     Browser      |
                         |  (Next.js SSR +  |
                         |   React 19 SPA)  |
                         +--------+---------+
                                  |
                     tRPC (SuperJSON) + SSE streams
                                  |
                         +--------+---------+
                         |   Next.js 15     |
                         |   App Router     |
                         |   (port 3000)    |
                         +--------+---------+
                                  |
                         tRPC HTTP + REST
                                  |
                         +--------+---------+
                         |  Express + tRPC  |
                         |    API Server    |
                         |   (port 3001)    |
                         +---+----+----+----+
                             |    |    |
                  +----------+    |    +----------+
                  |               |               |
           +------+------+  +----+----+  +-------+-------+
           |   Drizzle   |  |  Stripe |  |   Auth0 JWKS  |
           |  ORM + DB   |  |   API   |  |  Verification |
           +-------------+  +---------+  +---------------+
                  |
        MySQL / PostgreSQL / SQLite
                             |
                    kubectl exec / K8s API
                             |
              +--------------+--------------+
              |         K8s Cluster         |
              |        (K3s / Hetzner)      |
              |                             |
              |  +------------------------+ |
              |  | Pod: dep-<id>          | |
              |  |                        | |
              |  |  +------------------+  | |
              |  |  | OpenClaw Runtime |  | |
              |  |  | (Node.js 22)     |  | |
              |  |  +--------+---------+  | |
              |  |           |            | |
              |  |  +--------+---------+  | |
              |  |  | MCP stdio Server |  | |
              |  |  | (jarble-ui-      |  | |
              |  |  |  server.js)      |  | |
              |  |  +------------------+  | |
              |  |                        | |
              |  |  PVC: /data/ (20Gi)    | |
              |  |  Secret: LLM keys +   | |
              |  |    platform tokens     | |
              |  +------------------------+ |
              +-----------------------------+`}
        </pre>
      </section>

      {/* Deployment Flow */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Deployment Flow</h2>
        <p className="text-muted-foreground leading-relaxed">
          When a user creates a new bot deployment, the system provisions four Kubernetes resources and boots the pod. The entire flow is orchestrated by the <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">deployment.create</code> tRPC mutation.
        </p>
        <pre className="bg-secondary rounded-lg p-4 text-sm font-mono overflow-x-auto leading-relaxed">
{`1. User submits wizard form (runtime, template, LLM provider, model)
       |
2. API creates deployment record in DB (status: "creating")
       |
3. API provisions 4 K8s resources in the "jarble" namespace:
       |-- Deployment: dep-<id>  (1 replica, container "runtime", port 18789)
       |-- Secret: secret-<id>  (LLM keys, platform tokens, deployment metadata)
       |-- PVC: pvc-<id>        (Longhorn, 20Gi RWO, mounted at /data)
       |-- Service: ClusterIP   (inter-pod communication)
       |
4. Pod boots:
       |-- Container image: ghcr.io/jarble-ai/openclaw:latest (Node.js 22)
       |-- Entrypoint runs npm install (first boot only, skipped if .initialized exists)
       |-- MCP server (jarble-ui-server.js) starts on stdio
       |-- OpenClaw gateway starts on port 18789
       |
5. API polls readiness probe (TCP 18789, 30 attempts x 2s = 60s max)
       |
6. API writes config files to PVC via kubectl exec:
       |-- /data/config/openclaw.json  (channel configs, agent model)
       |-- /data/config/soul.md        (system prompt + service snippets)
       |-- /data/skills/*.json         (installed skill configs)
       |
7. API updates DB status to "running"`}
        </pre>
      </section>

      {/* Chat Architecture */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Chat Architecture</h2>
        <p className="text-muted-foreground leading-relaxed">
          The chat system streams bot responses via Server-Sent Events using the AG-UI event protocol. Messages flow through the API, which proxies them to the bot pod via kubectl exec against the OpenClaw gateway.
        </p>
        <pre className="bg-secondary rounded-lg p-4 text-sm font-mono overflow-x-auto leading-relaxed">
{`User types message in browser
       |
POST /api/tambo-agent { deploymentId, message, threadId }
       |
API authenticates request (Auth0 JWT)
       |
API finds pod for deployment (kubectl get pods)
       |
API opens exec session to pod (kubectl exec)
       |
Bot processes message through LLM (Anthropic/OpenAI/Google/OpenRouter)
       |
Bot calls MCP tools (render_ui, define_component, etc.)
       |
API streams response as SSE events:
  |-- TEXT_MESSAGE_START     (begin text)
  |-- TEXT_MESSAGE_CONTENT   (incremental text deltas)
  |-- TEXT_MESSAGE_END       (end text)
  |-- UI_BLOCK_START         (begin component: type + ID)
  |-- UI_BLOCK_PROPS         (incremental JSON props)
  |-- UI_BLOCK_END           (component ready)
  |-- RUN_FINISHED           (response complete)
       |
Frontend renders:
  |-- Text: streamed into chat bubbles
  |-- UI blocks: parsed by uiBlockParser -> validated -> rendered on canvas`}
        </pre>
      </section>

      {/* Canvas System */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Canvas System</h2>
        <p className="text-muted-foreground leading-relaxed">
          The canvas system renders rich UI components (charts, tables, 3D visualizations, forms) inline in the chat conversation. Components are defined in a shared manifest and rendered through a multi-stage pipeline.
        </p>
        <pre className="bg-secondary rounded-lg p-4 text-sm font-mono overflow-x-auto leading-relaxed">
{`Bot calls render_ui MCP tool with component type + props
       |
Response contains jarble_ui fenced blocks in markdown
       |
uiBlockParser extracts blocks (brace-depth JSON parser)
       |
Server-side validation: library URLs checked against CDN allowlist
       |
Frontend receives parsed UI blocks via SSE
       |
autoFixProps runs 20 repair rules:
  |-- Type coercion (string -> number, string -> boolean)
  |-- Enum normalization ("Line" -> "line")
  |-- Missing defaults (fill required fields)
  |-- 30+ component name aliases resolved
       |
Zod schema validation (per-component schemas from manifest)
       |
CanvasRenderer renders component with error boundary
       |
SimpleCanvasGrid positions cards in responsive CSS grid
  |-- Drag-to-reorder between cards
  |-- Split multi-item components into individual cards
  |-- Merge compatible cards back together`}
        </pre>
        <p className="text-muted-foreground leading-relaxed">
          The system supports 37 active component types plus 1 alias (<code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">canvas</code> resolves to <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">sandbox</code>). Categories include Display (card, stat_grid, data_table, chart, tabs, accordion), Charts (recharts-based), Interactive (button_group, form), Media (video, audio, image_gallery), and Specialized (code_editor, map, sandbox).
        </p>
      </section>

      {/* Config Pipeline */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Config Sync Pipeline</h2>
        <p className="text-muted-foreground leading-relaxed">
          The <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">configSync</code> service synchronizes configuration between the database and the pod&apos;s persistent volume. It is triggered by credential saves, skill installations, service installations, and deployment updates.
        </p>
        <pre className="bg-secondary rounded-lg p-4 text-sm font-mono overflow-x-auto leading-relaxed">
{`Trigger: credential save, skill install, service install, deployment update
       |
syncConfigsToPvc(deploymentId)
       |
buildDeploymentFields()
  |-- Load deployment from DB
  |-- Load platform credentials (decrypt)
  |-- Load installed skills (deploymentSkills + skillsCatalog join)
  |-- Load service instruction snippets (serviceInstalls + marketplaceServices)
       |
renderConfigs()
  |-- soul.md: system prompt + service instruction sections
  |-- openclaw.json: channel configs, agent model
  |-- skills/*.json: one file per installed skill
       |
getSecretEntries()
  |-- LLM keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
  |-- Platform tokens (TELEGRAM_BOT_TOKEN, DISCORD_BOT_TOKEN, etc.)
       |
writeConfigsToPvc()
  |-- kubectl exec into pod
  |-- Write files via stdin to /data/config/
       |
updateDeploymentSecret()
  |-- Replace K8s Secret with updated env vars
       |
restartDeployment()
  |-- Scale to 0, then back to 1 (rolling restart)
       |
Poll for readiness (30 attempts x 2s = 60s max)
       |
Update DB status ("running" or "failed")`}
        </pre>
      </section>

      {/* MCP Server */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">MCP Server</h2>
        <p className="text-muted-foreground leading-relaxed">
          Each bot pod runs a custom MCP (Model Context Protocol) server via stdio. The server exposes tools that allow the LLM to render rich UI, define custom components, and interact with the component registry.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono text-sm">render_ui</TableCell>
              <TableCell>Renders a UI component by type and props. Outputs a <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">jarble_ui</code> fenced block that the frontend parses and displays.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">define_component</TableCell>
              <TableCell>Defines a reusable custom component (template or sandbox) and saves it to the pod PVC at <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">/data/components/</code>.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">list_components</TableCell>
              <TableCell>Lists all available components (built-in + custom) with descriptions and prop schemas.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">component_reference</TableCell>
              <TableCell>Returns detailed reference documentation for a specific component type including its Zod schema.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">save_canvas_file</TableCell>
              <TableCell>Saves canvas component data to <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">/data/files/</code> for persistence across sessions.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="text-muted-foreground leading-relaxed mt-3">
          Pods also fetch platform skills dynamically from the API on boot. After a 3-second delay, the MCP server calls <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">GET /debug/platform-skills</code> to get the latest skill definitions. If the API is unreachable, it falls back to a PVC-cached version, and finally to baked-in defaults.
        </p>
      </section>

      {/* Database */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Database</h2>
        <p className="text-muted-foreground leading-relaxed">
          The API uses Drizzle ORM with support for three database backends. MySQL is the production database, PostgreSQL is an alternative, and SQLite is used for local development (file-based at <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">local.db</code>).
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Table</TableHead>
              <TableHead>Purpose</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono text-sm">users</TableCell>
              <TableCell>Auth0 user ID, Stripe customer ID, email verification status, free trial tracking.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">deployments</TableCell>
              <TableCell>Bot instances with K8s state, LLM config (provider, model, encrypted API key), subscription links.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">runtimeCatalog</TableCell>
              <TableCell>Available runtimes with hardware specifications, pricing tiers, and feature flags.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">platformCredentials</TableCell>
              <TableCell>AES-256-GCM encrypted messaging platform tokens (Telegram, Discord, Slack, WhatsApp, Teams, Messenger).</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">skillsCatalog</TableCell>
              <TableCell>Global skill catalog (Web Search, Weather, Calculator, etc.).</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">deploymentSkills</TableCell>
              <TableCell>Many-to-many: which skills are installed on which deployments.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">marketplaceComponents</TableCell>
              <TableCell>Published components with manifest, code, author, pricing, and moderation status.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">componentVersions</TableCell>
              <TableCell>Version history for marketplace components.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">componentInstalls</TableCell>
              <TableCell>Tracks which components are installed on which deployments.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">componentReviews</TableCell>
              <TableCell>Ratings and text reviews for marketplace components.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">componentPurchases</TableCell>
              <TableCell>Purchase records for paid marketplace components.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">creatorProfiles</TableCell>
              <TableCell>Marketplace creator profiles for component and service publishers.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">marketplaceServices</TableCell>
              <TableCell>Published services bundling components, skills, and instructions. Two hosting models: self-hosted and remote.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">serviceComponents</TableCell>
              <TableCell>Many-to-many linking services to their bundled components.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">serviceSkills</TableCell>
              <TableCell>Many-to-many linking services to their bundled skills.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">serviceInstalls</TableCell>
              <TableCell>Tracks which services are installed on which deployments.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">serviceCredentials</TableCell>
              <TableCell>Per-install HMAC signing secrets for hosted service authentication.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">processedWebhookEvents</TableCell>
              <TableCell>Stripe webhook idempotency tracking to prevent duplicate processing.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      {/* Infrastructure */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Infrastructure</h2>
        <p className="text-muted-foreground leading-relaxed">
          Production infrastructure runs on Hetzner Cloud managed by Terraform. The Kubernetes cluster uses K3s (lightweight K8s distribution) with Longhorn for persistent storage.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Component</TableHead>
              <TableHead>Technology</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-semibold">Cloud provider</TableCell>
              <TableCell>Hetzner Cloud</TableCell>
              <TableCell>European cloud provider with competitive pricing for compute and storage.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">IaC</TableCell>
              <TableCell>Terraform</TableCell>
              <TableCell>Infrastructure as Code for reproducible provisioning of servers, networks, and DNS.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Kubernetes</TableCell>
              <TableCell>K3s</TableCell>
              <TableCell>Lightweight Kubernetes distribution optimized for edge and single-node deployments.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Storage</TableCell>
              <TableCell>Longhorn</TableCell>
              <TableCell>Cloud-native distributed storage for Kubernetes. Each deployment gets a 20Gi RWO PVC.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Container registry</TableCell>
              <TableCell>GitHub Container Registry</TableCell>
              <TableCell>Container images at <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">ghcr.io/jarble-ai/openclaw:latest</code>.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Namespace</TableCell>
              <TableCell>jarble</TableCell>
              <TableCell>All deployment pods, secrets, PVCs, and services live in the jarble namespace.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      {/* Tech Stack Summary */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Tech Stack Summary</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Layer</TableHead>
              <TableHead>Technology</TableHead>
              <TableHead>Version / Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-semibold">Frontend framework</TableCell>
              <TableCell>Next.js (App Router)</TableCell>
              <TableCell>v15 with React 19, server and client components.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Styling</TableCell>
              <TableCell>Tailwind CSS + shadcn/ui</TableCell>
              <TableCell>Tailwind v4 with CSS variable tokens. shadcn for accessible primitives.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Animation</TableCell>
              <TableCell>Framer Motion</TableCell>
              <TableCell>Layout animations, page transitions, component mount/unmount.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Charts</TableCell>
              <TableCell>Recharts</TableCell>
              <TableCell>Unified chart component replacing 22 former Ant Design chart types.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Chat framework</TableCell>
              <TableCell>@assistant-ui/react</TableCell>
              <TableCell>ExternalStoreRuntime for thread-based chat with custom rendering.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Node graph</TableCell>
              <TableCell>@xyflow/react + dagre</TableCell>
              <TableCell>Interactive deployment graph showing credit pool relationships.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Code editor</TableCell>
              <TableCell>Monaco Editor</TableCell>
              <TableCell>VS Code editor for code_editor canvas component.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Maps</TableCell>
              <TableCell>Leaflet</TableCell>
              <TableCell>Interactive map component with marker and polygon support.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">API layer</TableCell>
              <TableCell>Express + tRPC + SuperJSON</TableCell>
              <TableCell>Type-safe RPC with automatic serialization of complex types.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">ORM</TableCell>
              <TableCell>Drizzle</TableCell>
              <TableCell>Type-safe SQL with MySQL, PostgreSQL, and SQLite drivers.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Authentication</TableCell>
              <TableCell>Auth0</TableCell>
              <TableCell>RS256 JWT + JWKS verification. Management API for email verification.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Payments</TableCell>
              <TableCell>Stripe</TableCell>
              <TableCell>Dynamic pricing via price_data, webhook event processing.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">MCP server</TableCell>
              <TableCell>Custom stdio server</TableCell>
              <TableCell>jarble-ui-server.js running inside bot pods. 5 tools for UI rendering.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Error tracking</TableCell>
              <TableCell>Sentry</TableCell>
              <TableCell>Client + server error tracking with AutoFix rule frequency monitoring.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Analytics</TableCell>
              <TableCell>PostHog</TableCell>
              <TableCell>Product analytics and feature flag management.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">HTML sanitization</TableCell>
              <TableCell>DOMPurify</TableCell>
              <TableCell>Client-side HTML sanitization for user-generated content.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Schema validation</TableCell>
              <TableCell>Zod</TableCell>
              <TableCell>v4 (frontend) / v3 (API). Schemas shared via component manifest with cross-version compatibility.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
