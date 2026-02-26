"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Zap,
  HelpCircle,
  ArrowRight,
  Building2,
  MessageSquare,
  Key,
} from "lucide-react";
import { useAuth0 } from "@auth0/auth0-react";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

import { trpc } from "@/lib/trpc";

const FAQ = [
  {
    question: "What is a deployment?",
    answer: "A deployment is a running AI instance on our infrastructure. Each deployment gets its own persistent storage, configuration, and platform connections. Think of it as your own dedicated AI agent."
  },
  {
    question: "How is pricing calculated?",
    answer: "Pricing is based on the runtime and hardware configuration you choose during deployment. You can customize specs to fit your needs and budget."
  },
  {
    question: "Can I use my own API keys?",
    answer: "Yes! Bring your own key (BYOK) from OpenRouter, OpenAI, Anthropic, or Google AI. You get full control over model selection and pay the provider directly - no markup from us."
  },
  {
    question: "What platforms can I connect?",
    answer: "We support WhatsApp, Discord, Telegram, Slack, Web Chat, Microsoft Teams, and Messenger. Connect multiple platforms to a single deployment - each one is configured independently."
  },
  {
    question: "Can I create multiple deployments?",
    answer: "Absolutely! There are no deployment limits. Create as many deployments as you need - each is billed separately based on its configuration."
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
      {/* Navigation */}
      <nav className="fixed inset-x-0 top-0 z-50 bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
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
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary/50 border border-border text-foreground">
            <Zap className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium">Deploy in minutes - no infrastructure to manage</span>
          </div>
        </div>
      </section>

      {/* Runtime Cards */}
      <section className="pb-20 relative z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-serif font-medium mb-2">Runtime Catalog</h2>
            <p className="text-muted-foreground">Choose the runtime that fits your needs</p>
          </div>

          {runtimesQuery.isLoading ? (
            <div className="grid md:grid-cols-2 gap-6">
              {[1, 2].map((i) => (
                <div key={i} className="rounded-2xl p-6 border bg-card/80 backdrop-blur-md border-border">
                  <div className="flex items-center gap-4 mb-6">
                    <Skeleton className="w-14 h-14 rounded-xl" />
                    <div className="flex-1">
                      <Skeleton className="h-6 w-32 mb-2" />
                      <Skeleton className="h-4 w-48" />
                    </div>
                  </div>
                  <Skeleton className="h-10 w-32 mx-auto mb-2" />
                  <Skeleton className="h-4 w-24 mx-auto mb-6" />
                  <Skeleton className="h-10 w-full rounded-full" />
                </div>
              ))}
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
              }) => {
                const isComingSoon = runtime.slug === "zeroclaw";

                return (
                  <div
                    key={runtime.id}
                    className={`relative rounded-2xl p-6 border bg-card/80 backdrop-blur-md transition-all animate-fade-in-up-fast ${
                      isComingSoon
                        ? "border-border opacity-60"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    {isComingSoon && (
                      <div className="absolute top-4 right-4">
                        <span className="px-2.5 py-1 rounded-full bg-secondary text-muted-foreground text-xs font-medium">
                          Coming Soon
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-4 mb-6">
                      <Image
                        src={runtime.slug === "openclaw" ? "/openclaw-logo.svg" : "/zeroclaw.png"}
                        alt={`${runtime.name} logo`}
                        width={56}
                        height={56}
                        className={`w-14 h-14 rounded-xl ${isComingSoon ? "grayscale" : ""}`}
                      />
                      <div>
                        <h3 className="text-xl font-serif font-medium">{runtime.name}</h3>
                        <p className="text-sm text-muted-foreground">{runtime.description}</p>
                      </div>
                    </div>

                    {/* Price */}
                    <div className="text-center mb-2">
                      {isComingSoon ? (
                        <span className="text-2xl font-bold text-muted-foreground">TBD</span>
                      ) : (
                        <div className="flex items-baseline justify-center gap-1">
                          <span className="text-sm text-muted-foreground">starting at</span>
                          <span className="text-3xl font-bold">$32.40</span>
                          <span className="text-muted-foreground">/mo</span>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-center text-muted-foreground mb-6">
                      {isComingSoon ? "Pricing announced at launch" : "Configurable during deployment"}
                    </p>

                    <Button
                      onClick={isComingSoon ? undefined : handleGetStarted}
                      disabled={isComingSoon}
                      className={`w-full rounded-full font-medium ${
                        isComingSoon
                          ? "opacity-50"
                          : "bg-primary hover:bg-primary/90 text-primary-foreground"
                      }`}
                    >
                      {isComingSoon ? "Coming Soon" : "Get Started"}
                      {!isComingSoon && <ArrowRight className="w-4 h-4 ml-2" />}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* LLM / AI Model Access */}
      <section className="py-20 relative z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-serif font-medium mb-2">AI Model Access</h2>
            <p className="text-muted-foreground">Bring your own API key - you pay the provider directly</p>
          </div>

          <div className="rounded-2xl p-6 border bg-card/80 backdrop-blur-md border-primary shadow-lg animate-fade-in-up-fast">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                <Key className="w-7 h-7 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-serif font-medium">Bring Your Own Key</h3>
                <p className="text-sm text-muted-foreground">Full control with your own API key - no markup</p>
              </div>
            </div>

            <div className="text-center mb-6">
              <span className="text-3xl font-bold">Free</span>
              <p className="text-sm text-muted-foreground mt-1">You pay the provider directly</p>
            </div>

            <ul className="space-y-3 mb-4">
              <li className="flex items-start gap-2 text-sm">
                <span className="text-primary mt-0.5">&#10003;</span>
                <span>Access to all models (GPT-4o, Claude, Gemini, Llama, etc.)</span>
              </li>
              <li className="flex items-start gap-2 text-sm">
                <span className="text-primary mt-0.5">&#10003;</span>
                <span>Full control over model selection and costs</span>
              </li>
              <li className="flex items-start gap-2 text-sm">
                <span className="text-primary mt-0.5">&#10003;</span>
                <span>Pay only for what you use - no markup</span>
              </li>
            </ul>

            {/* Supported Providers */}
            <div className="rounded-lg bg-secondary/30 border border-border p-3 mb-6">
              <p className="text-xs font-medium text-muted-foreground mb-2">Supported providers</p>
              <div className="flex flex-wrap gap-2">
                <span className="px-2 py-0.5 rounded-full bg-secondary text-xs font-medium">OpenRouter</span>
                <span className="px-2 py-0.5 rounded-full bg-secondary text-xs font-medium">OpenAI</span>
                <span className="px-2 py-0.5 rounded-full bg-secondary text-xs font-medium">Anthropic</span>
                <span className="px-2 py-0.5 rounded-full bg-secondary text-xs font-medium">Google AI</span>
              </div>
            </div>

            <Button
              onClick={handleGetStarted}
              className="w-full rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
            >
              Get Started
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
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
            Deploy your first AI agent in minutes. Starting at $32.40/mo.
          </p>
          <Button
            size="lg"
            onClick={handleGetStarted}
            className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-6 font-medium"
          >
            <Zap className="w-5 h-5 mr-2" />
            Start Building
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-border relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
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
