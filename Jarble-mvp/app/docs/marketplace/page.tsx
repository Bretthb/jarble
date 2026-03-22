"use client";

import {
  Store,
  Search,
  Download,
  Upload,
  Layers,
  Package,
  Server,
  Users,
  Shield,
  ArrowRight,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

/* ---------------------------------------------------------------------------
 * Page: Marketplace Guide
 * Path: /docs/marketplace
 * --------------------------------------------------------------------------- */

export default function MarketplacePage() {
  return (
    <div className="space-y-12">
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Store className="h-5 w-5" />
          </div>
          <h1 className="font-serif text-3xl font-medium tracking-tight">
            Marketplace Guide
          </h1>
        </div>
        <p className="text-muted-foreground leading-relaxed max-w-[700px]">
          The Jarble Marketplace is where you discover, install, and publish
          custom UI components and bundled services. Browse community-built
          visualizations, install them to your deployments with one click, or
          publish your own creations.
        </p>
      </div>

      {/* ── Overview ─────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-medium tracking-tight">
          Overview
        </h2>
        <p className="text-muted-foreground leading-relaxed">
          The marketplace has two main sections: <strong>Components</strong> and{" "}
          <strong>Services</strong>. Components are individual UI elements
          (charts, widgets, visualizations) that your bot can render. Services
          are curated bundles that combine components, skills, and bot
          instructions into a single installable package.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="border-border">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                <CardTitle className="text-base font-medium">
                  Components
                </CardTitle>
              </div>
              <CardDescription>
                Individual UI elements with Zod-validated schemas
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <ul className="list-disc list-inside space-y-1">
                <li>Browse by category, search by name or tag</li>
                <li>View ratings, reviews, and install counts</li>
                <li>One-click install to any deployment</li>
                <li>Two tiers: Template (safe JSON) and Code (sandbox)</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                <CardTitle className="text-base font-medium">
                  Services
                </CardTitle>
              </div>
              <CardDescription>
                Bundles of components + skills + bot instructions
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <ul className="list-disc list-inside space-y-1">
                <li>Atomic install: everything in one step</li>
                <li>Include instruction snippets for the bot</li>
                <li>Two hosting models: self-hosted and remote</li>
                <li>Creator profiles with version management</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Browsing Components ───────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Search className="h-5 w-5 text-primary" />
          <h2 className="font-serif text-2xl font-medium tracking-tight">
            Browsing Components
          </h2>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          The Components tab displays a searchable, filterable grid of all
          published components. Each component card shows its name, description,
          category badge, average rating, install count, and pricing.
        </p>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Search and Filter
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <ul className="list-disc list-inside space-y-1.5">
              <li>
                <strong>Text search</strong> matches against component name,
                description, and tags
              </li>
              <li>
                <strong>Category filter</strong> narrows results to display,
                chart, interactive, media, or specialized components
              </li>
              <li>
                <strong>Pricing filter</strong> shows free, one-time purchase,
                or subscription components
              </li>
              <li>
                <strong>Sort options</strong> include most popular, highest
                rated, newest, and recently updated
              </li>
            </ul>
          </CardContent>
        </Card>

        <p className="text-muted-foreground leading-relaxed">
          Clicking a component card opens the detail view, which shows the
          full description, a live preview (when available), the component
          manifest, version history, and community reviews.
        </p>
      </section>

      {/* ── Installing Components ────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Download className="h-5 w-5 text-primary" />
          <h2 className="font-serif text-2xl font-medium tracking-tight">
            Installing Components
          </h2>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          Installing a component makes it available to a specific deployment.
          The install process syncs the component definition to the
          deployment&apos;s pod PVC so the MCP server can reference it.
        </p>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Install Flow
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <ol className="list-decimal list-inside space-y-2">
              <li>
                Click <strong>Install</strong> on a component and select the
                target deployment
              </li>
              <li>
                A{" "}
                <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                  componentInstalls
                </code>{" "}
                record is created linking the component to your deployment
              </li>
              <li>
                The component definition is synced to the pod&apos;s PVC at{" "}
                <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                  /data/components/
                </code>
              </li>
              <li>
                The MCP server detects the new component and makes it available
                via{" "}
                <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                  render_ui
                </code>{" "}
                and{" "}
                <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                  list_components
                </code>
              </li>
              <li>
                Your bot can now use the component by name in its responses
              </li>
            </ol>
          </CardContent>
        </Card>

        <p className="text-sm text-muted-foreground">
          Uninstalling a component removes the install record and cleans up the
          PVC. The component will no longer appear in the bot&apos;s available
          component list.
        </p>
      </section>

      {/* ── Component Tiers ──────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="font-serif text-2xl font-medium tracking-tight">
            Component Tiers
          </h2>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          Marketplace components fall into two security tiers, each with
          different capabilities and isolation levels.
        </p>

        <Tabs defaultValue="template">
          <TabsList>
            <TabsTrigger value="template">Template Tier</TabsTrigger>
            <TabsTrigger value="code">Code / Sandbox Tier</TabsTrigger>
          </TabsList>

          <TabsContent value="template" className="mt-4">
            <Card className="border-border">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base font-medium">
                    Template Components
                  </CardTitle>
                  <Badge variant="outline">Safe</Badge>
                </div>
                <CardDescription>
                  Declarative JSON definitions using built-in primitives
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-3">
                <p>
                  Template components are pure JSON manifests that compose
                  existing built-in components. They cannot execute arbitrary
                  code. This makes them inherently safe and allows dynamic props
                  to be passed through without security concerns.
                </p>
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    Characteristics:
                  </p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>No custom HTML, CSS, or JavaScript</li>
                    <li>Props validated against a Zod schema</li>
                    <li>Renders using existing built-in components</li>
                    <li>No additional isolation required</li>
                    <li>Fast review and approval process</li>
                  </ul>
                </div>
                <pre className="bg-secondary rounded-lg p-4 text-sm font-mono overflow-x-auto">
                  <code>{`{
  "name": "weather_card",
  "tier": "template",
  "baseComponent": "card",
  "schema": {
    "city": { "type": "string" },
    "temperature": { "type": "number" },
    "condition": { "type": "string" }
  }
}`}</code>
                </pre>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="code" className="mt-4">
            <Card className="border-border">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base font-medium">
                    Code / Sandbox Components
                  </CardTitle>
                  <Badge variant="secondary">Isolated</Badge>
                </div>
                <CardDescription>
                  Custom HTML/CSS/JS running in a double-iframe sandbox
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-3">
                <p>
                  Code-tier components contain custom HTML, CSS, and JavaScript.
                  They run inside the{" "}
                  <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                    marketplace_sandbox
                  </code>{" "}
                  component, which provides a double-iframe architecture for
                  extra isolation beyond the standard sandbox.
                </p>
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    Security measures:
                  </p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>
                      Double-iframe: inner iframe runs with opaque origin inside
                      an outer{" "}
                      <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                        about:blank
                      </code>{" "}
                      iframe
                    </li>
                    <li>
                      No same-origin access to the host application
                    </li>
                    <li>
                      CSP restricts scripts/styles to 10 trusted CDN origins
                    </li>
                    <li>
                      HTML is baked at review time; only data props are dynamic
                    </li>
                    <li>
                      Heartbeat watchdog and error rate limiting apply
                    </li>
                    <li>
                      Requires manual review before publication
                    </li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </section>

      {/* ── Publishing Components ────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Upload className="h-5 w-5 text-primary" />
          <h2 className="font-serif text-2xl font-medium tracking-tight">
            Publishing Components
          </h2>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          Creators can publish their own components to the marketplace. The
          publishing workflow validates the component manifest, checks security
          constraints, and submits the component for review.
        </p>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Publishing Workflow
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <ol className="list-decimal list-inside space-y-2">
              <li>
                <strong>Create a creator profile</strong> with your display
                name, bio, and optional website URL
              </li>
              <li>
                <strong>Define the component manifest</strong> including name,
                description, category, Zod schema, and the component code
                (template JSON or HTML/CSS/JS)
              </li>
              <li>
                <strong>Set pricing</strong>: free, one-time purchase, or
                subscription. Free components get wider distribution.
              </li>
              <li>
                <strong>Submit for review</strong>. The manifest validator runs
                13 validation rules including schema correctness, configSchema
                validation, and SDK version compatibility.
              </li>
              <li>
                <strong>Review and approval</strong>. Template-tier components
                are reviewed automatically. Code-tier components require manual
                review by a moderator.
              </li>
              <li>
                <strong>Published</strong>. Your component appears in the
                marketplace browse grid and is searchable by all users.
              </li>
            </ol>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Manifest Validation Rules
            </CardTitle>
            <CardDescription>
              The manifest validator enforces 13 rules before a component can be
              published.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rule</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {VALIDATION_RULES.map((rule) => (
                    <TableRow key={rule.name}>
                      <TableCell className="text-sm font-medium">
                        {rule.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {rule.description}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Pricing Options
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">Model</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-sm font-medium">Free</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      No cost. Maximizes distribution and install count. Good
                      for building reputation.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm font-medium">
                      One-time
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      Single purchase price. Buyer gets permanent access to the
                      component and all future updates.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm font-medium">
                      Subscription
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      Recurring monthly fee. Access revoked if subscription
                      lapses. Best for components with ongoing maintenance.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── Services ─────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Package className="h-5 w-5 text-primary" />
          <h2 className="font-serif text-2xl font-medium tracking-tight">
            Services
          </h2>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          Services are curated bundles that combine{" "}
          <strong>components</strong>, <strong>skills</strong>, and{" "}
          <strong>bot instruction snippets</strong> into a single installable
          unit. When you install a service, your bot gains new capabilities
          without any manual configuration.
        </p>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              What a Service Includes
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">Component</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-sm font-medium">
                      UI Components
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      One or more marketplace components that the bot can render.
                      Linked via the{" "}
                      <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                        serviceComponents
                      </code>{" "}
                      table.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm font-medium">Skills</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      MCP tools that give the bot new abilities (e.g., Web
                      Search, Weather, Calculator). Linked via the{" "}
                      <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                        serviceSkills
                      </code>{" "}
                      table.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm font-medium">
                      Instruction Snippet
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      A markdown snippet appended to the bot&apos;s system prompt
                      (soul.md) as a{" "}
                      <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                        ## Service: &#123;name&#125;
                      </code>{" "}
                      section. Guides the bot on how to use the service&apos;s
                      components and skills.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Hosting Models */}
        <h3 className="font-serif text-xl font-medium tracking-tight pt-2">
          Hosting Models
        </h3>
        <p className="text-muted-foreground leading-relaxed">
          Services support two hosting models that determine where the
          service&apos;s backend logic runs.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="border-border">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-primary" />
                <CardTitle className="text-base font-medium">
                  Self-Hosted (Package)
                </CardTitle>
              </div>
              <CardDescription>
                <Badge variant="outline" className="mt-1">
                  hostingModel: &quot;package&quot;
                </Badge>
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                The buyer downloads everything and runs it on their own pod.
                All components, skills, and instructions are installed directly
                to the deployment&apos;s PVC.
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li>Full data sovereignty -- nothing leaves the pod</li>
                <li>No dependency on the creator&apos;s infrastructure</li>
                <li>Skills execute locally via the MCP server</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-primary" />
                <CardTitle className="text-base font-medium">
                  Remote / Hosted
                </CardTitle>
              </div>
              <CardDescription>
                <Badge variant="outline" className="mt-1">
                  hostingModel: &quot;hosted&quot;
                </Badge>
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                The creator hosts the API backend. The buyer gets frontend
                components and skill definitions that proxy through the Jarble
                API to the creator&apos;s endpoint.
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li>
                  Creator manages the backend; buyer gets a turnkey experience
                </li>
                <li>
                  Per-install HMAC signing for authentication
                </li>
                <li>
                  Jarble API acts as a proxy gateway (buyer pods never call
                  creator APIs directly)
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Installing Services ──────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Download className="h-5 w-5 text-primary" />
          <h2 className="font-serif text-2xl font-medium tracking-tight">
            Installing Services
          </h2>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          Service installation is <strong>atomic</strong>: all components,
          skills, and the instruction snippet are installed in a single
          operation with one PVC sync. If any part fails, the entire install
          is rolled back.
        </p>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Atomic Install Flow
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <ol className="list-decimal list-inside space-y-2">
              <li>
                Click <strong>Install</strong> on a service and select the
                target deployment
              </li>
              <li>
                A{" "}
                <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                  serviceInstalls
                </code>{" "}
                record is created
              </li>
              <li>
                <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                  componentInstalls
                </code>{" "}
                records are created for each component in the service
              </li>
              <li>
                <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                  deploymentSkills
                </code>{" "}
                records are created for each skill in the service
              </li>
              <li>
                The instruction snippet is appended to{" "}
                <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                  soul.md
                </code>{" "}
                as a{" "}
                <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                  ## Service: &#123;name&#125;
                </code>{" "}
                section
              </li>
              <li>
                A single{" "}
                <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                  syncConfigsToPvc()
                </code>{" "}
                call writes all components, skills, and updated soul.md to the
                pod
              </li>
              <li>
                The pod restarts and the bot has full access to the new
                capabilities
              </li>
            </ol>
          </CardContent>
        </Card>

        <p className="text-sm text-muted-foreground">
          Uninstalling a service reverses the entire process: removes all
          component installs, skill links, and the instruction snippet section
          from soul.md in a single operation.
        </p>
      </section>

      {/* ── Creator Tools ────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="font-serif text-2xl font-medium tracking-tight">
            Creator Tools
          </h2>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          The marketplace provides a suite of tools for component and service
          creators to manage their published work.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base font-medium">
                Creator Profile
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1.5">
              <ul className="list-disc list-inside space-y-1">
                <li>Display name and bio visible on all published items</li>
                <li>Optional website URL and social links</li>
                <li>
                  Profile page showing all published components and services
                </li>
                <li>Aggregate download and rating statistics</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base font-medium">
                Version Management
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1.5">
              <ul className="list-disc list-inside space-y-1">
                <li>
                  Publish new versions with changelogs tracked in the{" "}
                  <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                    componentVersions
                  </code>{" "}
                  table
                </li>
                <li>
                  Existing installs can be updated to the latest version
                </li>
                <li>Version history visible on the component detail page</li>
                <li>Semantic versioning recommended</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base font-medium">
                Review System
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1.5">
              <ul className="list-disc list-inside space-y-1">
                <li>Users can leave ratings (1-5 stars) and written reviews</li>
                <li>
                  Reviews stored in{" "}
                  <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                    componentReviews
                  </code>{" "}
                  table
                </li>
                <li>
                  Average rating displayed on component cards in the browse
                  grid
                </li>
                <li>Creators can respond to reviews</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base font-medium">
                Admin Moderation
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1.5">
              <ul className="list-disc list-inside space-y-1">
                <li>
                  Published components go through a review queue before
                  becoming publicly visible
                </li>
                <li>
                  Code-tier components require manual review; template-tier
                  components use automated validation
                </li>
                <li>
                  Moderators can approve, reject, or request changes
                </li>
                <li>Flagged components can be suspended from the marketplace</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Data Model ───────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-medium tracking-tight">
          Data Model
        </h2>
        <p className="text-muted-foreground leading-relaxed">
          The marketplace uses 10 database tables across two domains:
          components and services.
        </p>

        <Tabs defaultValue="component-tables">
          <TabsList>
            <TabsTrigger value="component-tables">
              Component Tables (6)
            </TabsTrigger>
            <TabsTrigger value="service-tables">
              Service Tables (4)
            </TabsTrigger>
          </TabsList>

          <TabsContent value="component-tables" className="mt-4">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[220px]">Table</TableHead>
                    <TableHead>Purpose</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {COMPONENT_TABLES.map((t) => (
                    <TableRow key={t.name}>
                      <TableCell className="font-mono text-sm">
                        {t.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {t.purpose}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="service-tables" className="mt-4">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[220px]">Table</TableHead>
                    <TableHead>Purpose</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {SERVICE_TABLES.map((t) => (
                    <TableRow key={t.name}>
                      <TableCell className="font-mono text-sm">
                        {t.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {t.purpose}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </section>

      {/* ── tRPC Procedures ──────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-medium tracking-tight">
          API Procedures
        </h2>
        <p className="text-muted-foreground leading-relaxed">
          The marketplace exposes two tRPC routers with a combined 28+
          procedures.
        </p>

        <Tabs defaultValue="marketplace-router">
          <TabsList>
            <TabsTrigger value="marketplace-router">
              marketplace (22)
            </TabsTrigger>
            <TabsTrigger value="services-router">services (6)</TabsTrigger>
          </TabsList>

          <TabsContent value="marketplace-router" className="mt-4">
            <p className="text-sm text-muted-foreground mb-3">
              The{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                marketplace
              </code>{" "}
              router handles component CRUD, install/uninstall, publish,
              review, creator tools, and admin moderation. Key procedures:
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Procedure</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {MARKETPLACE_PROCEDURES.map((p) => (
                    <TableRow key={p.name}>
                      <TableCell className="font-mono text-sm">
                        {p.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {p.description}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="services-router" className="mt-4">
            <p className="text-sm text-muted-foreground mb-3">
              The{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                services
              </code>{" "}
              router handles service marketplace operations.
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Procedure</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {SERVICES_PROCEDURES.map((p) => (
                    <TableRow key={p.name}>
                      <TableCell className="font-mono text-sm">
                        {p.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {p.description}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </section>

      {/* ── Quick Start ──────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-medium tracking-tight">
          Quick Start
        </h2>
        <Card className="border-border">
          <CardContent className="pt-6">
            <div className="space-y-4 text-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium">
                  1
                </div>
                <div>
                  <p className="font-medium text-foreground">
                    Browse the marketplace
                  </p>
                  <p className="text-muted-foreground">
                    Navigate to the Marketplace tab in your deployment
                    configuration panel. Search or filter to find components.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium">
                  2
                </div>
                <div>
                  <p className="font-medium text-foreground">
                    Install a component or service
                  </p>
                  <p className="text-muted-foreground">
                    Click Install, select your deployment, and wait for the PVC
                    sync to complete. The pod restarts automatically.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium">
                  3
                </div>
                <div>
                  <p className="font-medium text-foreground">
                    Chat with your bot
                  </p>
                  <p className="text-muted-foreground">
                    Ask the bot to use the new component. It will appear in the
                    bot&apos;s available component list and can be rendered via the{" "}
                    <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                      render_ui
                    </code>{" "}
                    MCP tool.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium">
                  4
                </div>
                <div>
                  <p className="font-medium text-foreground">
                    Publish your own
                  </p>
                  <p className="text-muted-foreground">
                    Create a creator profile, define a manifest, set pricing,
                    and submit for review. Your component will appear in the
                    marketplace once approved.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Static data for tables
 * --------------------------------------------------------------------------- */

const VALIDATION_RULES = [
  { name: "Name format", description: "Component name must be lowercase snake_case, 2-50 characters" },
  { name: "Name uniqueness", description: "Name must not conflict with any built-in component name" },
  { name: "Description length", description: "Description must be 10-500 characters" },
  { name: "Category valid", description: "Must be one of: display, chart, interactive, media, specialized" },
  { name: "Schema required", description: "Zod schema must be provided and parseable" },
  { name: "Schema fields", description: "Schema must define at least one prop" },
  { name: "Code content", description: "Code-tier components must include HTML content" },
  { name: "Template base", description: "Template-tier components must reference a valid base component" },
  { name: "Library URLs", description: "All library URLs must be from the 10 trusted CDN origins" },
  { name: "configSchema", description: "If present, must be valid JSON Schema (draft-07 or later)" },
  { name: "SDK version", description: "Must declare a supported SDK version (currently 1.0)" },
  { name: "Size limits", description: "Total manifest size must not exceed 512 KB" },
  { name: "No external fetch", description: "Code must not contain fetch/XMLHttpRequest to non-CDN origins" },
] as const;

const COMPONENT_TABLES = [
  { name: "marketplaceComponents", purpose: "Published components with manifest, code, author, pricing, and review status" },
  { name: "componentVersions", purpose: "Version history with changelogs for each component" },
  { name: "componentInstalls", purpose: "Tracks which components are installed on which deployments" },
  { name: "componentPurchases", purpose: "Purchase records linking buyers to paid components" },
  { name: "componentReviews", purpose: "User ratings (1-5 stars) and written reviews" },
  { name: "marketplaceCreators", purpose: "Creator profiles with display name, bio, and aggregate stats" },
] as const;

const SERVICE_TABLES = [
  { name: "marketplaceServices", purpose: "Published services with name, hosting model, instruction snippet, pricing, and status" },
  { name: "serviceComponents", purpose: "Many-to-many linking services to their included components" },
  { name: "serviceSkills", purpose: "Many-to-many linking services to their included skills" },
  { name: "serviceInstalls", purpose: "Tracks which services are installed on which deployments" },
] as const;

const MARKETPLACE_PROCEDURES = [
  { name: "list", description: "Browse components with search, category, and pricing filters" },
  { name: "get", description: "Get full component details including manifest, versions, and reviews" },
  { name: "install", description: "Install a component to a deployment (creates install record, syncs to PVC)" },
  { name: "uninstall", description: "Remove a component from a deployment" },
  { name: "publish", description: "Submit a new component for review" },
  { name: "update", description: "Update an existing published component (creates new version)" },
  { name: "listByCreator", description: "List all components published by a creator" },
  { name: "createReview", description: "Submit a rating and review for an installed component" },
  { name: "getReviews", description: "Get reviews for a component" },
  { name: "createCreator", description: "Create or update a creator profile" },
  { name: "getCreator", description: "Get a creator profile with aggregate stats" },
] as const;

const SERVICES_PROCEDURES = [
  { name: "list", description: "Browse services with search and filter" },
  { name: "get", description: "Get full service details including components, skills, and instruction snippet" },
  { name: "install", description: "Atomic install: components + skills + instruction snippet + single PVC sync" },
  { name: "uninstall", description: "Atomic uninstall: reverses all install records and syncs" },
  { name: "publish", description: "Submit a new service for review" },
  { name: "listByCreator", description: "List all services published by a creator" },
] as const;
