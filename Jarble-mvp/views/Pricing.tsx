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

/* ── Beta default tier ────────────────────────────────────────────────── */

const BETA_TIER = {
  price: 13.99,
  specs: { cpu: "3 shared vCPU", ram: "4 GB", storage: "80 GB" },
  server: "cpx21",
};

const FEATURES = [
  "Isolated pod with dedicated resources",
  "Web chat interface with full canvas",
  "30+ built-in components (charts, tables, code, 3D)",
  "Connect WhatsApp, Discord, Slack, Telegram",
  "MCP tool connections",
  "Skills & component marketplace",
  "Agent orchestration (flow engine)",
  "Subagent delegation",
  "Persistent storage across restarts",
  "Real-time SSE streaming",
  "Two-way config sync",
];

const ALWAYS_FREE = [
  "Sign up and explore the platform",
  "Create unlimited organizations",
  "Invite unlimited team members",
  "Browse the marketplace",
  "Access any LLM model via OpenRouter",
];

const FAQ = [
  {
    question: "Why is the price so low?",
    answer:
      "During beta, we charge exactly what the compute costs us, no margin. We want you building and deploying, not worrying about bills. This is the raw Hetzner server cost passed through directly.",
  },
  {
    question: "What does 'per agent' mean?",
    answer:
      "Each deployment (agent) is its own isolated pod with dedicated CPU, RAM, and storage. You pay per agent you have running. Stop an agent and you stop paying for it.",
  },
  {
    question: "Do I pay for team members or organizations?",
    answer:
      "No. Organizations and team members are always free. You only pay for the agents you deploy.",
  },
  {
    question: "How do I pay for LLM usage?",
    answer:
      "Bring your own API key from OpenAI, Anthropic, Google, or OpenRouter. You pay your provider directly, and we never mark up AI costs. If you don't want to manage your own key, optional managed credits are available.",
  },
  {
    question: "What happens when I stop an agent?",
    answer:
      "Stopped agents don't incur compute costs. Your data and config persist on storage. Restart anytime and pick up where you left off.",
  },
  {
    question: "What platforms can I connect?",
    answer:
      "WhatsApp, Discord, Slack, and Telegram. Each deployment also gets a built-in web chat interface at its unique URL.",
  },
  {
    question: "Do you have promo codes?",
    answer:
      "Yes. During beta we offer promo codes that can discount or fully waive the compute cost. Ask us for a code if you're an early tester.",
  },
  {
    question: "Will pricing change after beta?",
    answer:
      "After beta, we'll introduce multiple tiers with additional resource options. Beta users will be notified well in advance of any pricing changes.",
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
          <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/10 text-xs font-medium text-primary border border-primary/20">
            Beta Pricing: Cost Recovery Only
          </span>
          <h1 className="text-5xl lg:text-6xl font-serif font-medium tracking-tight">
            Pay for compute.
            <span className="block text-primary">Nothing else.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            During beta, you pay exactly what the server costs us: no markup, no
            seat fees, no AI charges. Organizations and team members are always
            free.
          </p>
        </div>
      </section>

      {/* ── Single tier card ────────────────────────────────────────── */}
      <section className="pb-24 px-4">
        <div className="max-w-lg mx-auto">
          <div className="relative rounded-2xl border border-primary bg-primary/[0.03] shadow-lg shadow-primary/5 p-8 animate-fade-in-up-fast">
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-medium">
              Beta
            </span>

            <div className="text-center mb-8">
              <div className="flex items-baseline justify-center gap-1 mb-2">
                <span className="text-5xl font-bold">
                  ${BETA_TIER.price.toFixed(2)}
                </span>
                <span className="text-muted-foreground text-lg">/mo per agent</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Raw compute cost. $0 Jarble margin.
              </p>
            </div>

            {/* Specs */}
            <div className="flex justify-center gap-6 mb-8 pb-8 border-b border-border">
              <div className="flex flex-col items-center gap-1">
                <Cpu className="w-5 h-5 text-primary" />
                <span className="text-sm font-semibold">{BETA_TIER.specs.cpu}</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <MemoryStick className="w-5 h-5 text-primary" />
                <span className="text-sm font-semibold">{BETA_TIER.specs.ram}</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <HardDrive className="w-5 h-5 text-primary" />
                <span className="text-sm font-semibold">{BETA_TIER.specs.storage}</span>
              </div>
            </div>

            {/* Features */}
            <ul className="space-y-3 mb-8">
              {FEATURES.map((feature) => (
                <li key={feature} className="flex gap-2 text-sm">
                  <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <Button
              onClick={handleCta}
              size="lg"
              className="w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
            >
              Deploy Your First Agent
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </section>

      {/* ── Always free ─────────────────────────────────────────────── */}
      <section className="py-20 px-4 border-t border-border">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-serif font-medium text-center mb-10">
            Always free
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {ALWAYS_FREE.map((item) => (
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
              Compute and AI are billed separately. You control both.
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
                  . You pay your provider directly.
                </span>
              </div>

              <ul className="space-y-2">
                {[
                  "Access to all models (GPT-4, Claude, Llama, Gemini)",
                  "Full control over model selection and costs",
                  "No markup on API costs. Ever.",
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
                      Optional
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    We handle the LLM key. Just deploy and go.
                  </p>
                </div>
              </div>

              <div className="mb-4">
                <span className="text-2xl font-bold">$5 – $100</span>
                <span className="text-sm text-muted-foreground ml-2">
                  /mo credit cap
                </span>
              </div>

              <ul className="space-y-2">
                {[
                  "No API key needed. We provision one for you.",
                  "Set a monthly spending cap ($5 – $100)",
                  "Same models, managed by Jarble via OpenRouter",
                ].map((item) => (
                  <li key={item} className="flex gap-2 text-sm">
                    <Check className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
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
              Need dedicated infrastructure?
            </h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
              Custom compute, dedicated CPU, SSO, audit logs, or SLAs.
              Let&apos;s talk.
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
