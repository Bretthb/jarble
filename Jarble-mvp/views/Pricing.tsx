"use client";

import { useRouter } from "next/navigation";
import { useAuth0 } from "@auth0/auth0-react";
import {
  Check,
  ArrowRight,
  Cpu,
  HardDrive,
  MemoryStick,
  Key,
  Zap,
  HelpCircle,
  Building2,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

/* ── Tier definitions ─────────────────────────────────────────────────── */

interface Tier {
  name: string;
  price: number;
  description: string;
  specs: { cpu: string; ram: string; storage: string };
  features: string[];
  highlight?: boolean;
  dedicated?: boolean;
  cta: string;
}

const TIERS: Tier[] = [
  {
    name: "S",
    price: 14,
    description: "For testing and light workloads.",
    specs: { cpu: "2 shared vCPU", ram: "2 GB", storage: "40 GB" },
    features: [
      "Web chat interface with canvas",
      "30+ built-in components",
      "Connect WhatsApp, Discord, Slack, Telegram",
      "Bring your own LLM key or managed credits",
      "Community support",
    ],
    cta: "Get Started",
  },
  {
    name: "M",
    price: 28,
    description: "The recommended tier for production agents.",
    specs: { cpu: "3 shared vCPU", ram: "4 GB", storage: "80 GB" },
    features: [
      "Everything in S",
      "Handles concurrent traffic",
      "MCP tool connections",
      "Skills & component marketplace",
      "Agent orchestration (flow engine)",
      "Priority support",
    ],
    highlight: true,
    cta: "Start Building",
  },
  {
    name: "L",
    price: 50,
    description: "For high-throughput agents and heavier workloads.",
    specs: { cpu: "4 shared vCPU", ram: "8 GB", storage: "160 GB" },
    features: [
      "Everything in M",
      "2x the RAM for complex tasks",
      "Subagent delegation",
      "Publish to marketplace & earn",
      "Dedicated support",
    ],
    cta: "Scale Up",
  },
  {
    name: "XL",
    price: 80,
    description: "Dedicated CPU for maximum performance.",
    specs: { cpu: "4 dedicated vCPU", ram: "16 GB", storage: "160 GB" },
    dedicated: true,
    features: [
      "Everything in L",
      "Dedicated CPU (not shared)",
      "16 GB RAM for demanding workloads",
      "Guaranteed compute — no noisy neighbors",
      "Dedicated support + SLA",
    ],
    cta: "Go Dedicated",
  },
];

const INCLUDED_EVERYWHERE = [
  "Unlimited organizations (free)",
  "Unlimited team members",
  "Full canvas UI (30+ components)",
  "Any LLM model via OpenRouter",
  "Persistent storage across restarts",
  "Real-time SSE streaming",
  "Two-way config sync",
];

const FAQ = [
  {
    question: "What does 'per agent' mean?",
    answer:
      "Each deployment (agent) is its own isolated pod with dedicated CPU, RAM, and storage. You pay per agent you have running.",
  },
  {
    question: "Do I pay for team members or organizations?",
    answer:
      "No. Organizations and team members are always free. You only pay for the agents you deploy.",
  },
  {
    question: "Can I bring my own LLM API key?",
    answer:
      "Yes. Bring your own key from OpenAI, Anthropic, Google, or OpenRouter — we never mark up AI costs. Or use our managed credits if you prefer.",
  },
  {
    question: "What happens when I stop an agent?",
    answer:
      "Stopped agents don't incur compute costs. Your data and config persist on storage — restart anytime and pick up where you left off.",
  },
  {
    question: "Can I upgrade or downgrade?",
    answer:
      "Yes. Change your plan anytime. Upgrades take effect immediately, downgrades at the end of your billing period.",
  },
  {
    question: "What platforms can I connect?",
    answer:
      "WhatsApp, Discord, Slack, and Telegram. Each deployment also gets a built-in web chat interface at its unique URL.",
  },
  {
    question: "How do builders earn money?",
    answer:
      "Publish your agent to the marketplace and set a monthly price. When a business deploys it, you earn on every active subscription. Jarble takes a platform fee — you keep the rest.",
  },
  {
    question: "Do you offer custom plans?",
    answer:
      "Need more compute, higher concurrency, or dedicated infrastructure? Contact us and we'll put together a plan that fits.",
  },
];

/* ── Component ────────────────────────────────────────────────────────── */

export default function Pricing() {
  const { isAuthenticated, loginWithRedirect } = useAuth0();
  const router = useRouter();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const handleCta = () => {
    if (isAuthenticated) {
      router.push("/dashboard");
    } else {
      loginWithRedirect();
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground relative">
      <MarketingNav />

      {/* ── Header ──────────────────────────────────────────────────── */}
      <section className="pt-32 pb-16 px-4">
        <div className="max-w-4xl mx-auto text-center space-y-4 animate-fade-in-up">
          <h1 className="text-5xl lg:text-6xl font-serif font-medium tracking-tight">
            Simple, transparent
            <span className="block text-primary">infrastructure pricing.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Pay for the compute your agents use. No seat fees, no AI markup, no
            surprises. Organizations and team members are always free.
          </p>
        </div>
      </section>

      {/* ── Tier cards ──────────────────────────────────────────────── */}
      <section className="pb-24 px-4">
        <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-2xl border p-8 flex flex-col animate-fade-in-up-fast ${
                tier.highlight
                  ? "border-primary bg-primary/[0.03] shadow-lg shadow-primary/5"
                  : "border-border bg-card"
              }`}
            >
              {tier.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-medium">
                  Recommended
                </span>
              )}
              {tier.dedicated && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-foreground text-background text-xs font-medium">
                  Dedicated CPU
                </span>
              )}

              <div className="space-y-4 mb-8">
                <h3 className="text-xl font-semibold">{tier.name}</h3>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold">${tier.price}</span>
                  <span className="text-muted-foreground">/mo per agent</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {tier.description}
                </p>
              </div>

              {/* Specs */}
              <div className="flex gap-4 mb-6 pb-6 border-b border-border">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Cpu className="w-3.5 h-3.5" />
                  {tier.specs.cpu}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MemoryStick className="w-3.5 h-3.5" />
                  {tier.specs.ram}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <HardDrive className="w-3.5 h-3.5" />
                  {tier.specs.storage}
                </div>
              </div>

              {/* Features */}
              <ul className="space-y-3 mb-8 flex-1">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex gap-2 text-sm">
                    <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <Button
                onClick={handleCta}
                className={`w-full rounded-full font-medium ${
                  tier.highlight
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {tier.cta}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* ── Included everywhere ─────────────────────────────────────── */}
      <section className="py-20 px-4 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-serif font-medium text-center mb-10">
            Included with every plan
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {INCLUDED_EVERYWHERE.map((item) => (
              <div key={item} className="flex gap-3 items-center">
                <Check className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="text-sm text-muted-foreground">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── LLM Credits ─────────────────────────────────────────────── */}
      <section className="py-20 px-4 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-serif font-medium mb-2">
              AI Model Access
            </h2>
            <p className="text-muted-foreground">
              Choose how your agents access AI models
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* BYOK */}
            <div className="rounded-2xl p-6 border border-primary bg-primary/[0.03] shadow-lg shadow-primary/5 animate-fade-in-up-fast">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                  <Key className="w-6 h-6 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold">
                      Bring Your Own Key
                    </h3>
                    <span className="px-2 py-0.5 rounded-full bg-secondary text-muted-foreground text-xs font-medium">
                      Recommended
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Use your own OpenRouter, OpenAI, Anthropic, or Google key
                  </p>
                </div>
              </div>

              <div className="mb-4">
                <span className="text-2xl font-bold">Free</span>
                <span className="text-sm text-muted-foreground ml-2">
                  — you pay your provider directly
                </span>
              </div>

              <ul className="space-y-2">
                {[
                  "Access to all models (GPT-4, Claude, Llama, Gemini)",
                  "Full control over model selection and costs",
                  "No markup on API costs — ever",
                ].map((item) => (
                  <li key={item} className="flex gap-2 text-sm">
                    <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Managed Credits */}
            <div className="rounded-2xl p-6 border border-border bg-card animate-fade-in-up-fast">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                  <Zap className="w-6 h-6 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold">Managed Credits</h3>
                    <span className="px-2 py-0.5 rounded-full bg-secondary text-muted-foreground text-xs font-medium">
                      Coming Soon
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    We handle everything — just deploy and go
                  </p>
                </div>
              </div>

              <div className="mb-4">
                <span className="text-2xl font-bold text-muted-foreground">
                  TBD
                </span>
                <span className="text-sm text-muted-foreground ml-2">
                  — monthly credit packages
                </span>
              </div>

              <ul className="space-y-2">
                {[
                  "No API key needed",
                  "Pre-configured model selection",
                  "Simple monthly billing via Jarble",
                ].map((item) => (
                  <li
                    key={item}
                    className="flex gap-2 text-sm text-muted-foreground"
                  >
                    <Check className="w-4 h-4 text-muted-foreground/50 mt-0.5 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Enterprise CTA ──────────────────────────────────────────── */}
      <section className="py-16 px-4 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <div className="bg-card border border-border rounded-2xl p-8 md:p-12 text-center">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center">
                <Building2 className="w-8 h-8 text-primary" />
              </div>
            </div>
            <h2 className="text-3xl font-serif font-medium mb-4">
              Need More?
            </h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
              Custom compute, dedicated infrastructure, SSO, audit logs, or SLAs
              — let&apos;s talk.
            </p>
            <Button
              size="lg"
              variant="outline"
              onClick={() =>
                (window.location.href = "mailto:hello@jarble.ai")
              }
              className="rounded-full"
            >
              <MessageSquare className="w-5 h-5 mr-2" />
              Contact Us
            </Button>
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────── */}
      <section className="py-20 px-4 border-t border-border">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <div className="flex items-center justify-center gap-2 text-primary font-medium mb-4">
              <HelpCircle className="w-5 h-5" />
              FAQ
            </div>
            <h2 className="text-3xl font-serif font-medium">
              Common Questions
            </h2>
          </div>

          <div className="space-y-4">
            {FAQ.map((item, i) => (
              <div
                key={item.question}
                className="bg-card border border-border rounded-xl overflow-hidden"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full px-6 py-4 text-left flex items-center justify-between hover:bg-secondary/30 transition-colors"
                >
                  <span className="font-medium">{item.question}</span>
                  <span
                    className={`transform transition-transform text-muted-foreground ${
                      openFaq === i ? "rotate-180" : ""
                    }`}
                  >
                    &#x25BC;
                  </span>
                </button>
                {openFaq === i && (
                  <div className="px-6 pb-4 text-sm text-muted-foreground">
                    {item.answer}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────── */}
      <section className="py-20 px-4 border-t border-border">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <h2 className="text-3xl font-serif font-medium">
            Ready to deploy your first agent?
          </h2>
          <p className="text-muted-foreground">
            Get started in minutes. No credit card required to explore.
          </p>
          <Button
            size="lg"
            onClick={handleCta}
            className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-8 font-medium"
          >
            Start Building
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
