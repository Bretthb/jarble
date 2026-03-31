import type { Metadata } from "next";
import Link from "next/link";
import {
  BookOpen,
  Cpu,
  Key,
  MessageSquare,
  Activity,
  Settings,
  CreditCard,
  LayoutDashboard,
  ChevronRight,
  Lightbulb,
  Info,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Platform Guide",
  description:
    "Understand Jarble deployments, runtimes, LLM providers, and messaging platform integration.",
};

/* ------------------------------------------------------------------ */
/*  Inline helpers (server component - no hooks)                       */
/* ------------------------------------------------------------------ */

function SectionHeading({
  id,
  icon: Icon,
  children,
}: {
  id: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      className="flex items-center gap-3 font-serif text-2xl font-medium tracking-tight scroll-mt-24"
    >
      <Icon className="h-5 w-5 text-muted-foreground" />
      {children}
    </h2>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="font-medium text-lg">{children}</h3>;
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <Card className="border border-border bg-muted/50">
      <CardContent className="flex items-start gap-3 py-3">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
        <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
      </CardContent>
    </Card>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <Card className="border border-border bg-muted/50">
      <CardContent className="flex items-start gap-3 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
        <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
      </CardContent>
    </Card>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <Card className="border border-destructive/30 bg-destructive/5">
      <CardContent className="flex items-start gap-3 py-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
      </CardContent>
    </Card>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-secondary px-1.5 py-0.5 rounded text-sm font-mono">
      {children}
    </code>
  );
}

function ExtLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

/* ------------------------------------------------------------------ */
/*  Table of contents data                                             */
/* ------------------------------------------------------------------ */

const TOC = [
  { id: "runtimes", label: "Runtimes" },
  { id: "llm-providers", label: "LLM Providers" },
  { id: "messaging-platforms", label: "Messaging Platforms" },
  { id: "deployment-lifecycle", label: "Deployment Lifecycle" },
  { id: "configuration", label: "Configuration" },
  { id: "credit-system", label: "Credit System" },
  { id: "dashboard", label: "Dashboard" },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function PlatformPage() {
  return (
    <div className="space-y-10">
      {/* ── Header ── */}
      <header className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <BookOpen className="h-5 w-5" />
          </div>
          <h1 className="font-serif text-3xl font-medium tracking-tight">
            Platform Guide
          </h1>
        </div>
        <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl">
          A comprehensive reference for Jarble&apos;s runtimes, LLM providers,
          messaging integrations, deployment lifecycle, and billing.
        </p>
      </header>

      {/* ── On this page ── */}
      <nav aria-label="On this page" className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          On this page
        </p>
        <ol className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {TOC.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground hover:bg-muted"
              >
                <ChevronRight className="h-3 w-3 shrink-0" />
                {item.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* ────────────────────────────────────────────────────────────── */}
      {/*  1. Runtimes                                                   */}
      {/* ────────────────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <SectionHeading id="runtimes" icon={Cpu}>
          Runtimes
        </SectionHeading>
        <p className="text-muted-foreground leading-relaxed">
          A runtime is the containerized environment that powers your bot. Each
          deployment runs inside its own Kubernetes pod with dedicated CPU,
          memory, and persistent storage.
        </p>

        {/* OpenClaw */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <SubHeading>OpenClaw</SubHeading>
            <Badge variant="secondary">Recommended</Badge>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">Node.js 22</Badge>
            <Badge variant="outline">MCP Tools</Badge>
            <Badge variant="outline">Rich UI</Badge>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            OpenClaw is a full-featured Node.js runtime built for production AI
            bots. It includes an MCP (Model Context Protocol) server that gives
            your bot access to tools like <Code>render_ui</Code>,{" "}
            <Code>define_component</Code>, and <Code>component_reference</Code>.
          </p>
          <p className="text-muted-foreground leading-relaxed">Key capabilities:</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground pl-1">
            <li>Rich UI rendering &mdash; 37 component types (charts, tables, forms, maps, 3D, code editors)</li>
            <li>Multi-platform messaging &mdash; Telegram, Discord, Slack, WhatsApp</li>
            <li>Skills &mdash; web search, weather, calculator, and custom skills</li>
            <li>Custom components &mdash; define reusable components that persist across conversations</li>
            <li>Sandbox mode &mdash; run arbitrary HTML/CSS/JS in a secure iframe with Three.js, D3, and more</li>
          </ul>
        </div>

        {/* ZeroClaw */}
        <div className="space-y-3">
          <SubHeading>ZeroClaw</SubHeading>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">Python</Badge>
            <Badge variant="outline">Lightweight</Badge>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            ZeroClaw is a lightweight Python runtime designed for simple
            text-based chat bots. It has lower resource requirements and faster
            startup times than OpenClaw but does not support MCP tools or rich
            UI rendering.
          </p>
          <p className="text-muted-foreground leading-relaxed">Best for:</p>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground pl-1">
            <li>Quick prototyping and experimentation</li>
            <li>Bots that only need conversational text responses</li>
            <li>Low-resource deployments</li>
          </ul>
        </div>

        {/* Comparison Table */}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted text-foreground">
                <th className="px-4 py-2.5 text-left font-medium">Feature</th>
                <th className="px-4 py-2.5 text-left font-medium">OpenClaw</th>
                <th className="px-4 py-2.5 text-left font-medium">ZeroClaw</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-4 py-2 text-muted-foreground">Language</td>
                <td className="px-4 py-2 text-muted-foreground">Node.js 22</td>
                <td className="px-4 py-2 text-muted-foreground">Python</td>
              </tr>
              <tr>
                <td className="px-4 py-2 text-muted-foreground">Rich UI components</td>
                <td className="px-4 py-2 text-green-600 dark:text-green-400">Yes (37 types)</td>
                <td className="px-4 py-2 text-muted-foreground">No</td>
              </tr>
              <tr>
                <td className="px-4 py-2 text-muted-foreground">MCP tools</td>
                <td className="px-4 py-2 text-green-600 dark:text-green-400">Yes</td>
                <td className="px-4 py-2 text-muted-foreground">No</td>
              </tr>
              <tr>
                <td className="px-4 py-2 text-muted-foreground">Messaging platforms</td>
                <td className="px-4 py-2 text-green-600 dark:text-green-400">Telegram, Discord, Slack, WhatsApp</td>
                <td className="px-4 py-2 text-green-600 dark:text-green-400">Telegram, Discord, Slack, WhatsApp</td>
              </tr>
              <tr>
                <td className="px-4 py-2 text-muted-foreground">Skills</td>
                <td className="px-4 py-2 text-green-600 dark:text-green-400">Yes</td>
                <td className="px-4 py-2 text-muted-foreground">No</td>
              </tr>
              <tr>
                <td className="px-4 py-2 text-muted-foreground">Custom sandbox</td>
                <td className="px-4 py-2 text-green-600 dark:text-green-400">Yes</td>
                <td className="px-4 py-2 text-muted-foreground">No</td>
              </tr>
              <tr>
                <td className="px-4 py-2 text-muted-foreground">Startup time</td>
                <td className="px-4 py-2 text-muted-foreground">30&ndash;90s</td>
                <td className="px-4 py-2 text-muted-foreground">10&ndash;30s</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────── */}
      {/*  2. LLM Providers                                              */}
      {/* ────────────────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <SectionHeading id="llm-providers" icon={Key}>
          LLM Providers
        </SectionHeading>
        <p className="text-muted-foreground leading-relaxed">
          Jarble supports four LLM providers. You can use Included Credits
          (OpenRouter, billed through Jarble) or bring your own API key from any
          provider. The wizard auto-detects the provider from the key prefix.
        </p>

        {/* OpenRouter */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <SubHeading>OpenRouter</SubHeading>
            <Badge variant="secondary">Recommended</Badge>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            A unified API gateway providing access to 200+ models from OpenAI,
            Anthropic, Google, Meta, Mistral, and others. Best for flexibility
            and cost optimization.
          </p>
          <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground pl-1">
            <li>Key prefix: <Code>sk-or-</Code></li>
            <li>Default model: <Code>openrouter/auto</Code> (routes to the best model per request)</li>
            <li>Available models: GPT-4o, Claude Sonnet 4, Claude Haiku 3.5, Gemini 2.0 Flash, and 200+ more</li>
            <li>Get a key: <ExtLink href="https://openrouter.ai/keys">openrouter.ai/keys</ExtLink></li>
          </ul>
        </div>

        {/* Anthropic */}
        <div className="space-y-2">
          <SubHeading>Anthropic</SubHeading>
          <p className="text-muted-foreground leading-relaxed">
            Direct access to the Claude model family. Use this if you have an
            Anthropic API key or a Claude Max subscription.
          </p>
          <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground pl-1">
            <li>Key prefix: <Code>sk-ant-</Code></li>
            <li>Models: Claude Opus 4 (most capable), Claude Sonnet 4 (balanced), Claude Haiku 3.5 (fast)</li>
            <li>Get a key: <ExtLink href="https://console.anthropic.com/settings/keys">console.anthropic.com</ExtLink></li>
          </ul>
          <InfoBox>
            <strong>Claude Max tokens</strong> (<Code>sk-ant-oat*</Code>) are
            automatically detected and use Bearer authentication. These tokens
            cannot be validated via the standard API and are accepted by prefix.
          </InfoBox>
        </div>

        {/* OpenAI */}
        <div className="space-y-2">
          <SubHeading>OpenAI</SubHeading>
          <p className="text-muted-foreground leading-relaxed">
            Direct access to GPT-4o, o1, and other OpenAI models.
          </p>
          <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground pl-1">
            <li>Key prefix: <Code>sk-</Code> (e.g., <Code>sk-proj-...</Code>)</li>
            <li>Models: GPT-4o (default), GPT-4o Mini, o1</li>
            <li>Get a key: <ExtLink href="https://platform.openai.com/api-keys">platform.openai.com</ExtLink></li>
          </ul>
        </div>

        {/* Google AI */}
        <div className="space-y-2">
          <SubHeading>Google AI</SubHeading>
          <p className="text-muted-foreground leading-relaxed">
            Direct access to Google&apos;s Gemini model family via AI Studio.
          </p>
          <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground pl-1">
            <li>Key prefix: <Code>AIza</Code></li>
            <li>Models: Gemini 2.0 Flash (default), Gemini 2.0 Pro</li>
            <li>Get a key: <ExtLink href="https://aistudio.google.com/apikey">aistudio.google.com</ExtLink></li>
          </ul>
        </div>

        <Tip>
          All API keys are encrypted with AES-256-GCM before being stored in the
          database and injected into your pod as Kubernetes Secrets. They are
          never logged or exposed in plaintext.
        </Tip>
      </section>

      {/* ────────────────────────────────────────────────────────────── */}
      {/*  3. Messaging Platforms                                        */}
      {/* ────────────────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <SectionHeading id="messaging-platforms" icon={MessageSquare}>
          Messaging Platforms
        </SectionHeading>
        <p className="text-muted-foreground leading-relaxed">
          Connect your bot to one or more messaging platforms from the{" "}
          <strong>Platforms</strong> tab in your deployment configuration. Each
          platform requires specific credentials and has its own setup flow.
        </p>

        {/* Telegram */}
        <div className="space-y-3">
          <SubHeading>Telegram</SubHeading>
          <p className="text-muted-foreground leading-relaxed">
            Telegram uses a bot token for authentication and a pairing flow for
            user authorization.
          </p>
          <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground pl-1">
            <li>Open Telegram and message <ExtLink href="https://t.me/BotFather">@BotFather</ExtLink>.</li>
            <li>Send <Code>/newbot</Code> and follow the prompts to create a bot.</li>
            <li>Copy the bot token (a long string of numbers and letters).</li>
            <li>Paste it into the Telegram field on the Platforms tab and save.</li>
            <li>Your bot restarts with Telegram enabled. Message your bot on Telegram.</li>
            <li>The bot sends a <strong>pairing code</strong>. Jarble automatically polls for pending pairings and approves them.</li>
            <li>The bot confirms pairing is complete. You can now chat freely.</li>
          </ol>
          <InfoBox>
            The pairing flow uses OpenClaw&apos;s <Code>dmPolicy: &quot;pairing&quot;</Code> mode.
            New users must be approved before they can interact with the bot,
            preventing unauthorized access.
          </InfoBox>
        </div>

        {/* Discord */}
        <div className="space-y-3">
          <SubHeading>Discord</SubHeading>
          <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground pl-1">
            <li>Go to the <ExtLink href="https://discord.com/developers/applications">Discord Developer Portal</ExtLink> and create a new application.</li>
            <li>Navigate to <strong>Bot</strong> in the sidebar and click <strong>Reset Token</strong> to generate a bot token.</li>
            <li>Enable the <strong>Message Content Intent</strong> under Privileged Gateway Intents.</li>
            <li>Use the OAuth2 URL generator to invite the bot to your server with the <Code>bot</Code> scope and <Code>Send Messages</Code> permission.</li>
            <li>Paste the bot token into the Discord field on the Platforms tab.</li>
          </ol>
        </div>

        {/* Slack */}
        <div className="space-y-3">
          <SubHeading>Slack</SubHeading>
          <p className="text-muted-foreground leading-relaxed">
            Slack requires two tokens: a Bot Token and an App-Level Token with
            Socket Mode enabled.
          </p>
          <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground pl-1">
            <li>Create a new app at <ExtLink href="https://api.slack.com/apps">api.slack.com/apps</ExtLink> using the &quot;From scratch&quot; option.</li>
            <li>Enable <strong>Socket Mode</strong> in the app settings and generate an <strong>App-Level Token</strong> with the <Code>connections:write</Code> scope.</li>
            <li>Under <strong>OAuth &amp; Permissions</strong>, add the <Code>chat:write</Code>, <Code>app_mentions:read</Code>, and <Code>im:history</Code> scopes.</li>
            <li>Install the app to your workspace and copy the Bot Token.</li>
            <li>Paste both tokens into the Slack fields on the Platforms tab: <Code>xoxb-</Code> (Bot Token) and <Code>xapp-</Code> (App Token).</li>
          </ol>
          <Warning>
            Both tokens are required. If you only provide the Bot Token, the
            Slack integration will not connect.
          </Warning>
        </div>

        {/* WhatsApp */}
        <div className="space-y-3">
          <SubHeading>WhatsApp</SubHeading>
          <p className="text-muted-foreground leading-relaxed">
            WhatsApp uses QR code pairing via WhatsApp Web. No Business API or
            developer account is needed.
          </p>
          <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground pl-1">
            <li>Open the Platforms tab and click <strong>Connect WhatsApp</strong>.</li>
            <li>A QR code appears. Scan it with your phone&apos;s WhatsApp app (Settings &gt; Linked Devices &gt; Link a Device).</li>
            <li>Once linked, your bot can send and receive messages through your WhatsApp number.</li>
          </ol>
          <InfoBox>
            The QR code streams in real time via SSE. If it expires, click
            <strong> Refresh</strong> to generate a new one.
          </InfoBox>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────── */}
      {/*  4. Deployment Lifecycle                                       */}
      {/* ────────────────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <SectionHeading id="deployment-lifecycle" icon={Activity}>
          Deployment Lifecycle
        </SectionHeading>
        <p className="text-muted-foreground leading-relaxed">
          Every deployment runs as a Kubernetes pod with its own persistent
          volume. The lifecycle is managed entirely through the Jarble dashboard
          &mdash; no infrastructure knowledge required.
        </p>

        <SubHeading>States</SubHeading>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted text-foreground">
                <th className="px-4 py-2.5 text-left font-medium">State</th>
                <th className="px-4 py-2.5 text-left font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-4 py-2"><Badge variant="secondary">Creating</Badge></td>
                <td className="px-4 py-2 text-muted-foreground">
                  Pod is being provisioned. Dependencies are installing. Typically 30&ndash;90 seconds for a first-time deployment.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2"><Badge className="bg-green-600 text-white border-transparent">Running</Badge></td>
                <td className="px-4 py-2 text-muted-foreground">
                  Bot is live and accepting messages via web chat and any connected messaging platforms.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2"><Badge variant="outline">Stopped</Badge></td>
                <td className="px-4 py-2 text-muted-foreground">
                  Pod has been scaled to zero. No resources are consumed. Data on the persistent volume is preserved.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2"><Badge variant="destructive">Failed</Badge></td>
                <td className="px-4 py-2 text-muted-foreground">
                  The pod failed to start or crashed. Check the Logs tab for error details. Common causes: invalid API key, npm cache corruption, resource limits exceeded.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <SubHeading>Controls</SubHeading>
        <p className="text-muted-foreground leading-relaxed">
          The deployment configuration panel provides three lifecycle controls:
        </p>
        <ul className="list-disc list-inside space-y-1.5 text-muted-foreground pl-1">
          <li>
            <strong className="text-foreground">Start</strong> &mdash; Scales the
            pod from zero to one replica. Resumes from the existing persistent
            volume (fast restart, no reinstall).
          </li>
          <li>
            <strong className="text-foreground">Stop</strong> &mdash; Scales the
            pod to zero. Frees compute resources while preserving all data.
          </li>
          <li>
            <strong className="text-foreground">Restart</strong> &mdash; Scales
            down then back up. Useful after configuration changes or to recover
            from errors.
          </li>
        </ul>

        <SubHeading>Real-Time Status</SubHeading>
        <p className="text-muted-foreground leading-relaxed">
          Status updates are delivered via Server-Sent Events (SSE). The
          dashboard badge updates automatically &mdash; no manual refresh needed.
          When you trigger a start or restart, you see the state transition in
          real time.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────────── */}
      {/*  5. Configuration                                              */}
      {/* ────────────────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <SectionHeading id="configuration" icon={Settings}>
          Configuration
        </SectionHeading>
        <p className="text-muted-foreground leading-relaxed">
          After deployment, configure your bot from the sidebar panel. Available
          tabs depend on your runtime. OpenClaw deployments have the most
          options: General, Model, Platforms, Skills, Components, Logs, and
          Advanced.
        </p>

        <SubHeading>System Prompt (soul.md)</SubHeading>
        <p className="text-muted-foreground leading-relaxed">
          The system prompt defines your bot&apos;s personality, behavior
          guidelines, and domain knowledge. It is written as Markdown and stored
          as <Code>soul.md</Code> on the pod. Edit it from the{" "}
          <strong>General</strong> tab. Changes sync automatically when you save.
        </p>

        <SubHeading>Skills</SubHeading>
        <p className="text-muted-foreground leading-relaxed">
          Skills extend your bot with additional capabilities beyond
          conversation. Available skills include:
        </p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground pl-1">
          <li><strong className="text-foreground">Web Search</strong> &mdash; Search the web and return summarized results.</li>
          <li><strong className="text-foreground">Weather</strong> &mdash; Look up current weather and forecasts by location.</li>
          <li><strong className="text-foreground">Calculator</strong> &mdash; Evaluate mathematical expressions.</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed">
          Enable or disable skills from the <strong>Skills</strong> tab. Each
          skill is rendered as a configuration file on the pod and loaded by the
          MCP server. Additional skills can be added through marketplace
          services.
        </p>

        <SubHeading>Canvas Components</SubHeading>
        <p className="text-muted-foreground leading-relaxed">
          Your bot can render 37 built-in UI component types in the web chat,
          including charts, data tables, forms, maps, and code editors.
          Additionally, you can install marketplace components or define custom
          components that persist across conversations. The{" "}
          <strong>Components</strong> tab shows installed components and provides
          access to the marketplace.
        </p>

        <SubHeading>Model Configuration</SubHeading>
        <p className="text-muted-foreground leading-relaxed">
          The <strong>Model</strong> tab lets you change the LLM provider, API
          key, or model selection without redeploying. Changes trigger a config
          sync and automatic pod restart.
        </p>

        <SubHeading>Logs</SubHeading>
        <p className="text-muted-foreground leading-relaxed">
          The <strong>Logs</strong> tab streams pod logs in real time. Use this
          to debug startup failures, LLM errors, or messaging platform issues.
          Logs are streamed via SSE and update as new entries appear.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────────── */}
      {/*  6. Credit System                                              */}
      {/* ────────────────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <SectionHeading id="credit-system" icon={CreditCard}>
          Credit System
        </SectionHeading>

        <SubHeading>Free Trial</SubHeading>
        <p className="text-muted-foreground leading-relaxed">
          New accounts receive a free trial with enough credits to create a
          deployment and test basic functionality. No credit card is required to
          start.
        </p>

        <SubHeading>Billing</SubHeading>
        <p className="text-muted-foreground leading-relaxed">
          Jarble uses Stripe for billing. When using Included Credits, you
          select a monthly spending cap. Available tiers:
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted text-foreground">
                <th className="px-4 py-2.5 text-left font-medium">Plan</th>
                <th className="px-4 py-2.5 text-left font-medium">Best For</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-4 py-2 font-medium">$5/mo</td>
                <td className="px-4 py-2 text-muted-foreground">Light usage &mdash; testing and small bots</td>
              </tr>
              <tr>
                <td className="px-4 py-2 font-medium">$10/mo</td>
                <td className="px-4 py-2 text-muted-foreground">Moderate usage &mdash; a few hundred messages per month</td>
              </tr>
              <tr>
                <td className="px-4 py-2 font-medium">$25/mo</td>
                <td className="px-4 py-2 text-muted-foreground">Active usage &mdash; busy bots with frequent conversations</td>
              </tr>
              <tr>
                <td className="px-4 py-2 font-medium">$50/mo</td>
                <td className="px-4 py-2 text-muted-foreground">Heavy usage &mdash; high-volume bots and power users</td>
              </tr>
              <tr>
                <td className="px-4 py-2 font-medium">$100/mo</td>
                <td className="px-4 py-2 text-muted-foreground">Enterprise &mdash; maximum capacity for production workloads</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          The spending cap controls how much LLM usage your bot can consume per
          month. You are only charged for actual usage up to the cap.
        </p>
        <Tip>
          If you bring your own API key, Jarble does not bill for LLM usage
          &mdash; you pay your provider directly. Only the infrastructure
          (compute, storage) is billed through Jarble.
        </Tip>

        <SubHeading>Linked Deployments</SubHeading>
        <p className="text-muted-foreground leading-relaxed">
          Deployments can be linked into <strong>credit pools</strong>. Linked
          deployments share a single credit balance, which is useful when you
          have multiple bots serving different channels but want unified billing.
          The dashboard graph view visualizes credit pool relationships &mdash;
          nodes represent deployments and edges show pool linkages.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────────── */}
      {/*  7. Dashboard                                                  */}
      {/* ────────────────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <SectionHeading id="dashboard" icon={LayoutDashboard}>
          Dashboard
        </SectionHeading>
        <p className="text-muted-foreground leading-relaxed">
          The dashboard is your central control panel for all deployments.
        </p>

        <SubHeading>Deployment List</SubHeading>
        <p className="text-muted-foreground leading-relaxed">
          Each deployment shows its name, runtime, current status (with a
          color-coded badge), and the connected messaging platforms. Click any
          deployment to open its web chat or configuration panel.
        </p>

        <SubHeading>Graph View</SubHeading>
        <p className="text-muted-foreground leading-relaxed">
          Toggle the graph view to see an interactive node diagram of your
          deployments. Nodes are arranged using the dagre layout algorithm.
          Circle icons indicate the deployment type (owner, linked, standalone).
          Edges show credit pool relationships. Use the filter bar to toggle
          edge visibility or filter by runtime.
        </p>

        <SubHeading>Real-Time Updates</SubHeading>
        <p className="text-muted-foreground leading-relaxed">
          The dashboard subscribes to SSE status streams. When a deployment
          changes state (starting, crashing, completing a restart), the status
          badge updates immediately without polling or manual refresh.
        </p>
      </section>

      {/* ── Navigation Footer ── */}
      <div className="flex flex-col gap-4 border-t border-border pt-8 sm:flex-row sm:justify-between">
        <Link
          href="/docs/getting-started"
          className="group flex flex-col gap-1 rounded-lg border border-border p-4 transition-colors hover:border-primary/40 hover:bg-muted/50 sm:max-w-xs"
        >
          <span className="text-xs text-muted-foreground">Previous</span>
          <span className="font-medium text-foreground group-hover:text-primary transition-colors">
            Getting Started
          </span>
        </Link>
        <Link
          href="/docs/components"
          className="group flex flex-col gap-1 rounded-lg border border-border p-4 text-right transition-colors hover:border-primary/40 hover:bg-muted/50 sm:max-w-xs"
        >
          <span className="text-xs text-muted-foreground">Next</span>
          <span className="font-medium text-foreground group-hover:text-primary transition-colors">
            Components
          </span>
        </Link>
      </div>
    </div>
  );
}
