"use client";

import { Layers, Puzzle, Wrench, Split, Shield, Cpu, Code } from "lucide-react";
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
 * Page: Components Reference
 * Path: /docs/components
 * --------------------------------------------------------------------------- */

export default function ComponentsPage() {
  return (
    <div className="space-y-12">
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Layers className="h-5 w-5" />
          </div>
          <h1 className="font-serif text-3xl font-medium tracking-tight">
            Components Reference
          </h1>
        </div>
        <p className="text-muted-foreground leading-relaxed max-w-[700px]">
          Jarble bots render rich, interactive UI components inline in
          conversations. This page documents all 37 built-in components, the
          sandbox system, the AutoFix repair pipeline, and how components are
          rendered.
        </p>
      </div>

      {/* ── How It Works ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-medium tracking-tight">
          How Canvas Components Work
        </h2>
        <p className="text-muted-foreground leading-relaxed">
          When your bot needs to display structured data, charts, forms, or any
          visual element beyond plain text, it uses the{" "}
          <code className="rounded bg-secondary px-1.5 py-0.5 text-sm font-mono">
            render_ui
          </code>{" "}
          MCP tool. This tool outputs a{" "}
          <code className="rounded bg-secondary px-1.5 py-0.5 text-sm font-mono">
            jarble_ui
          </code>{" "}
          fenced block containing JSON that specifies a component type and its
          props.
        </p>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Rendering Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <ol className="list-decimal list-inside space-y-2">
              <li>
                Bot calls{" "}
                <code className="rounded bg-secondary px-1.5 py-0.5 font-mono">
                  render_ui
                </code>{" "}
                with a component type and props
              </li>
              <li>
                API streams the response as SSE events including{" "}
                <code className="rounded bg-secondary px-1.5 py-0.5 font-mono">
                  UI_BLOCK_START
                </code>
                ,{" "}
                <code className="rounded bg-secondary px-1.5 py-0.5 font-mono">
                  UI_BLOCK_PROPS
                </code>
                , and{" "}
                <code className="rounded bg-secondary px-1.5 py-0.5 font-mono">
                  UI_BLOCK_END
                </code>
              </li>
              <li>
                Frontend parses the{" "}
                <code className="rounded bg-secondary px-1.5 py-0.5 font-mono">
                  jarble_ui
                </code>{" "}
                fenced block using a brace-depth JSON parser
              </li>
              <li>
                <strong>AutoFix</strong> runs 20 repair rules and 30+ name
                aliases to normalize the props
              </li>
              <li>
                Props are validated against a <strong>Zod schema</strong> defined
                in the component manifest
              </li>
              <li>
                The component renders inside a responsive canvas grid with
                drag-to-reorder support
              </li>
            </ol>
          </CardContent>
        </Card>

        <div className="space-y-2">
          <p className="text-sm font-medium">Example bot output:</p>
          <pre className="bg-secondary rounded-lg p-4 text-sm font-mono overflow-x-auto">
            <code>{`\`\`\`jarble_ui
{
  "component": "chart",
  "props": {
    "type": "bar",
    "title": "Monthly Revenue",
    "data": [
      { "month": "Jan", "revenue": 4200 },
      { "month": "Feb", "revenue": 5100 },
      { "month": "Mar", "revenue": 6800 }
    ],
    "dataKeys": ["revenue"],
    "xAxisKey": "month"
  }
}
\`\`\``}</code>
          </pre>
        </div>
      </section>

      {/* ── Component Categories ─────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-medium tracking-tight">
          Component Categories
        </h2>
        <p className="text-muted-foreground leading-relaxed">
          All 37 components are organized into five categories. Components
          marked as <Badge variant="outline">dynamic</Badge> are lazy-loaded on
          the frontend for bundle optimization.
        </p>

        <Tabs defaultValue="display">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="display">Display</TabsTrigger>
            <TabsTrigger value="chart">Charts</TabsTrigger>
            <TabsTrigger value="interactive">Interactive</TabsTrigger>
            <TabsTrigger value="media">Media</TabsTrigger>
            <TabsTrigger value="specialized">Specialized</TabsTrigger>
          </TabsList>

          {/* Display */}
          <TabsContent value="display" className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Core content components for displaying text, data, metrics, and
              structured information.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Component</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[80px]">Loading</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DISPLAY_COMPONENTS.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="font-mono text-sm">
                      {c.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {c.description}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          c.loading === "dynamic" ? "secondary" : "outline"
                        }
                      >
                        {c.loading}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>

          {/* Chart */}
          <TabsContent value="chart" className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              A unified recharts-based chart component supporting multiple
              chart types. Replaces the previous 22 separate Ant Design chart
              components.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Component</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[80px]">Loading</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-mono text-sm">chart</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    Bar, line, pie, or area chart (Recharts). Supports
                    composed multi-series charts.
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">dynamic</Badge>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TabsContent>

          {/* Interactive */}
          <TabsContent value="interactive" className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Components that accept user input or provide navigation. These
              dispatch{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                UI_ACTION
              </code>{" "}
              callbacks when users interact with them.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Component</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[80px]">Loading</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {INTERACTIVE_COMPONENTS.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="font-mono text-sm">
                      {c.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {c.description}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          c.loading === "dynamic" ? "secondary" : "outline"
                        }
                      >
                        {c.loading}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>

          {/* Media */}
          <TabsContent value="media" className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Components for images, video, audio, and embedded third-party
              content.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]">Component</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[80px]">Loading</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MEDIA_COMPONENTS.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="font-mono text-sm">
                      {c.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {c.description}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          c.loading === "dynamic" ? "secondary" : "outline"
                        }
                      >
                        {c.loading}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>

          {/* Specialized */}
          <TabsContent value="specialized" className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Advanced components for code editing, maps, spreadsheets, and
              custom sandboxed HTML/JS applications.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Component</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[80px]">Loading</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SPECIALIZED_COMPONENTS.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="font-mono text-sm">
                      {c.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {c.description}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          c.loading === "dynamic" ? "secondary" : "outline"
                        }
                      >
                        {c.loading}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      </section>

      {/* ── Full Component Reference ─────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-medium tracking-tight">
          Full Component Reference
        </h2>
        <p className="text-muted-foreground leading-relaxed">
          Complete reference for all 37 components with their key props. Props
          marked with <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">?</code> are
          optional. All props are validated against Zod schemas before rendering.
        </p>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">Component</TableHead>
                <TableHead className="w-[100px]">Category</TableHead>
                <TableHead>Key Props</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ALL_COMPONENTS.map((c) => (
                <TableRow key={c.name}>
                  <TableCell className="font-mono text-sm font-medium">
                    {c.name}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {c.category}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm font-mono">
                    {c.reference}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* ── JSON Examples ────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-medium tracking-tight">
          Prop Examples
        </h2>
        <p className="text-muted-foreground leading-relaxed">
          Real JSON examples showing how to use the most common components.
        </p>

        <Tabs defaultValue="stat_grid">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="stat_grid">stat_grid</TabsTrigger>
            <TabsTrigger value="data_table">data_table</TabsTrigger>
            <TabsTrigger value="chart">chart</TabsTrigger>
            <TabsTrigger value="form">form</TabsTrigger>
            <TabsTrigger value="sandbox">sandbox</TabsTrigger>
            <TabsTrigger value="map">map</TabsTrigger>
          </TabsList>

          <TabsContent value="stat_grid" className="mt-4">
            <pre className="bg-secondary rounded-lg p-4 text-sm font-mono overflow-x-auto">
              <code>{`{
  "component": "stat_grid",
  "props": {
    "stats": [
      { "label": "Total Users", "value": 12450, "change": 12.5, "icon": "users" },
      { "label": "Revenue", "value": 84200, "change": -3.2, "icon": "dollar-sign" },
      { "label": "Active Sessions", "value": 342, "change": 8.1 },
      { "label": "Conversion Rate", "value": "3.2%", "change": 0.4 }
    ]
  }
}`}</code>
            </pre>
          </TabsContent>

          <TabsContent value="data_table" className="mt-4">
            <pre className="bg-secondary rounded-lg p-4 text-sm font-mono overflow-x-auto">
              <code>{`{
  "component": "data_table",
  "props": {
    "title": "Recent Orders",
    "columns": ["Order ID", "Customer", "Amount", "Status"],
    "rows": [
      ["#1001", "Alice Johnson", "$250.00", "Shipped"],
      ["#1002", "Bob Smith", "$120.50", "Processing"],
      ["#1003", "Carol White", "$89.99", "Delivered"]
    ]
  }
}`}</code>
            </pre>
          </TabsContent>

          <TabsContent value="chart" className="mt-4">
            <pre className="bg-secondary rounded-lg p-4 text-sm font-mono overflow-x-auto">
              <code>{`{
  "component": "chart",
  "props": {
    "type": "line",
    "title": "Weekly Active Users",
    "data": [
      { "week": "W1", "users": 1200, "new_signups": 340 },
      { "week": "W2", "users": 1450, "new_signups": 410 },
      { "week": "W3", "users": 1380, "new_signups": 290 },
      { "week": "W4", "users": 1620, "new_signups": 520 }
    ],
    "dataKeys": ["users", "new_signups"],
    "xAxisKey": "week",
    "showLegend": true,
    "showGrid": true
  }
}`}</code>
            </pre>
          </TabsContent>

          <TabsContent value="form" className="mt-4">
            <pre className="bg-secondary rounded-lg p-4 text-sm font-mono overflow-x-auto">
              <code>{`{
  "component": "form",
  "props": {
    "title": "Contact Form",
    "fields": [
      { "name": "name", "label": "Full Name", "type": "text", "required": true },
      { "name": "email", "label": "Email", "type": "email", "required": true },
      { "name": "priority", "label": "Priority", "type": "select",
        "options": ["Low", "Medium", "High"] },
      { "name": "message", "label": "Message", "type": "textarea",
        "placeholder": "Describe your issue..." }
    ],
    "submitLabel": "Send Message"
  }
}`}</code>
            </pre>
          </TabsContent>

          <TabsContent value="sandbox" className="mt-4">
            <pre className="bg-secondary rounded-lg p-4 text-sm font-mono overflow-x-auto">
              <code>{`{
  "component": "sandbox",
  "props": {
    "title": "3D Rotating Cube",
    "html": "<div id='container'></div>",
    "css": "#container { width: 100%; height: 400px; }",
    "js": "const scene = new THREE.Scene(); ...",
    "libraries": [
      "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"
    ],
    "height": 450
  }
}`}</code>
            </pre>
          </TabsContent>

          <TabsContent value="map" className="mt-4">
            <pre className="bg-secondary rounded-lg p-4 text-sm font-mono overflow-x-auto">
              <code>{`{
  "component": "map",
  "props": {
    "center": [37.7749, -122.4194],
    "zoom": 12,
    "title": "San Francisco Offices",
    "markers": [
      { "lat": 37.7749, "lng": -122.4194, "label": "HQ" },
      { "lat": 37.7849, "lng": -122.4094, "label": "Engineering" }
    ]
  }
}`}</code>
            </pre>
          </TabsContent>
        </Tabs>
      </section>

      {/* ── Sandbox Deep Dive ────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="font-serif text-2xl font-medium tracking-tight">
            Sandbox Component
          </h2>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          The{" "}
          <code className="rounded bg-secondary px-1.5 py-0.5 text-sm font-mono">
            sandbox
          </code>{" "}
          component renders arbitrary HTML, CSS, and JavaScript inside a
          secure iframe. It is the most powerful component, enabling 3D
          visualizations (Three.js), data visualizations (D3), animations,
          gauges, and any custom UI not covered by the built-in components.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base font-medium">
                Security Model
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <ul className="list-disc list-inside space-y-1.5">
                <li>
                  Runs in an iframe with{" "}
                  <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">
                    sandbox=&quot;allow-scripts allow-popups&quot;
                  </code>{" "}
                  (no same-origin access)
                </li>
                <li>
                  Content Security Policy restricts scripts and styles to 10
                  trusted CDN origins
                </li>
                <li>
                  Heartbeat watchdog kills sandboxes after 15 seconds of
                  silence (3 missed heartbeats at 5-second intervals)
                </li>
                <li>
                  Max 3 auto-fix attempts per card per 60-second window to
                  prevent infinite error loops
                </li>
                <li>
                  Server-side library URL validation against the CDN
                  allowlist before reaching the client
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base font-medium">
                Trusted CDN Origins
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <p className="mb-2">
                Only libraries from these 10 CDN origins are allowed:
              </p>
              <ul className="list-none space-y-1 font-mono text-xs">
                <li>cdn.jsdelivr.net</li>
                <li>cdnjs.cloudflare.com</li>
                <li>unpkg.com</li>
                <li>cdn.tailwindcss.com</li>
                <li>esm.sh</li>
                <li>threejs.org</li>
                <li>d3js.org</li>
                <li>cdn.plot.ly</li>
                <li>fonts.googleapis.com</li>
                <li>fonts.gstatic.com</li>
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Bridge API (window.jarble.*)
            </CardTitle>
            <CardDescription>
              Sandboxed code can communicate with the host application through
              a postMessage bridge exposed as{" "}
              <code className="font-mono text-xs">window.jarble</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[260px]">Method</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {BRIDGE_API.map((item) => (
                    <TableRow key={item.method}>
                      <TableCell className="font-mono text-sm">
                        {item.method}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {item.description}
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
              configSchema Support
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              Sandbox components can define a{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                configSchema
              </code>{" "}
              (JSON Schema) in their props. When present, the frontend renders
              a configuration panel that lets users adjust parameters without
              touching code. The current config values are available via{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                jarble.config
              </code>{" "}
              in the sandbox JavaScript.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Marketplace Sandbox
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              The{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                marketplace_sandbox
              </code>{" "}
              component provides an additional layer of isolation for
              user-submitted marketplace components. It uses a double-iframe
              architecture: an inner iframe runs with an opaque origin inside
              an outer{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                about:blank
              </code>{" "}
              iframe. Props are identical to the standard sandbox.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* ── AutoFix System ───────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Wrench className="h-5 w-5 text-primary" />
          <h2 className="font-serif text-2xl font-medium tracking-tight">
            AutoFix Prop Repair
          </h2>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          LLMs frequently produce props with minor errors: wrong casing, type
          mismatches, missing defaults, or field name aliases. The AutoFix
          system applies 20 high-confidence repair rules before Zod validation
          to maximize successful renders.
        </p>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Repair Categories
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">Category</TableHead>
                    <TableHead>Examples</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {AUTOFIX_CATEGORIES.map((cat) => (
                    <TableRow key={cat.name}>
                      <TableCell className="text-sm font-medium">
                        {cat.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {cat.examples}
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
              Component Name Aliases (30+)
            </CardTitle>
            <CardDescription>
              AutoFix normalizes common alternative names to canonical component
              names. This allows LLMs to use natural language names.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">LLM Output</TableHead>
                    <TableHead>Resolves To</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {NAME_ALIAS_EXAMPLES.map((alias) => (
                    <TableRow key={alias.from}>
                      <TableCell className="font-mono text-sm">
                        {alias.from}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {alias.to}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <p className="text-sm text-muted-foreground">
          Every applied repair is recorded as a Sentry breadcrumb with the rule
          name, enabling frequency tracking and identification of common LLM
          mistakes across the fleet.
        </p>
      </section>

      {/* ── Splittable Components ────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Split className="h-5 w-5 text-primary" />
          <h2 className="font-serif text-2xl font-medium tracking-tight">
            Splittable Components
          </h2>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          Certain multi-item components can be split into individual cards in
          the canvas grid. Users click the split button on a card to break it
          apart, and compatible cards can be merged back together.
        </p>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[160px]">Component</TableHead>
              <TableHead className="w-[160px]">Splits Into</TableHead>
              <TableHead>Items Key</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono text-sm">stat_grid</TableCell>
              <TableCell className="font-mono text-sm">metric_card</TableCell>
              <TableCell className="text-muted-foreground text-sm">
                stats
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">key_value</TableCell>
              <TableCell className="font-mono text-sm">card</TableCell>
              <TableCell className="text-muted-foreground text-sm">
                items
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">descriptions</TableCell>
              <TableCell className="font-mono text-sm">card</TableCell>
              <TableCell className="text-muted-foreground text-sm">
                items
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">data_table</TableCell>
              <TableCell className="font-mono text-sm">data_table</TableCell>
              <TableCell className="text-muted-foreground text-sm">
                rows
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">list</TableCell>
              <TableCell className="font-mono text-sm">card</TableCell>
              <TableCell className="text-muted-foreground text-sm">
                items
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">timeline</TableCell>
              <TableCell className="font-mono text-sm">card</TableCell>
              <TableCell className="text-muted-foreground text-sm">
                events
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono text-sm">tabs</TableCell>
              <TableCell className="font-mono text-sm">card</TableCell>
              <TableCell className="text-muted-foreground text-sm">
                tabs
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      {/* ── Canvas Grid ──────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Puzzle className="h-5 w-5 text-primary" />
          <h2 className="font-serif text-2xl font-medium tracking-tight">
            Canvas Grid
          </h2>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          Components render in a responsive CSS grid with drag-to-reorder,
          split/merge controls, and keyboard navigation. The grid uses{" "}
          <code className="rounded bg-secondary px-1 py-0.5 text-sm font-mono">
            role=&quot;grid&quot;
          </code>{" "}
          and{" "}
          <code className="rounded bg-secondary px-1 py-0.5 text-sm font-mono">
            role=&quot;gridcell&quot;
          </code>{" "}
          for accessibility.
        </p>
        <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1.5">
          <li>
            Arrow keys move focus between cards; Enter/Space activates controls
          </li>
          <li>
            Drag any card to swap positions via{" "}
            <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">
              aria-grabbed
            </code>{" "}
            and{" "}
            <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">
              aria-dropeffect=&quot;move&quot;
            </code>
          </li>
          <li>
            All action buttons meet WCAG 2.2 AA minimum touch target size
            (28px)
          </li>
          <li>
            Components flow at their content size with layout hints (full-width,
            half, third, compact)
          </li>
        </ul>
      </section>

      {/* ── Component Alias Reference ────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Code className="h-5 w-5 text-primary" />
          <h2 className="font-serif text-2xl font-medium tracking-tight">
            Component Name Alias
          </h2>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          In addition to the 37 canonical component names, the{" "}
          <code className="rounded bg-secondary px-1.5 py-0.5 text-sm font-mono">
            canvas
          </code>{" "}
          name is an alias for{" "}
          <code className="rounded bg-secondary px-1.5 py-0.5 text-sm font-mono">
            sandbox
          </code>
          . LLMs frequently use &quot;canvas&quot; when they mean the sandbox component,
          so this alias is built into the registry.
        </p>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Static data for tables
 * --------------------------------------------------------------------------- */

const DISPLAY_COMPONENTS = [
  { name: "card", description: "Simple card with title, subtitle, and body text (supports markdown)", loading: "static" },
  { name: "stat_grid", description: "Grid of metric cards with labels, values, and optional change indicators", loading: "static" },
  { name: "data_table", description: "Table with column headers and data rows", loading: "static" },
  { name: "key_value", description: "List of key-value pairs", loading: "static" },
  { name: "descriptions", description: "Key-value description list with optional column span and borders", loading: "dynamic" },
  { name: "metric_card", description: "Single metric display with optional sparkline chart", loading: "static" },
  { name: "statistic", description: "Large number display with optional countdown", loading: "dynamic" },
  { name: "result", description: "Status result page with icon (success, error, info, warning)", loading: "dynamic" },
  { name: "badge", description: "Small label/tag with variant styling", loading: "static" },
  { name: "alert", description: "Notification banner (info, success, warning, error)", loading: "static" },
  { name: "progress", description: "Progress bar with label and percentage", loading: "static" },
  { name: "header", description: "Section heading with optional subtitle and divider", loading: "static" },
  { name: "divider", description: "Visual separator with optional label", loading: "static" },
  { name: "list", description: "Structured list with optional icons, descriptions, and badges", loading: "static" },
  { name: "timeline", description: "Chronological event timeline with status indicators", loading: "static" },
  { name: "steps", description: "Step-by-step progress indicator", loading: "dynamic" },
  { name: "tree", description: "Expandable tree hierarchy", loading: "dynamic" },
  { name: "tag_cloud", description: "Collection of colored tags for categorization", loading: "dynamic" },
  { name: "blockquote", description: "Styled quote block with attribution", loading: "static" },
  { name: "text_message", description: "Chat-style message bubble", loading: "static" },
  { name: "avatar", description: "User avatar with image or initials fallback", loading: "static" },
  { name: "code_block", description: "Syntax-highlighted code snippet", loading: "static" },
  { name: "layout", description: "Container that renders an array of child components", loading: "static" },
  { name: "reasoning", description: "Collapsible AI thinking/chain-of-thought block", loading: "static" },
  { name: "tool", description: "Function/tool call visualization with inputs, status, and outputs", loading: "static" },
  { name: "sources", description: "Citation and reference list with expandable snippets", loading: "static" },
];

const INTERACTIVE_COMPONENTS = [
  { name: "button_group", description: "Row of action buttons that dispatch UI_ACTION callbacks on click", loading: "static" },
  { name: "form", description: "Input form with text, email, textarea, select, checkbox, number fields", loading: "static" },
  { name: "tabs", description: "Tabbed content panels with optional nested child components", loading: "static" },
  { name: "accordion", description: "Collapsible sections with titles and content", loading: "static" },
];

const MEDIA_COMPONENTS = [
  { name: "image", description: "Image with optional alt text and caption", loading: "static" },
  { name: "image_gallery", description: "Grid of images with click-to-zoom modal", loading: "dynamic" },
  { name: "video", description: "Video/livestream player (YouTube, Twitch, Vimeo, direct URLs)", loading: "dynamic" },
  { name: "audio", description: "HTML5 audio player with controls", loading: "static" },
  { name: "carousel", description: "Swipeable slide carousel with navigation", loading: "dynamic" },
  { name: "embed", description: "Third-party widget embed (Google Maps, TradingView, Spotify, CodePen, Figma)", loading: "dynamic" },
];

const SPECIALIZED_COMPONENTS = [
  { name: "code_editor", description: "Monaco code editor with syntax highlighting", loading: "dynamic" },
  { name: "spreadsheet", description: "Editable Excel-like spreadsheet grid", loading: "dynamic" },
  { name: "sandbox", description: "Sandboxed iframe for custom HTML/CSS/JS mini-apps", loading: "dynamic" },
  { name: "marketplace_sandbox", description: "Double-iframe sandbox for marketplace components (extra isolation)", loading: "dynamic" },
  { name: "map", description: "Interactive Leaflet map with markers", loading: "dynamic" },
];

const ALL_COMPONENTS = [
  { name: "card", category: "display", reference: "{title?, subtitle?, body?}" },
  { name: "stat_grid", category: "display", reference: "{stats: [{label, value, change?, icon?}]}" },
  { name: "data_table", category: "display", reference: "{title?, columns: string[], rows: (string|number)[][]}" },
  { name: "key_value", category: "display", reference: "{title?, items: [{key, value}]}" },
  { name: "descriptions", category: "display", reference: "{title?, items: [{label, value, span?}], columns?, bordered?}" },
  { name: "metric_card", category: "display", reference: "{label, value, change?, changeLabel?, icon?, sparkline?: number[]}" },
  { name: "statistic", category: "display", reference: "{value, title?, prefix?, suffix?, precision?, isCountdown?, countdownTarget?}" },
  { name: "result", category: "display", reference: '{status: "success"|"error"|"info"|"warning", title, subtitle?}' },
  { name: "badge", category: "display", reference: '{text, variant?: "default"|"secondary"|"destructive"|"outline"|"success"|"warning"|"info", icon?}' },
  { name: "alert", category: "display", reference: '{title?, message, variant: "info"|"success"|"warning"|"error"}' },
  { name: "progress", category: "display", reference: '{label?, value: 0-100, variant?: "default"|"success"|"warning"|"error"}' },
  { name: "header", category: "display", reference: "{title, subtitle?, level?: 1|2|3, divider?}" },
  { name: "divider", category: "display", reference: '{label?, variant?: "solid"|"dashed"|"dotted", spacing?: "sm"|"md"|"lg"}' },
  { name: "list", category: "display", reference: "{title?, items: [{text, description?, icon?, badge?, badgeVariant?}], ordered?}" },
  { name: "timeline", category: "display", reference: '{title?, events: [{label, description?, timestamp?, icon?, status?: "completed"|"active"|"pending"}]}' },
  { name: "steps", category: "display", reference: '{current, items: [{title, description?, icon?}], direction?: "vertical"|"horizontal"}' },
  { name: "tree", category: "display", reference: "{data: [{title, key, children?}], title?, defaultExpandAll?}" },
  { name: "tag_cloud", category: "display", reference: '{tags: [{text, color?, size?: "small"|"medium"|"large"}], title?}' },
  { name: "blockquote", category: "display", reference: '{text, attribution?, variant?: "default"|"info"|"warning"}' },
  { name: "text_message", category: "display", reference: "{botText, userText?}" },
  { name: "avatar", category: "display", reference: '{name, src?, subtitle?, size?: "sm"|"md"|"lg"}' },
  { name: "code_block", category: "display", reference: "{code, language?, title?}" },
  { name: "layout", category: "display", reference: '{children: [{component, props}], columns?: 1-4, direction?: "grid"|"vertical"|"horizontal"}' },
  { name: "reasoning", category: "display", reference: "{title?, content, collapsed?, duration?, steps?: [{label, description?, status?}]}" },
  { name: "tool", category: "display", reference: '{name, status: "running"|"complete"|"error", description?, inputs?, output?, error?, duration?}' },
  { name: "sources", category: "display", reference: "{items: [{title, url?, snippet?, icon?, relevance?}], title?}" },
  { name: "chart", category: "chart", reference: '{type: "bar"|"line"|"pie"|"area", data: [{...}], dataKeys: string[], xAxisKey?, title?, colors?, stacked?, showLegend?, showGrid?}' },
  { name: "button_group", category: "interactive", reference: '{buttons: [{id, label, variant?: "default"|"secondary"|"destructive"|"outline", icon?, disabled?}]}' },
  { name: "form", category: "interactive", reference: '{title?, fields: [{name, label, type: "text"|"email"|"textarea"|"select"|"checkbox"|"number", placeholder?, required?, options?, defaultValue?}], submitLabel?}' },
  { name: "tabs", category: "interactive", reference: "{tabs: [{label, content?, children?: [{component, props}]}], defaultTab?}" },
  { name: "accordion", category: "interactive", reference: '{items: [{title, content?, children?, defaultOpen?}], type?: "single"|"multiple"}' },
  { name: "image", category: "media", reference: "{src, alt?, caption?}" },
  { name: "image_gallery", category: "media", reference: "{images: [{src, alt?, caption?}], title?, columns?}" },
  { name: "video", category: "media", reference: "{url, title?, controls?: true, loop?: false, muted?: false}" },
  { name: "audio", category: "media", reference: "{src, title?, autoplay?}" },
  { name: "carousel", category: "media", reference: "{items: [{title?, description?, image?}], autoplay?}" },
  { name: "embed", category: "media", reference: "{url, title?, height?, provider?}" },
  { name: "code_editor", category: "specialized", reference: "{code, language?, title?, readOnly?, height?}" },
  { name: "spreadsheet", category: "specialized", reference: "{data?: [{...}], title?, height?}" },
  { name: "sandbox", category: "specialized", reference: "{html, css?, js?, props?: {}, height?, title?, libraries?: string[], configSchema?: object}" },
  { name: "marketplace_sandbox", category: "specialized", reference: "{html, css?, js?, props?: {}, height?, title?, libraries?: string[], marketplaceId?: string}" },
  { name: "map", category: "specialized", reference: "{center: [lat, lng], zoom?, markers?: [{lat, lng, label?}], title?}" },
] as const;

const BRIDGE_API = [
  { method: "jarble.send(action, payload)", description: "Send an action to the host application (e.g., button clicks, form submissions)" },
  { method: "jarble.theme", description: "Current theme object with color tokens from the host" },
  { method: "jarble.storage.get(key)", description: "Read from scoped localStorage (1 MB quota per sandbox)" },
  { method: "jarble.storage.set(key, value)", description: "Write to scoped localStorage" },
  { method: "jarble.storage.delete(key)", description: "Delete a key from scoped localStorage" },
  { method: "jarble.events.on(event, fn)", description: "Subscribe to inter-component pub/sub events" },
  { method: "jarble.events.emit(event, data)", description: "Emit an event to other components" },
  { method: "jarble.canvas.resize(w, h)", description: "Request a canvas card resize" },
  { method: "jarble.canvas.setTitle(title)", description: "Update the card title dynamically" },
  { method: "jarble.heartbeat()", description: "Manually send a heartbeat (auto-sent every 5 seconds)" },
  { method: "jarble.config", description: "Current configSchema values (read-only object)" },
  { method: "jarble.reportProgress(pct)", description: "Report loading progress (0-100) to the host" },
  { method: "jarble.sdkVersion", description: 'Current SDK version string ("1.0")' },
] as const;

const AUTOFIX_CATEGORIES = [
  { name: "Type Coercion", examples: '"75" to 75 for numeric fields, "true" to true for booleans, 42 to "42" for label fields' },
  { name: "Enum Normalization", examples: '"danger" to "destructive", "Line" to "line", "small" to "sm", "doughnut" to "pie"' },
  { name: "Missing Defaults", examples: 'alert variant defaults to "info", steps current defaults to 0, infer chart xAxisKey from data' },
  { name: "Structural Fixes", examples: "Unwrap nested {props: {...}}, wrap single object to array, convert chart.js format to recharts" },
  { name: "Field Aliases", examples: 'content to body (card), description to message (alert), name to label (metric_card), data to items (list)' },
  { name: "Data Normalization", examples: '"75%" to 75 for progress, mixed string/number sparkline arrays to all numbers' },
] as const;

const NAME_ALIAS_EXAMPLES = [
  { from: "DataTable / dataTable / table", to: "data_table" },
  { from: "graph / plot / bar_chart / line_chart", to: "chart" },
  { from: "kpi / stats", to: "metric_card / stat_grid" },
  { from: "notification / warning", to: "alert" },
  { from: "markdown / text", to: "card" },
  { from: "quote", to: "blockquote" },
  { from: "stepper", to: "steps" },
  { from: "widget / iframe / web_embed", to: "embed" },
  { from: "status", to: "result" },
  { from: "tree_view", to: "tree" },
] as const;
