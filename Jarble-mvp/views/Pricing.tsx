"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Sparkles,
  Zap,
  HelpCircle,
  ArrowRight,
  Building2,
  MessageSquare,
  Bot,
  Cpu,
  HardDrive,
  MemoryStick,
  Key,
  Gift,
} from "lucide-react";
import { useAuth0 } from "@auth0/auth0-react";
import { useState } from "react";
import dynamic from "next/dynamic";
import { trpc } from "@/lib/trpc";

const WatercolorBlob = dynamic(() => import("@/components/WatercolorBlob"), {
  ssr: false,
});

const FAQ = [
  {
    question: "How does the free trial work?",
    answer: "Every new user gets one free deployment for 7 days — no credit card required. Pick any runtime and try it out. After 7 days, you can upgrade to a paid deployment to keep it running."
  },
  {
    question: "What is a deployment?",
    answer: "A deployment is a running AI instance on our infrastructure. Each deployment gets its own persistent storage, configuration, and platform connections. Think of it as your own dedicated AI agent."
  },
  {
    question: "How is pricing calculated?",
    answer: "Pricing is based on the runtime you choose. Each runtime has preset hardware specs (CPU, RAM, Storage) and a fixed monthly price. You only pay for what you deploy — no hidden fees."
  },
  {
    question: "Can I use my own API keys?",
    answer: "Yes! You can bring your own OpenRouter API key (BYOK) for full control over model selection and costs. Or use our included credits for a simpler experience."
  },
  {
    question: "What platforms can I connect?",
    answer: "Currently we support WhatsApp as the initial interface for OpenClaw. Discord, Slack, Telegram, and web chat integrations are coming soon."
  },
  {
    question: "Can I create multiple deployments?",
    answer: "Absolutely! There are no deployment limits. Create as many deployments as you need — each is billed separately based on its runtime."
  },
];

export default function Pricing() {
  const { isAuthenticated, loginWithRedirect } = useAuth0();
  const router = useRouter();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  // Fetch runtimes from API
  const runtimesQuery = trpc.runtimeCatalog.list.useQuery();

  const handleGetStarted = () => {
    if (isAuthenticated) {
      router.push("/onboarding/new");
    } else {
      loginWithRedirect();
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground relative">
      <WatercolorBlob />

      {/* Navigation */}
      <nav className="fixed inset-x-0 top-0 z-50 bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Sparkles className="w-6 h-6 text-primary" />
            <h1 className="font-serif font-bold text-2xl tracking-tight">Jarble</h1>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
              Home
            </Link>
            <Link href="/about" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
              About
            </Link>
            <Link href="/pricing" className="text-sm font-medium text-primary">
              Pricing
            </Link>
            {isAuthenticated ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/dashboard")}
                className="rounded-full border-input bg-background/50 backdrop-blur-sm hover:bg-secondary/50"
              >
                Dashboard
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => loginWithRedirect()}
                className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-6 font-medium"
              >
                Sign in
              </Button>
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-16 relative z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center animate-fade-in-up">
          <h1 className="text-5xl lg:text-6xl font-serif font-medium mb-6">
            Simple, Pay-As-You-Go
            <span className="block text-primary">Pricing</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-6">
            Pick a runtime, deploy instantly. Pay only for what you use.
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 border border-green-500/30 text-green-400">
            <Gift className="w-5 h-5" />
            <span className="text-sm font-medium">First deployment free for 7 days — no credit card required</span>
          </div>
        </div>
      </section>

      {/* Compute Pricing — Runtime Cards */}
      <section className="pb-20 relative z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="flex items-center justify-center gap-2 text-primary font-medium mb-4">
              <Cpu className="w-5 h-5" />
              Compute
            </div>
            <h2 className="text-3xl font-serif font-medium mb-2">Runtime Catalog</h2>
            <p className="text-muted-foreground">Each runtime comes with preset hardware — choose what fits your needs</p>
          </div>

          {runtimesQuery.isLoading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {(runtimesQuery.data ?? []).map((runtime: {
                id: number;
                slug: string;
                name: string;
                description: string | null;
                cpuLimit: string;
                memoryMb: number;
                storageMb: number;
                monthlyPriceCents: number;
              }) => (
                <div
                  key={runtime.id}
                  className="relative rounded-2xl p-6 border bg-card/80 backdrop-blur-md border-border hover:border-primary/50 transition-all animate-fade-in-up-fast"
                >
                  <div className="flex items-center gap-4 mb-4">
                    <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
                      runtime.slug === "openclaw"
                        ? "bg-gradient-to-br from-purple-500 to-blue-500"
                        : "bg-gradient-to-br from-emerald-500 to-teal-500"
                    }`}>
                      <Bot className="w-7 h-7 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-serif font-medium">{runtime.name}</h3>
                      <p className="text-sm text-muted-foreground">{runtime.description}</p>
                    </div>
                  </div>

                  {/* Hardware Specs */}
                  <div className="grid grid-cols-3 gap-3 mb-6">
                    <div className="flex flex-col items-center p-3 rounded-lg bg-secondary/50 border border-border">
                      <Cpu className="w-4 h-4 text-primary mb-1" />
                      <span className="text-sm font-semibold">{runtime.cpuLimit}</span>
                      <span className="text-xs text-muted-foreground">vCPU</span>
                    </div>
                    <div className="flex flex-col items-center p-3 rounded-lg bg-secondary/50 border border-border">
                      <MemoryStick className="w-4 h-4 text-primary mb-1" />
                      <span className="text-sm font-semibold">{runtime.memoryMb}</span>
                      <span className="text-xs text-muted-foreground">MB RAM</span>
                    </div>
                    <div className="flex flex-col items-center p-3 rounded-lg bg-secondary/50 border border-border">
                      <HardDrive className="w-4 h-4 text-primary mb-1" />
                      <span className="text-sm font-semibold">{runtime.storageMb}</span>
                      <span className="text-xs text-muted-foreground">MB Storage</span>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="text-center mb-6">
                    {runtime.monthlyPriceCents > 0 ? (
                      <div className="flex items-baseline justify-center gap-1">
                        <span className="text-3xl font-bold">${(runtime.monthlyPriceCents / 100).toFixed(0)}</span>
                        <span className="text-muted-foreground">/mo</span>
                      </div>
                    ) : (
                      <span className="text-2xl font-bold text-muted-foreground">Pricing TBD</span>
                    )}
                  </div>

                  <Button
                    onClick={handleGetStarted}
                    className="w-full rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                  >
                    Get Started
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* LLM Credits Pricing */}
      <section className="py-20 relative z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="flex items-center justify-center gap-2 text-primary font-medium mb-4">
              <Sparkles className="w-5 h-5" />
              LLM Credits
            </div>
            <h2 className="text-3xl font-serif font-medium mb-2">AI Model Access</h2>
            <p className="text-muted-foreground">Choose how your deployments access AI models</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* BYOK */}
            <div className="rounded-2xl p-6 border bg-card/80 backdrop-blur-md border-primary shadow-lg animate-fade-in-up-fast">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              </div>
              <div className="flex items-center gap-4 mb-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                  <Key className="w-7 h-7 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-serif font-medium">Bring Your Own Key</h3>
                    <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 text-xs font-medium">
                      Recommended
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">Full control with your own OpenRouter API key</p>
                </div>
              </div>

              <div className="text-center mb-6">
                <span className="text-3xl font-bold">Free</span>
                <p className="text-sm text-muted-foreground mt-1">You pay OpenRouter directly</p>
              </div>

              <ul className="space-y-3 mb-6">
                <li className="flex items-start gap-2 text-sm">
                  <span className="text-green-500 mt-0.5">&#10003;</span>
                  <span>Access to all models (GPT-4, Claude, Llama, etc.)</span>
                </li>
                <li className="flex items-start gap-2 text-sm">
                  <span className="text-green-500 mt-0.5">&#10003;</span>
                  <span>Full control over model selection and costs</span>
                </li>
                <li className="flex items-start gap-2 text-sm">
                  <span className="text-green-500 mt-0.5">&#10003;</span>
                  <span>Pay only for what you use</span>
                </li>
                <li className="flex items-start gap-2 text-sm">
                  <span className="text-green-500 mt-0.5">&#10003;</span>
                  <span>No markup on API costs</span>
                </li>
              </ul>

              <Button
                onClick={handleGetStarted}
                className="w-full rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
              >
                Get Started with BYOK
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>

            {/* Included Credits */}
            <div className="rounded-2xl p-6 border bg-card/80 backdrop-blur-md border-border animate-fade-in-up-fast">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                  <Sparkles className="w-7 h-7 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-serif font-medium">Included Credits</h3>
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-medium">
                      Coming Soon
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">We handle everything — just deploy and go</p>
                </div>
              </div>

              <div className="text-center mb-6">
                <span className="text-2xl font-bold text-muted-foreground">Pricing TBD</span>
                <p className="text-sm text-muted-foreground mt-1">Monthly credit packages</p>
              </div>

              <ul className="space-y-3 mb-6">
                <li className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="text-muted-foreground/50 mt-0.5">&#10003;</span>
                  <span>No API key needed</span>
                </li>
                <li className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="text-muted-foreground/50 mt-0.5">&#10003;</span>
                  <span>Pre-configured model selection</span>
                </li>
                <li className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="text-muted-foreground/50 mt-0.5">&#10003;</span>
                  <span>Simple monthly billing</span>
                </li>
                <li className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="text-muted-foreground/50 mt-0.5">&#10003;</span>
                  <span>Managed by Jarble via OpenRouter</span>
                </li>
              </ul>

              <Button
                disabled
                className="w-full rounded-full opacity-50"
              >
                Coming Soon
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Enterprise Section */}
      <section className="py-16 relative z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-card/80 backdrop-blur-md border border-border rounded-2xl p-8 md:p-12 text-center shadow-sm">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-2xl bg-secondary/80 flex items-center justify-center">
                <Building2 className="w-8 h-8 text-primary" />
              </div>
            </div>
            <h2 className="text-3xl font-serif font-medium mb-4">Need More?</h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
              For teams with custom requirements, dedicated infrastructure,
              or enterprise security needs.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                size="lg"
                variant="outline"
                onClick={() => window.location.href = "mailto:hello@jarble.ai"}
                className="rounded-full border-input bg-background/50 backdrop-blur-sm hover:bg-secondary/50"
              >
                <MessageSquare className="w-5 h-5 mr-2" />
                Contact Us
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 relative z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 animate-fade-in-up">
            <div className="flex items-center justify-center gap-2 text-primary font-medium mb-4">
              <HelpCircle className="w-5 h-5" />
              FAQ
            </div>
            <h2 className="text-3xl font-serif font-medium">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="space-y-4">
            {FAQ.map((item, i) => (
              <div
                key={i}
                className="bg-card/80 backdrop-blur-md border border-border rounded-xl overflow-hidden animate-fade-in-up-fast"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full px-6 py-4 text-left flex items-center justify-between hover:bg-secondary/30 transition-colors"
                >
                  <span className="font-medium">{item.question}</span>
                  <span className={`transform transition-transform ${openFaq === i ? "rotate-180" : ""}`}>
                    &#x25BC;
                  </span>
                </button>
                {openFaq === i && (
                  <div className="px-6 pb-4 text-muted-foreground">
                    {item.answer}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 relative z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-serif font-medium mb-6">
            Ready to Get Started?
          </h2>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            Deploy your first AI agent in minutes.
            First deployment free for 7 days, no credit card required.
          </p>
          <Button
            size="lg"
            onClick={handleGetStarted}
            className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-6 font-medium"
          >
            <Zap className="w-5 h-5 mr-2" />
            Start Building for Free
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-border relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Sparkles className="w-5 h-5 text-primary" />
              <span className="font-serif font-bold text-foreground">Jarble</span>
            </Link>
            <nav className="flex flex-wrap justify-center gap-x-8 gap-y-2">
              <Link href="/" className="text-muted-foreground hover:text-primary transition-colors">Home</Link>
              <Link href="/about" className="text-muted-foreground hover:text-primary transition-colors">About</Link>
              <Link href="/pricing" className="text-muted-foreground hover:text-primary transition-colors">Pricing</Link>
            </nav>
          </div>
          <div className="mt-8 pt-8 border-t border-border text-center text-muted-foreground text-sm">
            <p>&copy; 2026 Jarble. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
