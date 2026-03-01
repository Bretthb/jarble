"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { motion } from "framer-motion";
import ProfileDropdown from "@/components/ProfileDropdown";
import {
  ChevronLeft,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Lightbulb,
  CreditCard,
  Server,
  MessageSquare,
  Brain,
  BarChart2,
  Puzzle,
  Code2,
  Cloud,
  Smartphone,
  Store,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

type Status = "shipped" | "in-progress" | "planned" | "exploring";

interface RoadmapItem {
  text: string;
  status: Status;
}

interface RoadmapSection {
  title: string;
  icon: React.ReactNode;
  items: RoadmapItem[];
}

interface RoadmapGroup {
  label: string;
  status: Status;
  sections: RoadmapSection[];
}

// ─── Data (mirrors roadmap/ROADMAP.md) ────────────────────────────────────

const ROADMAP: RoadmapGroup[] = [
  {
    label: "Shipped",
    status: "shipped",
    sections: [
      {
        title: "Payments & Billing",
        icon: <CreditCard className="w-4 h-4" />,
        items: [
          { text: "Stripe Elements checkout — embedded card form in the deployment wizard", status: "shipped" },
          { text: "Multi-payment method support — Google Pay, Apple Pay, CashApp, bank transfer", status: "shipped" },
          { text: "Payment verification — cryptographically verified before deployment triggers", status: "shipped" },
          { text: "Subscription enforcement — stops deployments when subscriptions lapse", status: "shipped" },
          { text: "Billing dashboard — invoice history, subscription overview, plan management", status: "shipped" },
        ],
      },
      {
        title: "Bot Deployment Infrastructure",
        icon: <Server className="w-4 h-4" />,
        items: [
          { text: "Kubernetes orchestration — isolated pod per bot with dedicated storage and networking", status: "shipped" },
          { text: "Pod security hardening — non-root containers, capability dropping, network policies", status: "shipped" },
          { text: "Real-time status streaming — live pod status via SSE, no polling", status: "shipped" },
          { text: "Real-time log streaming — live bot logs in the UI", status: "shipped" },
          { text: "Background status reconciler — detects and corrects stuck deployments", status: "shipped" },
          { text: "Storage enforcement — monitors disk usage, stops over-quota deployments", status: "shipped" },
        ],
      },
      {
        title: "Messaging Platform Integrations",
        icon: <MessageSquare className="w-4 h-4" />,
        items: [
          { text: "WhatsApp — QR code pairing flow in the onboarding wizard", status: "shipped" },
          { text: "Telegram — bot token validation + automated pairing approval", status: "shipped" },
          { text: "Discord — credential management and config sync", status: "shipped" },
          { text: "Slack — credential management and config sync", status: "shipped" },
        ],
      },
      {
        title: "LLM Provider Support",
        icon: <Brain className="w-4 h-4" />,
        items: [
          { text: "Multi-provider BYOK — Anthropic, OpenAI, Google, OpenRouter", status: "shipped" },
          { text: "Jarble Managed — included credits via OpenRouter provisioning", status: "shipped" },
          { text: "Claude Max OAuth tokens — special handling for sk-ant-oat* subscribers", status: "shipped" },
          { text: "Provider switching UX — seamless switching in the config UI", status: "shipped" },
        ],
      },
      {
        title: "Analytics & Monitoring",
        icon: <BarChart2 className="w-4 h-4" />,
        items: [
          { text: "Usage analytics dashboard — message volume, active deployments, platform breakdown", status: "shipped" },
          { text: "Prometheus + Grafana monitoring stack", status: "shipped" },
          { text: "Per-deployment metrics — CPU, memory, storage tracking", status: "shipped" },
        ],
      },
      {
        title: "Skills Marketplace",
        icon: <Puzzle className="w-4 h-4" />,
        items: [
          { text: "DB schema + tRPC router — foundation for installable bot skills", status: "shipped" },
          { text: "Skills tab in deployment config — toggle skills per deployment", status: "shipped" },
          { text: "Built-in skills — Web Search, Weather, Calculator", status: "shipped" },
        ],
      },
      {
        title: "Developer Experience",
        icon: <Code2 className="w-4 h-4" />,
        items: [
          { text: "Interactive deployments graph — React Flow node graph showing credit pool relationships", status: "shipped" },
          { text: "Mock K8s mode — full local dev without a real cluster", status: "shipped" },
          { text: "SQLite dev mode — no MySQL needed locally", status: "shipped" },
          { text: "Debug endpoints — DB dump, force status, config sync triggers", status: "shipped" },
        ],
      },
      {
        title: "Infrastructure",
        icon: <Cloud className="w-4 h-4" />,
        items: [
          { text: "Hetzner Cloud + Terraform IaC — production K3s cluster with Longhorn storage", status: "shipped" },
          { text: "TLS + cert-manager — automatic HTTPS certificate provisioning", status: "shipped" },
          { text: "Three-tier API rate limiting — global, per-user, and per-endpoint", status: "shipped" },
          { text: "CI/CD pipelines — GitHub Actions for API builds and Terraform deployments", status: "shipped" },
        ],
      },
    ],
  },
  {
    label: "In Progress",
    status: "in-progress",
    sections: [
      {
        title: "UI Component Library (Tambo Integration)",
        icon: <Puzzle className="w-4 h-4" />,
        items: [
          { text: "Tambo provider setup and component registry scaffold", status: "in-progress" },
          { text: "AI-native components — DeploymentCard, BotStatusPanel, PlatformConnectWidget, LogViewer", status: "in-progress" },
          { text: "Wrapping existing shadcn/ui components with Tambo-compatible schemas", status: "in-progress" },
        ],
      },
    ],
  },
  {
    label: "Planned",
    status: "planned",
    sections: [
      {
        title: "Payments & Billing",
        icon: <CreditCard className="w-4 h-4" />,
        items: [
          { text: "Usage-based billing — charge per message or per active hour", status: "planned" },
          { text: "Team plans — shared credit pools across an organization", status: "planned" },
          { text: "Spend alerts — notify users when approaching their credit limit", status: "planned" },
        ],
      },
      {
        title: "Bot Infrastructure",
        icon: <Server className="w-4 h-4" />,
        items: [
          { text: "Idle pod shutdown — scale to zero after 24h inactivity, cold-start on next message", status: "planned" },
          { text: "Pre-built container image — eliminate 2–3 min npm install on first boot", status: "planned" },
          { text: "Secrets as files — mount K8s secrets as volumes instead of env vars", status: "planned" },
          { text: "Secrets rotation — rotate LLM API keys without redeploying", status: "planned" },
          { text: "PVC backups — Longhorn snapshots for conversation history protection", status: "planned" },
          { text: "Resource limits per deployment — enforce CPU/memory/storage from DB", status: "planned" },
          { text: "Audit logging — K3s audit policies to track exec access per pod", status: "planned" },
        ],
      },
      {
        title: "Messaging Platforms",
        icon: <MessageSquare className="w-4 h-4" />,
        items: [
          { text: "Instagram DMs integration", status: "planned" },
          { text: "SMS / voice via Twilio", status: "planned" },
          { text: "Email bot (IMAP/SMTP)", status: "planned" },
        ],
      },
      {
        title: "Skills Marketplace",
        icon: <Puzzle className="w-4 h-4" />,
        items: [
          { text: "Third-party skill submissions — developer portal for custom skills", status: "planned" },
          { text: "Skill versioning — pin skills to specific versions", status: "planned" },
          { text: "Per-skill usage analytics", status: "planned" },
        ],
      },
      {
        title: "LLM Providers",
        icon: <Brain className="w-4 h-4" />,
        items: [
          { text: "LLM spend limits — per-user rate limiting on provider keys", status: "planned" },
          { text: "Automatic provider fallback — switch on rate limit or outage", status: "planned" },
          { text: "Fine-tuned model support — bring your own model endpoint", status: "planned" },
        ],
      },
      {
        title: "Developer & Enterprise",
        icon: <Code2 className="w-4 h-4" />,
        items: [
          { text: "REST API for external integrations — manage deployments programmatically", status: "planned" },
          { text: "Webhook events — notify external systems on deployment changes", status: "planned" },
          { text: "SSO / SAML — enterprise single sign-on", status: "planned" },
          { text: "Role-based access control — admin, member, viewer roles per organization", status: "planned" },
          { text: "Audit log UI — view all platform events per account", status: "planned" },
        ],
      },
    ],
  },
  {
    label: "Exploring",
    status: "exploring",
    sections: [
      {
        title: "AI-Native UI (Tambo)",
        icon: <Brain className="w-4 h-4" />,
        items: [
          { text: "Conversational onboarding — AI guides users through bot setup via chat", status: "exploring" },
          { text: "Natural language deployment management — \"restart my Telegram bot\" via chat", status: "exploring" },
          { text: "AI-generated system prompts — suggest soul.md content based on use case", status: "exploring" },
        ],
      },
      {
        title: "Mobile",
        icon: <Smartphone className="w-4 h-4" />,
        items: [
          { text: "Native iOS + Android app — manage deployments on the go", status: "exploring" },
          { text: "Push notifications — bot status alerts, billing events, pairing requests", status: "exploring" },
        ],
      },
      {
        title: "Marketplace",
        icon: <Store className="w-4 h-4" />,
        items: [
          { text: "Bot templates marketplace — pre-configured bots for common use cases", status: "exploring" },
          { text: "MCP server marketplace — one-click install of Model Context Protocol servers", status: "exploring" },
        ],
      },
    ],
  },
];

// ─── Status config ─────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<Status, {
  icon: React.ReactNode;
  badge: string;
  color: string;
  dot: string;
}> = {
  shipped: {
    icon: <CheckCircle2 className="w-4 h-4" />,
    badge: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    color: "text-emerald-500",
    dot: "bg-emerald-500",
  },
  "in-progress": {
    icon: <CircleDot className="w-4 h-4" />,
    badge: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    color: "text-blue-400",
    dot: "bg-blue-400",
  },
  planned: {
    icon: <CircleDashed className="w-4 h-4" />,
    badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    color: "text-amber-400",
    dot: "bg-amber-400",
  },
  exploring: {
    icon: <Lightbulb className="w-4 h-4" />,
    badge: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    color: "text-purple-400",
    dot: "bg-purple-400",
  },
};

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Status }) {
  const cfg = STATUS_CONFIG[status];
  const labels: Record<Status, string> = {
    shipped: "Shipped",
    "in-progress": "In Progress",
    planned: "Planned",
    exploring: "Exploring",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cfg.badge}`}>
      {cfg.icon}
      {labels[status]}
    </span>
  );
}

function RoadmapItemRow({ item }: { item: RoadmapItem }) {
  const cfg = STATUS_CONFIG[item.status];
  return (
    <li className="flex items-start gap-3 py-2">
      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      <span className="text-sm text-muted-foreground leading-relaxed">{item.text}</span>
    </li>
  );
}

function SectionCard({ section }: { section: RoadmapSection }) {
  return (
    <Card className="bg-card border-border/60 p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-muted-foreground">{section.icon}</span>
        <h3 className="text-sm font-semibold text-foreground">{section.title}</h3>
        <span className="ml-auto text-xs text-muted-foreground">{section.items.length} items</span>
      </div>
      <ul className="space-y-0.5">
        {section.items.map((item, i) => (
          <RoadmapItemRow key={i} item={item} />
        ))}
      </ul>
    </Card>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────

export default function Roadmap() {
  const router = useRouter();

  const totalShipped = ROADMAP.find(g => g.status === "shipped")?.sections
    .reduce((acc, s) => acc + s.items.length, 0) ?? 0;
  const totalInProgress = ROADMAP.find(g => g.status === "in-progress")?.sections
    .reduce((acc, s) => acc + s.items.length, 0) ?? 0;
  const totalPlanned = ROADMAP.find(g => g.status === "planned")?.sections
    .reduce((acc, s) => acc + s.items.length, 0) ?? 0;
  const totalExploring = ROADMAP.find(g => g.status === "exploring")?.sections
    .reduce((acc, s) => acc + s.items.length, 0) ?? 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="border-b border-border/60 sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/dashboard")}
              className="text-muted-foreground hover:text-foreground h-8 px-2"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Separator orientation="vertical" className="h-4" />
            <span className="text-sm font-semibold">Product Roadmap</span>
          </div>
          <ProfileDropdown />
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-12">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className="text-3xl font-bold tracking-tight mb-2">Product Roadmap</h1>
          <p className="text-muted-foreground max-w-xl">
            A live view of what we've built, what's in progress, and where we're headed.
            Updated continuously by the engineering team.
          </p>

          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
            {[
              { label: "Shipped", count: totalShipped, status: "shipped" as Status },
              { label: "In Progress", count: totalInProgress, status: "in-progress" as Status },
              { label: "Planned", count: totalPlanned, status: "planned" as Status },
              { label: "Exploring", count: totalExploring, status: "exploring" as Status },
            ].map(({ label, count, status }) => {
              const cfg = STATUS_CONFIG[status];
              return (
                <Card key={status} className="bg-card border-border/60 p-4 text-center">
                  <div className={`text-2xl font-bold ${cfg.color}`}>{count}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
                </Card>
              );
            })}
          </div>
        </motion.div>

        {/* Groups */}
        {ROADMAP.map((group, gi) => (
          <motion.section
            key={group.status}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: gi * 0.08 }}
          >
            <div className="flex items-center gap-3 mb-5">
              <StatusBadge status={group.status} />
              <Separator className="flex-1" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {group.sections.map((section, si) => (
                <SectionCard key={si} section={section} />
              ))}
            </div>
          </motion.section>
        ))}

        {/* Footer */}
        <p className="text-xs text-muted-foreground text-center pb-6">
          Last updated: February 21, 2026 · Maintained by the Jarble engineering team
        </p>
      </div>
    </div>
  );
}
