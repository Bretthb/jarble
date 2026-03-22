import Link from "next/link";
import type { Metadata } from "next";
import {
  Rocket,
  BookOpen,
  Layers,
  Store,
  Code,
  Shield,
  Cpu,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Learn how to deploy AI bots, build custom components, and integrate with messaging platforms using the Jarble platform.",
};

const SECTIONS = [
  {
    title: "Getting Started",
    href: "/docs/getting-started",
    icon: Rocket,
    description:
      "Set up your first AI bot in under five minutes. Covers account creation, runtime selection, and your first deployment.",
  },
  {
    title: "Platform Guide",
    href: "/docs/platform",
    icon: BookOpen,
    description:
      "Understand deployments, runtimes, LLM providers, messaging platform integration, and the configuration wizard.",
  },
  {
    title: "Components",
    href: "/docs/components",
    icon: Layers,
    description:
      "Explore the 37 built-in canvas components, the sandbox system, and how to build custom UI elements.",
  },
  {
    title: "Marketplace",
    href: "/docs/marketplace",
    icon: Store,
    description:
      "Browse and install community components and services, or publish your own packages for others to use.",
  },
  {
    title: "API Reference",
    href: "/docs/api",
    icon: Code,
    description:
      "Complete reference for the tRPC API, SSE streaming endpoints, MCP tools, and authentication flows.",
  },
  {
    title: "Security",
    href: "/docs/security",
    icon: Shield,
    description:
      "Sandbox isolation, Content Security Policy, AES-256 encryption, pod security, and the CDN allowlist.",
  },
  {
    title: "Architecture",
    href: "/docs/architecture",
    icon: Cpu,
    description:
      "System design overview covering Kubernetes orchestration, the config sync pipeline, and infrastructure.",
  },
] as const;

export default function DocsLandingPage() {
  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="space-y-4">
        <h1 className="font-serif text-4xl font-medium tracking-tight sm:text-5xl">
          Jarble Documentation
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl">
          Everything you need to deploy, configure, and extend AI bots on the
          Jarble platform. From quick-start guides to deep architecture
          references.
        </p>
      </section>

      {/* What is Jarble */}
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-medium tracking-tight">
          What is Jarble?
        </h2>
        <p className="text-muted-foreground leading-relaxed max-w-2xl">
          Jarble is a no-code AI bot deployment platform. Pick a runtime, choose
          an LLM provider, and deploy your bot to WhatsApp, Discord, Slack,
          Telegram, or a web chat interface -- all through a guided wizard. Each
          deployment gets a live chat page where your bot can render rich UI
          components like charts, tables, 3D visualizations, and interactive
          widgets inline in the conversation.
        </p>
      </section>

      {/* Section Grid */}
      <section className="space-y-6">
        <h2 className="font-serif text-2xl font-medium tracking-tight">
          Explore the Docs
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <Link key={section.href} href={section.href} className="group">
                <Card className="h-full border border-border transition-colors group-hover:border-primary/40 group-hover:bg-muted/50">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                      <CardTitle className="text-base">{section.title}</CardTitle>
                    </div>
                    <CardDescription className="mt-2">
                      {section.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
