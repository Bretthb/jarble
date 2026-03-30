"use client";

import { Code } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

export default function ApiReferencePage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Code className="h-5 w-5" />
        </div>
        <h1 className="font-serif text-3xl font-medium tracking-tight">
          API Reference
        </h1>
      </div>

      {/* Overview */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
        <p className="text-muted-foreground leading-relaxed">
          Jarble exposes a type-safe tRPC API at the <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">/trpc</code> path. All requests use SuperJSON serialization for transparent handling of dates, Maps, Sets, and other non-JSON types. The API is organized into 10 routers with 90+ procedures covering deployment lifecycle, billing, marketplace operations, and more.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          Frontend clients use the tRPC React Query integration for type-safe data fetching with automatic caching, retry, and optimistic updates. Server-side callers can use the vanilla tRPC client with the same type safety.
        </p>
      </section>

      {/* Authentication */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Authentication</h2>
        <p className="text-muted-foreground leading-relaxed">
          Authentication is handled by Auth0 using RS256-signed JWTs. The API validates tokens on every request via JWKS (JSON Web Key Set) rotation from the Auth0 domain. Tokens are passed as Bearer tokens in the Authorization header.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          Procedures are classified as either <strong>public</strong> or <strong>protected</strong>. Public procedures are available without authentication and are used for read-only operations like browsing the runtime catalog or marketplace. Protected procedures require a valid JWT and inject the authenticated user into the request context.
        </p>
        <pre className="bg-secondary rounded-lg p-4 text-sm font-mono overflow-x-auto">
{`// Authorization header format
Authorization: Bearer <auth0-jwt-token>

// tRPC client automatically attaches the token:
const trpc = createTRPCClient({
  links: [
    httpBatchLink({
      url: "/trpc",
      headers: () => ({
        Authorization: \`Bearer \${getAccessToken()}\`,
      }),
    }),
  ],
  transformer: superjson,
});`}
        </pre>
        <p className="text-muted-foreground leading-relaxed">
          All protected procedures verify resource ownership. For example, deployment mutations confirm the deployment belongs to the authenticated user before allowing modifications.
        </p>
      </section>

      {/* Router Reference */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Router Reference</h2>
        <p className="text-muted-foreground leading-relaxed">
          The API is organized into 10 routers. Each procedure is either a <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">query</code> (read) or <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">mutation</code> (write). All inputs are validated with Zod schemas.
        </p>

        {/* user */}
        <h3 className="text-lg font-medium mt-6">user</h3>
        <p className="text-muted-foreground text-sm">User profile management and email verification.</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Procedure</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Auth</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono text-sm">me</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Public</TableCell>
              <TableCell>Returns the current user from the request context, or null if unauthenticated.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getProfile</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Fetches the full user profile from the database including Stripe customer ID and verification status.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">updateProfile</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Updates the user name. Email changes require verification via Auth0.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">completeProfile</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Sets first and last name for email/password signups after email verification.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">resendVerificationEmail</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Triggers a new verification email via the Auth0 Management API.</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {/* deployment */}
        <h3 className="text-lg font-medium mt-6">deployment</h3>
        <p className="text-muted-foreground text-sm">Full deployment lifecycle: CRUD, K8s orchestration, component management, and subscription billing.</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Procedure</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Auth</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono text-sm">list</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Lists all deployments owned by the authenticated user.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">listLinkableDeployments</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Lists deployments that can share a credit pool (for linked subscriptions).</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getById</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Fetches a single deployment by ID with runtime catalog details.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getComponentCatalog</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Returns the component library catalog available for a deployment.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">defineComponent</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Defines a custom component on a deployment, writing its definition to the pod PVC.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">deleteComponent</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Removes a custom component from a deployment&apos;s PVC.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">create</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Creates a new deployment record, provisions K8s resources (Deployment, Secret, PVC, Service), and starts the pod.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">deploy</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Initiates or re-initiates a deployment with Stripe checkout if required.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getStatus</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Returns current deployment status from the database.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getStorageUsage</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Returns PVC storage usage for a running deployment.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getLogs</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Fetches recent container logs from the deployment pod.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">update</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Updates deployment configuration (name, system prompt, LLM settings, model) and syncs to the pod.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">stop</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Scales the K8s deployment to 0 replicas.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">start</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Scales the K8s deployment back to 1 replica and waits for readiness.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">restart</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Performs a rolling restart of the deployment pod.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">cancel</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Cancels the Stripe subscription (at period end or immediately).</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">reactivate</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Reactivates a cancelled subscription before the billing period ends.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">linkSubscription</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Links a deployment to another deployment&apos;s credit pool.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">exportConfigs</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Exports the current configuration files from the deployment PVC.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">delete</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Deletes a deployment, removes all K8s resources, and cancels the subscription.</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {/* runtimeCatalog */}
        <h3 className="text-lg font-medium mt-6">runtimeCatalog</h3>
        <p className="text-muted-foreground text-sm">Read-only catalog of available bot runtimes with hardware specs and pricing.</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Procedure</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Auth</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono text-sm">list</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Public</TableCell>
              <TableCell>Lists all active runtimes ordered by name.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getById</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Public</TableCell>
              <TableCell>Fetches a single runtime by numeric ID.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getBySlug</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Public</TableCell>
              <TableCell>Fetches a runtime by its URL-friendly slug.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getCapabilities</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Public</TableCell>
              <TableCell>Returns runtime capabilities and config file definitions from the handler registry.</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {/* template */}
        <h3 className="text-lg font-medium mt-6">template</h3>
        <p className="text-muted-foreground text-sm">Bot configuration templates (Personal Assistant, Business Helper, Support Agent).</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Procedure</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Auth</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono text-sm">list</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Public</TableCell>
              <TableCell>Returns all available bot templates with default model recommendations.</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {/* openrouter */}
        <h3 className="text-lg font-medium mt-6">openrouter</h3>
        <p className="text-muted-foreground text-sm">Multi-provider LLM key validation, OpenRouter credit provisioning, and usage tracking.</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Procedure</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Auth</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono text-sm">healthCheck</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Checks connectivity to the OpenRouter API.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">models</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Lists all available LLM models from OpenRouter.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">validateApiKey</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Validates an OpenRouter API key (legacy single-provider).</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">validateProviderKey</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Validates an API key for any supported LLM provider (OpenRouter, OpenAI, Anthropic, Google).</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">provisionKey</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Provisions a tenant OpenRouter key with a dollar limit for &quot;Included Credits&quot; mode.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getKeyUsage</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Returns credit usage for an included-credits deployment.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">updateKeyLimit</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Updates the dollar limit on a provisioned OpenRouter key.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">revokeKey</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Revokes (disables) a provisioned OpenRouter key and clears it from the deployment.</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {/* billing */}
        <h3 className="text-lg font-medium mt-6">billing</h3>
        <p className="text-muted-foreground text-sm">Stripe billing overview, invoices, and subscription management.</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Procedure</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Auth</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono text-sm">getOverview</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Returns total monthly cost, active subscription count, next billing date, and payment method.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getInvoices</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Lists past invoices from Stripe with PDF download links.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getSubscriptions</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Lists all active paid subscriptions with period dates and Stripe status.</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {/* platformCredentials */}
        <h3 className="text-lg font-medium mt-6">platformCredentials</h3>
        <p className="text-muted-foreground text-sm">Encrypted messaging platform token management and pairing flows.</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Procedure</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Auth</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono text-sm">getByDeployment</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Returns all platform credentials for a deployment with values masked (first 4 + last 4 chars).</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">save</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Upserts platform credentials (encrypted with AES-256-GCM) and triggers config sync to the pod.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">delete</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Removes platform credentials and triggers config sync.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">checkWhatsAppStatus</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Checks whether WhatsApp is paired for a deployment.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">markWhatsAppConnected</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Marks WhatsApp as connected after QR pairing and triggers config sync.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">pollTelegramPairing</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Polls for pending Telegram pairing requests in the pod and auto-approves the first one.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">testConnection</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Validates that all required credential fields are present for a platform (format check).</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {/* skills */}
        <h3 className="text-lg font-medium mt-6">skills</h3>
        <p className="text-muted-foreground text-sm">Skill catalog and per-deployment skill installation.</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Procedure</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Auth</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono text-sm">listCatalog</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Lists all skills in the global catalog, optionally filtered by runtime slug.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">listForDeployment</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Lists skills installed on a specific deployment with full skill details.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">install</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Installs a skill on a deployment and triggers config sync to write skill config to the pod PVC.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">uninstall</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Removes a skill from a deployment and triggers config sync.</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {/* marketplace */}
        <h3 className="text-lg font-medium mt-6">marketplace</h3>
        <p className="text-muted-foreground text-sm">Component marketplace: browsing, installation, publishing, reviews, and admin moderation.</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Procedure</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Auth</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono text-sm">browse</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Public</TableCell>
              <TableCell>Search and filter marketplace components by category, pricing, and text query.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getById</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Public</TableCell>
              <TableCell>Fetches a single component with version history, reviews, and install count.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getFeatured</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Public</TableCell>
              <TableCell>Returns featured/promoted components for the marketplace homepage.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getCategories</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Public</TableCell>
              <TableCell>Lists available component categories with counts.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">builtinSchemas</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Public</TableCell>
              <TableCell>Returns JSON Schemas for all built-in component types.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">install</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Installs a marketplace component onto a deployment, syncing files to the pod PVC.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">uninstall</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Removes an installed component from a deployment.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">listInstalled</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Lists all components installed on a specific deployment.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">updateVersion</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Updates an installed component to a newer version.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">createCheckout</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Creates a Stripe checkout session for purchasing a paid component.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getPurchases</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Lists all component purchases for the authenticated user.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getReviews</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Public</TableCell>
              <TableCell>Returns reviews for a component with author details.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">createReview</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Submits a rating and review for an installed component.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">createCreatorProfile</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Creates a marketplace creator profile for publishing components.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getCreatorProfile</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Public</TableCell>
              <TableCell>Fetches a creator profile by user ID.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">submitComponent</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Submits a new component for marketplace review.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">publishComponent</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Publishes a new version of an approved component.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">updateComponent</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Updates component metadata (description, pricing, etc.).</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">myComponents</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Lists all components published by the authenticated creator.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getCreatorAnalytics</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Returns install counts, revenue, and review stats for a creator.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getReviewQueue</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Admin: lists components pending review.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">approveComponent</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Admin: approves a component for marketplace listing.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">rejectComponent</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Admin: rejects a component with a reason.</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {/* services */}
        <h3 className="text-lg font-medium mt-6">services</h3>
        <p className="text-muted-foreground text-sm">Service marketplace: bundles of components, skills, and bot instructions.</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Procedure</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Auth</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono text-sm">list</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Public</TableCell>
              <TableCell>Search and filter services by category, hosting model, and text query.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">get</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Public</TableCell>
              <TableCell>Fetches a single service with its bundled components, skills, and instruction snippet.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">install</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Atomically installs a service: components, skills, instruction snippet, and triggers a single PVC sync.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">uninstall</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Removes all service resources from a deployment.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">listInstalled</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Lists services installed on a specific deployment.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">publish</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Publishes a new service bundling components, skills, and instructions.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">listByCreator</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Public</TableCell>
              <TableCell>Lists all services published by a specific creator.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">getServiceStatus</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Returns health and connectivity status for a hosted service.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">checkForUpdates</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Checks whether newer versions of installed services are available.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">upgradeService</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Upgrades an installed service to the latest version.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">creatorInstalls</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Returns install analytics for a creator&apos;s services.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">creatorUsage</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Returns usage metrics for a creator&apos;s hosted services.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">rotateSigningSecret</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Rotates the HMAC signing secret for a hosted service installation.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">listDeploymentComponents</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Lists all components on a deployment (both directly installed and via services).</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">listDeploymentSkills</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Lists all skills on a deployment (both directly installed and via services).</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">adminList</TableCell>
              <TableCell>query</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Admin: lists all services with moderation status.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">adminApprove</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Admin: approves a service for marketplace listing.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">adminReject</TableCell>
              <TableCell>mutation</TableCell>
              <TableCell>Protected</TableCell>
              <TableCell>Admin: rejects a service with a reason.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      {/* SSE Endpoints */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">SSE Streaming Endpoints</h2>
        <p className="text-muted-foreground leading-relaxed">
          Three Server-Sent Events endpoints provide real-time updates without polling. Each endpoint returns an <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">text/event-stream</code> response that stays open for the duration of the connection.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Endpoint</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Events</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono text-sm">GET /api/status-stream</TableCell>
              <TableCell>Real-time deployment status updates for the dashboard.</TableCell>
              <TableCell>Deployment ID, status (creating, running, stopped, failed), timestamp.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">GET /api/log-stream/:id</TableCell>
              <TableCell>Live container log streaming from a deployment pod.</TableCell>
              <TableCell>Log lines with timestamps, severity levels.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">GET /api/qr-stream/:id</TableCell>
              <TableCell>WhatsApp QR code pairing stream for Baileys-based authentication.</TableCell>
              <TableCell>QR code data (base64), connection status, error events.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      {/* Chat Endpoint */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Chat Endpoint</h2>
        <p className="text-muted-foreground leading-relaxed">
          The chat endpoint streams bot responses as SSE events following the AG-UI (Agent-UI) event protocol. The frontend sends a message, and the API proxies it to the bot pod via kubectl exec, then streams the response back.
        </p>
        <pre className="bg-secondary rounded-lg p-4 text-sm font-mono overflow-x-auto">
{`POST /api/tambo-agent
Content-Type: application/json
Authorization: Bearer <token>

{
  "deploymentId": "dep-abc123xyz",
  "message": "Show me a sales dashboard",
  "threadId": "thread-001"
}`}
        </pre>
        <p className="text-muted-foreground leading-relaxed mt-3">
          The response is an SSE stream with the following event types:
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event Type</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono text-sm">TEXT_MESSAGE_START</TableCell>
              <TableCell>Signals the beginning of a text response with a message ID.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">TEXT_MESSAGE_CONTENT</TableCell>
              <TableCell>Incremental text delta for streaming display.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">TEXT_MESSAGE_END</TableCell>
              <TableCell>Signals the text portion is complete.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">UI_BLOCK_START</TableCell>
              <TableCell>Begins a UI component block with component type and ID.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">UI_BLOCK_PROPS</TableCell>
              <TableCell>Incremental JSON props for the UI component (parsed via brace-depth).</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">UI_BLOCK_END</TableCell>
              <TableCell>Signals the UI block is complete and ready for rendering.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">RUN_FINISHED</TableCell>
              <TableCell>Signals the entire response is complete.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="text-muted-foreground leading-relaxed mt-3">
          UI blocks are rendered as interactive canvas components on the frontend. The <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">uiBlockParser</code> uses a brace-depth JSON parser (not regex) for reliable incremental extraction during streaming.
        </p>
      </section>

      {/* Error Handling */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Error Handling</h2>
        <p className="text-muted-foreground leading-relaxed">
          tRPC procedures use standard error codes that map to HTTP status codes. The chat endpoint additionally classifies errors into user-actionable categories.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>tRPC Code</TableHead>
              <TableHead>HTTP Status</TableHead>
              <TableHead>Usage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono text-sm">UNAUTHORIZED</TableCell>
              <TableCell>401</TableCell>
              <TableCell>Missing or invalid JWT token.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">NOT_FOUND</TableCell>
              <TableCell>404</TableCell>
              <TableCell>Resource does not exist or is not owned by the authenticated user.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">BAD_REQUEST</TableCell>
              <TableCell>400</TableCell>
              <TableCell>Invalid input (Zod validation failure) or invalid operation.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">CONFLICT</TableCell>
              <TableCell>409</TableCell>
              <TableCell>Duplicate resource (e.g., skill already installed).</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">PRECONDITION_FAILED</TableCell>
              <TableCell>412</TableCell>
              <TableCell>Required service not configured (e.g., Stripe, OpenRouter Management API).</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">INTERNAL_SERVER_ERROR</TableCell>
              <TableCell>500</TableCell>
              <TableCell>Unexpected server failure.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="text-muted-foreground leading-relaxed mt-3">
          Chat endpoint errors are classified into patterns (rate limit, auth failure, model unavailable, context overflow, etc.) by <code className="bg-secondary rounded px-1.5 py-0.5 text-sm font-mono">chatErrors.ts</code> and returned as structured error cards with actionable suggestions.
        </p>
      </section>

      {/* Rate Limiting */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Rate Limiting</h2>
        <p className="text-muted-foreground leading-relaxed">
          The API applies rate limiting at three tiers to protect against abuse:
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tier</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-semibold">Global IP</TableCell>
              <TableCell>Per IP address</TableCell>
              <TableCell>Broad limit on total requests per IP to prevent DDoS. Applies to all endpoints including public ones.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Per-User Auth</TableCell>
              <TableCell>Per authenticated user</TableCell>
              <TableCell>Limits on authenticated API calls per user. Higher limits than IP-based for legitimate users.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">Stripe Action</TableCell>
              <TableCell>Per user, billing mutations</TableCell>
              <TableCell>Tighter limits on checkout creation, subscription changes, and other financial operations.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
