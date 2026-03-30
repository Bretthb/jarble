import type { Metadata } from "next";
import Link from "next/link";
import {
  Rocket,
  UserPlus,
  Plus,
  Cpu,
  Key,
  MessageSquare,
  Link2,
  ArrowRight,
  Lightbulb,
  Info,
  ChevronRight,
} from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Getting Started",
  description:
    "Set up your first Jarble AI bot deployment in under five minutes.",
};

/* ------------------------------------------------------------------ */
/*  Inline helpers (server component — no hooks)                       */
/* ------------------------------------------------------------------ */

function StepHeading({
  id,
  step,
  icon: Icon,
  children,
}: {
  id: string;
  step: number;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      className="flex items-center gap-3 font-serif text-2xl font-medium tracking-tight scroll-mt-24"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold font-sans">
        {step}
      </span>
      <Icon className="h-5 w-5 text-muted-foreground" />
      {children}
    </h2>
  );
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

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-secondary px-1.5 py-0.5 rounded text-sm font-mono">
      {children}
    </code>
  );
}

/* ------------------------------------------------------------------ */
/*  Table of contents data                                             */
/* ------------------------------------------------------------------ */

const TOC = [
  { id: "create-account", label: "Create Your Account" },
  { id: "create-deployment", label: "Create a Deployment" },
  { id: "choose-runtime", label: "Choose a Runtime" },
  { id: "configure-llm", label: "Configure Your LLM" },
  { id: "deploy", label: "Deploy" },
  { id: "chat", label: "Chat with Your Bot" },
  { id: "messaging-platforms", label: "Connect Messaging Platforms" },
  { id: "next-steps", label: "Next Steps" },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function GettingStartedPage() {
  return (
    <div className="space-y-10">
      {/* ── Header ── */}
      <header className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Rocket className="h-5 w-5" />
          </div>
          <h1 className="font-serif text-3xl font-medium tracking-tight">
            Getting Started
          </h1>
        </div>
        <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl">
          Deploy your first AI bot in under five minutes. This guide walks you
          through account creation, runtime selection, LLM configuration, and
          your first deployment.
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

      {/* ── 1. Create Your Account ── */}
      <section className="space-y-4">
        <StepHeading id="create-account" step={1} icon={UserPlus}>
          Create Your Account
        </StepHeading>
        <p className="text-muted-foreground leading-relaxed">
          Sign up at <Code>jarble.ai/login</Code> using Google, GitHub, or
          email. Authentication is handled by Auth0 &mdash; your credentials are
          never stored on Jarble servers.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          After signing in you land on the <strong>Dashboard</strong>, which
          shows all of your deployments.
        </p>
      </section>

      {/* ── 2. Create a Deployment ── */}
      <section className="space-y-4">
        <StepHeading id="create-deployment" step={2} icon={Plus}>
          Create a Deployment
        </StepHeading>
        <p className="text-muted-foreground leading-relaxed">
          Click <strong>New Bot</strong> on the dashboard to open the onboarding
          wizard. The first step asks for a <strong>deployment name</strong>{" "}
          &mdash; a human-friendly label shown on the dashboard and in the web
          chat header.
        </p>
        <Tip>
          Names are display-only and can be changed later from the deployment
          configuration panel.
        </Tip>
      </section>

      {/* ── 3. Choose a Runtime ── */}
      <section className="space-y-4">
        <StepHeading id="choose-runtime" step={3} icon={Cpu}>
          Choose a Runtime
        </StepHeading>
        <p className="text-muted-foreground leading-relaxed">
          A runtime is the engine that powers your bot. Jarble currently offers
          two options:
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="border border-border">
            <CardContent className="space-y-2 py-4">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-lg">OpenClaw</h3>
                <Badge variant="secondary">Recommended</Badge>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Full-featured Node.js runtime with MCP tool support, rich UI
                rendering (charts, tables, 3D, maps), and multi-platform
                messaging. Best for production bots that need interactive
                components.
              </p>
            </CardContent>
          </Card>
          <Card className="border border-border">
            <CardContent className="space-y-2 py-4">
              <h3 className="font-medium text-lg">ZeroClaw</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Lightweight Python runtime for simple text-based chat. Lower
                resource usage, faster startup. Good for quick experiments or
                bots that only need basic conversational abilities.
              </p>
            </CardContent>
          </Card>
        </div>
        <InfoBox>
          Most users should start with <strong>OpenClaw</strong>. You can always
          create additional deployments with a different runtime later.
        </InfoBox>
      </section>

      {/* ── 4. Configure Your LLM ── */}
      <section className="space-y-4">
        <StepHeading id="configure-llm" step={4} icon={Key}>
          Configure Your LLM
        </StepHeading>
        <p className="text-muted-foreground leading-relaxed">
          Your bot needs an LLM (Large Language Model) to generate responses. You
          have two options: use <strong>Included Credits</strong> (powered by
          OpenRouter, billed through Jarble) or{" "}
          <strong>Bring Your Own Key</strong>.
        </p>

        <h3 className="font-medium text-lg">Included Credits</h3>
        <p className="text-muted-foreground leading-relaxed">
          Select a monthly spending cap ($5 &ndash; $100/mo). Jarble provisions
          an OpenRouter key automatically and routes requests through 200+ models.
          The default model is <Code>openrouter/auto</Code>, which picks the
          best model for each request.
        </p>

        <h3 className="font-medium text-lg">Bring Your Own Key (BYOK)</h3>
        <p className="text-muted-foreground leading-relaxed">
          Paste an API key from any supported provider. The wizard auto-detects
          the provider based on the key prefix:
        </p>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted text-foreground">
                <th className="px-4 py-2.5 text-left font-medium">Provider</th>
                <th className="px-4 py-2.5 text-left font-medium">Key Prefix</th>
                <th className="px-4 py-2.5 text-left font-medium">Models</th>
                <th className="px-4 py-2.5 text-left font-medium">Get a Key</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-4 py-2 text-muted-foreground">OpenRouter</td>
                <td className="px-4 py-2"><Code>sk-or-</Code></td>
                <td className="px-4 py-2 text-muted-foreground">200+ models</td>
                <td className="px-4 py-2">
                  <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">openrouter.ai/keys</a>
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2 text-muted-foreground">Anthropic</td>
                <td className="px-4 py-2"><Code>sk-ant-</Code></td>
                <td className="px-4 py-2 text-muted-foreground">Claude Opus 4, Sonnet 4, Haiku 3.5</td>
                <td className="px-4 py-2">
                  <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">console.anthropic.com</a>
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2 text-muted-foreground">OpenAI</td>
                <td className="px-4 py-2"><Code>sk-</Code></td>
                <td className="px-4 py-2 text-muted-foreground">GPT-4o, GPT-4o Mini, o1</td>
                <td className="px-4 py-2">
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">platform.openai.com</a>
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2 text-muted-foreground">Google AI</td>
                <td className="px-4 py-2"><Code>AIza</Code></td>
                <td className="px-4 py-2 text-muted-foreground">Gemini 2.0 Pro, Gemini 2.0 Flash</td>
                <td className="px-4 py-2">
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">aistudio.google.com</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <Tip>
          If you have a <strong>Claude Max</strong> subscription, your{" "}
          <Code>sk-ant-oat*</Code> token is automatically detected and uses
          Bearer authentication. No extra configuration needed.
        </Tip>
      </section>

      {/* ── 5. Deploy ── */}
      <section className="space-y-4">
        <StepHeading id="deploy" step={5} icon={Rocket}>
          Deploy
        </StepHeading>
        <p className="text-muted-foreground leading-relaxed">
          Review the hardware defaults (CPU, memory, storage) and click{" "}
          <strong>Deploy</strong>. Jarble provisions a Kubernetes pod with your
          chosen runtime and LLM configuration. The deployment status progresses
          through these stages:
        </p>
        <ol className="list-decimal list-inside space-y-2 text-muted-foreground pl-1">
          <li>
            <strong className="text-foreground">Creating</strong> &mdash; Pod is
            being provisioned and dependencies are installing.
          </li>
          <li>
            <strong className="text-foreground">Running</strong> &mdash; Bot is
            live and ready to receive messages.
          </li>
        </ol>
        <p className="text-muted-foreground leading-relaxed">
          First-time deployments typically take 30&ndash;90 seconds. Status
          updates stream in real time via SSE &mdash; no need to refresh the
          page.
        </p>
        <InfoBox>
          If the deployment stays in &ldquo;Creating&rdquo; for more than two
          minutes, check the <strong>Logs</strong> tab in the deployment
          configuration panel for errors.
        </InfoBox>
      </section>

      {/* ── 6. Chat with Your Bot ── */}
      <section className="space-y-4">
        <StepHeading id="chat" step={6} icon={MessageSquare}>
          Chat with Your Bot
        </StepHeading>
        <p className="text-muted-foreground leading-relaxed">
          Once the status shows <strong>Running</strong>, click on the deployment
          to open the web chat interface at <Code>/d/[id]</Code>. Type a message
          and your bot responds in real time.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          With the OpenClaw runtime, your bot can render{" "}
          <strong>rich UI components</strong> directly in the conversation:
        </p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground pl-1">
          <li>Charts (line, bar, area, pie, radar, scatter)</li>
          <li>Data tables with sorting and pagination</li>
          <li>Interactive forms and button groups</li>
          <li>Maps, code editors, and image galleries</li>
          <li>3D visualizations and custom sandboxed components</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed">
          These appear as interactive canvas blocks inline with the chat. You can
          drag to reorder, split multi-item components into individual cards, or
          merge compatible cards together.
        </p>
      </section>

      {/* ── 7. Connect Messaging Platforms ── */}
      <section className="space-y-4">
        <StepHeading id="messaging-platforms" step={7} icon={Link2}>
          Connect Messaging Platforms
        </StepHeading>
        <p className="text-muted-foreground leading-relaxed">
          Optionally connect your bot to one or more messaging platforms. Open
          the deployment configuration panel and navigate to the{" "}
          <strong>Platforms</strong> tab.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="border border-border">
            <CardContent className="space-y-1 py-3">
              <h3 className="font-medium text-lg">Telegram</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Create a bot via{" "}
                <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">@BotFather</a>,
                paste the bot token, then approve the pairing code sent by your bot.
              </p>
            </CardContent>
          </Card>
          <Card className="border border-border">
            <CardContent className="space-y-1 py-3">
              <h3 className="font-medium text-lg">Discord</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Create an application in the{" "}
                <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Developer Portal</a>,
                copy the bot token, and invite the bot to your server.
              </p>
            </CardContent>
          </Card>
          <Card className="border border-border">
            <CardContent className="space-y-1 py-3">
              <h3 className="font-medium text-lg">Slack</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Create a Slack app with Socket Mode enabled. You need both the{" "}
                <strong>Bot Token</strong> (<Code>xoxb-</Code>) and{" "}
                <strong>App Token</strong> (<Code>xapp-</Code>).
              </p>
            </CardContent>
          </Card>
          <Card className="border border-border">
            <CardContent className="space-y-1 py-3">
              <h3 className="font-medium text-lg">WhatsApp</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Scan a QR code from the Platforms tab to pair via WhatsApp Web.
                No developer account required.
              </p>
            </CardContent>
          </Card>
        </div>
        <Tip>
          Platform credentials are encrypted with AES-256-GCM before storage.
          Jarble never has access to your plaintext tokens at rest.
        </Tip>
      </section>

      {/* ── 8. Next Steps ── */}
      <section className="space-y-4">
        <StepHeading id="next-steps" step={8} icon={ArrowRight}>
          Next Steps
        </StepHeading>
        <p className="text-muted-foreground leading-relaxed">
          Your bot is live. Here is where to go from here:
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link
            href="/docs/platform"
            className="group flex flex-col gap-1.5 rounded-lg border border-border p-4 transition-colors hover:border-primary/40 hover:bg-muted/50"
          >
            <span className="font-medium text-foreground group-hover:text-primary transition-colors">
              Platform Guide
            </span>
            <span className="text-sm text-muted-foreground">
              Runtimes, providers, messaging platforms, and deployment lifecycle in depth.
            </span>
          </Link>
          <Link
            href="/docs/components"
            className="group flex flex-col gap-1.5 rounded-lg border border-border p-4 transition-colors hover:border-primary/40 hover:bg-muted/50"
          >
            <span className="font-medium text-foreground group-hover:text-primary transition-colors">
              Components
            </span>
            <span className="text-sm text-muted-foreground">
              All 37 canvas components your bot can render, with props and examples.
            </span>
          </Link>
          <Link
            href="/docs/marketplace"
            className="group flex flex-col gap-1.5 rounded-lg border border-border p-4 transition-colors hover:border-primary/40 hover:bg-muted/50"
          >
            <span className="font-medium text-foreground group-hover:text-primary transition-colors">
              Marketplace
            </span>
            <span className="text-sm text-muted-foreground">
              Browse, install, and publish custom components and service bundles.
            </span>
          </Link>
        </div>
      </section>
    </div>
  );
}
