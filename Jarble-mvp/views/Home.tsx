"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import Image from "next/image";
import { ArrowRight, Clock, DollarSign, Lock, MessageSquare, Cpu, Globe, Zap } from "lucide-react";
import { useState } from "react";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import InteractiveHero from "@/components/InteractiveHero";

const IntegrationsMarquee = dynamic(() => import("@/components/IntegrationsMarquee"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-64 flex items-center justify-center">
      <div className="flex gap-4 px-4 overflow-hidden opacity-30">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="w-20 h-20 rounded-xl bg-muted animate-pulse shrink-0" />
        ))}
      </div>
    </div>
  ),
});


export default function Home() {
  const { isAuthenticated, isLoading } = useAuth0();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");

  const handleStartOnboarding = () => {
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    router.push("/dashboard");
  };

  if (isLoading) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground relative">
      <MarketingNav />

      {/* Beta Banner */}
      <div className="fixed inset-x-0 top-[64px] z-40 bg-primary/10 border-b border-primary/20 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-center gap-3 text-sm">
          <span className="font-medium">Beta Testing opens March 29th</span>
          <Link
            href="/beta"
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
          >
            Apply Now
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* Hero Section */}
      <div className="relative pt-16">
        <section className="relative z-10 pt-40 pb-20 lg:pt-56 lg:pb-32 px-4 scroll-mt-20">
          <div className="max-w-6xl mx-auto relative lg:grid lg:grid-cols-[1fr_1fr] lg:gap-4 lg:items-center">
            {/* Mobile: static image */}
            <div className="absolute inset-0 flex items-start justify-end -top-6 -right-16 sm:hidden pointer-events-none animate-fade-in-scale">
              <div className="relative w-full max-w-sm aspect-square flex items-center justify-center">
                <Image
                  src="/hero-mobile.webp"
                  alt=""
                  className="relative w-full h-full object-contain opacity-30"
                  width={700}
                  height={700}
                  priority
                  sizes="(max-width: 640px) 100vw, 0vw"
                />
              </div>
            </div>

            {/* Text content */}
            <div className="relative z-10">
              <div className="max-w-xl space-y-8 animate-fade-in-up">
                <div className="space-y-4">
                  <span className="inline-flex items-center px-3 py-1 rounded-full bg-secondary/80 backdrop-blur-sm text-xs font-medium text-muted-foreground border border-border/50">
                    AI Agent Ecosystem
                  </span>
                  <h2 className="text-5xl lg:text-7xl font-serif font-medium leading-[1.1] tracking-tight">
                    Launch an AI agent
                    <span className="block text-primary">in minutes.</span>
                  </h2>
                  <p className="text-xl text-muted-foreground">
                    Pick a model. Tell it what to do. Your agent is live and ready to work, from our web chat or any messaging platform you already use.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex gap-3 items-start animate-fade-in-up-fast">
                    <Zap className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold">Go from idea to running agent in one sitting</h3>
                      <p className="text-sm text-muted-foreground">No servers to provision, no code to write. A guided wizard handles the setup so you can focus on what your agent actually does.</p>
                    </div>
                  </div>
                  <div className="flex gap-3 items-start animate-fade-in-up-fast">
                    <Globe className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold">Talk to your agent anywhere</h3>
                      <p className="text-sm text-muted-foreground">Use our web chat for a full-featured experience, or connect WhatsApp, Discord, Slack, and Telegram to reach your agent wherever you already are.</p>
                    </div>
                  </div>
                  <div className="flex gap-3 items-start animate-fade-in-up-fast">
                    <DollarSign className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold">Use any model. Pay the provider, not us.</h3>
                      <p className="text-sm text-muted-foreground">Bring your own API key from OpenAI, Anthropic, Google, or 200+ models through OpenRouter. We never mark up your AI costs.</p>
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <Button
                    data-tour="hero-cta"
                    size="lg"
                    onClick={handleStartOnboarding}
                    className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-6 font-medium"
                  >
                    Launch Your First Agent
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Desktop: scroll-scrubbed video with mouse tilt */}
            <div className="hidden sm:flex justify-center lg:justify-start lg:-ml-4 animate-fade-in-scale">
              <InteractiveHero />
            </div>
          </div>
        </section>
      </div>

      {/* Web Chat section */}
      <section className="py-24 relative z-10 border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="lg:grid lg:grid-cols-2 lg:gap-16 items-center">
            <div className="space-y-6 mb-12 lg:mb-0">
              <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/10 text-xs font-medium text-primary border border-primary/20">
                Web Chat
              </span>
              <h2 className="text-4xl font-serif font-medium leading-tight">
                Your agent, always<br />
                <span className="text-primary">one tab away.</span>
              </h2>
              <p className="text-lg text-muted-foreground">
                Every agent gets its own web chat at jarble.ai. No app to install, no platform to join. Open the link and start working with your agent immediately.
              </p>
              <div className="space-y-3">
                <div className="flex gap-3 items-start">
                  <MessageSquare className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-muted-foreground">Full conversation history that persists across sessions. Pick up where you left off.</p>
                </div>
                <div className="flex gap-3 items-start">
                  <Globe className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-muted-foreground">Works on any device with a browser. Access your agent from your phone, tablet, or desktop.</p>
                </div>
                <div className="flex gap-3 items-start">
                  <Zap className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-muted-foreground">Connect WhatsApp, Discord, or Slack later. Your web chat is always there as the home base.</p>
                </div>
              </div>
              <Button
                size="lg"
                variant="outline"
                onClick={handleStartOnboarding}
                className="rounded-full px-6 font-medium"
              >
                Try It Now
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
            {/* Mock chat window */}
            <div className="relative rounded-xl border border-border bg-card/50 p-6 shadow-lg">
              <div className="flex items-center gap-2 mb-4 pb-4 border-b border-border">
                <div className="w-3 h-3 rounded-full bg-red-400" />
                <div className="w-3 h-3 rounded-full bg-yellow-400" />
                <div className="w-3 h-3 rounded-full bg-green-400" />
                <span className="ml-2 text-xs text-muted-foreground font-mono">jarble.ai/d/my-agent</span>
              </div>
              <div className="space-y-4">
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">You</div>
                  <div className="bg-muted rounded-lg p-3 text-sm max-w-[80%]">Summarize the key points from yesterday&apos;s meeting notes and draft a follow-up email</div>
                </div>
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium text-primary">AI</div>
                  <div className="space-y-2 max-w-[80%]">
                    <div className="bg-muted rounded-lg p-3 text-sm">
                      <p className="font-medium mb-2">Key takeaways from yesterday:</p>
                      <ul className="text-muted-foreground space-y-1 text-xs list-disc pl-4">
                        <li>Q2 launch moved to April 15</li>
                        <li>Design review approved with minor changes</li>
                        <li>Budget increased by 12% for marketing</li>
                      </ul>
                      <p className="mt-3 font-medium mb-1">Draft follow-up:</p>
                      <p className="text-muted-foreground text-xs">Hi team, thanks for a productive session yesterday. Here are the action items we agreed on...</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Integrations Section */}
      <section data-tour="integrations" className="relative py-16 overflow-hidden scroll-mt-20 border-t border-border">
        <div className="relative z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-12">
            <h2 className="text-4xl font-serif font-medium text-center mb-4">
              Integrate with <span className="text-primary">Everything</span>
            </h2>
            <p className="text-center text-muted-foreground text-lg">
              Connect to 50+ platforms and services. Use any chat app, AI model, or tool you already love.
            </p>

            <div className="mt-8 max-w-md mx-auto">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search integrations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-background/50 border border-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>
          <IntegrationsMarquee searchQuery={searchQuery} />
        </div>
      </section>

      {/* Why Jarble */}
      <section className="py-24 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-serif font-medium mb-4">
              Built for people who <span className="text-primary">ship, not tinker</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              You have a task that needs an AI agent. You shouldn&apos;t need to become a DevOps engineer to make it happen.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="p-6 rounded-xl bg-card/80 backdrop-blur-md border border-border shadow-sm animate-fade-in-up-fast">
              <Cpu className="w-8 h-8 text-primary mb-4" />
              <h3 className="text-lg font-semibold mb-2">Any model, swappable anytime</h3>
              <p className="text-muted-foreground text-sm">
                Start with GPT-4o Mini to keep costs low. Switch to Claude for deeper reasoning. Change your model in the dashboard without redeploying.
              </p>
            </div>
            <div className="p-6 rounded-xl bg-card/80 backdrop-blur-md border border-border shadow-sm animate-fade-in-up-fast">
              <MessageSquare className="w-8 h-8 text-primary mb-4" />
              <h3 className="text-lg font-semibold mb-2">One agent, every platform</h3>
              <p className="text-muted-foreground text-sm">
                Deploy once. Connect WhatsApp, Discord, Slack, or Telegram whenever you need to. Same agent, same context, wherever you want to reach it.
              </p>
            </div>
            <div className="p-6 rounded-xl bg-card/80 backdrop-blur-md border border-border shadow-sm animate-fade-in-up-fast">
              <Lock className="w-8 h-8 text-primary mb-4" />
              <h3 className="text-lg font-semibold mb-2">Your rules, your data</h3>
              <p className="text-muted-foreground text-sm">
                Define what your agent can and can&apos;t do. Set guardrails, personality, and boundaries. Every deployment runs in its own isolated environment.
              </p>
            </div>
            <div className="p-6 rounded-xl bg-card/80 backdrop-blur-md border border-border shadow-sm animate-fade-in-up-fast">
              <DollarSign className="w-8 h-8 text-primary mb-4" />
              <h3 className="text-lg font-semibold mb-2">Transparent pricing</h3>
              <p className="text-muted-foreground text-sm">
                Hosting starts at $32/mo. AI model costs go straight to your provider with zero margin from us. No hidden fees, no usage surprises.
              </p>
            </div>
            <div className="p-6 rounded-xl bg-card/80 backdrop-blur-md border border-border shadow-sm animate-fade-in-up-fast">
              <Clock className="w-8 h-8 text-primary mb-4" />
              <h3 className="text-lg font-semibold mb-2">Minutes to deploy, seconds to update</h3>
              <p className="text-muted-foreground text-sm">
                Change your agent&apos;s instructions, swap its model, or connect a new platform from the dashboard. No redeploy needed.
              </p>
            </div>
            <div className="p-6 rounded-xl bg-card/80 backdrop-blur-md border border-border shadow-sm animate-fade-in-up-fast">
              <Zap className="w-8 h-8 text-primary mb-4" />
              <h3 className="text-lg font-semibold mb-2">No code, no infrastructure</h3>
              <p className="text-muted-foreground text-sm">
                We handle servers, storage, networking, and uptime. You tell your agent what to do. That&apos;s the whole setup.
              </p>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
