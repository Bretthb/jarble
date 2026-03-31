"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowRight, Clock, DollarSign, Lock, MessageSquare, Cpu, Globe, Zap, Store } from "lucide-react";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import InteractiveHero from "@/components/InteractiveHero";


export default function Home() {
  const { isAuthenticated, isLoading } = useAuth0();
  const router = useRouter();

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
    <div className="min-h-screen bg-background text-foreground relative overflow-x-hidden">
      <MarketingNav />

      {/* Hero Section */}
      <div className="relative pt-16">
        <section className="relative z-10 pt-32 pb-20 lg:pt-44 lg:pb-32 px-4 scroll-mt-20">
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
                    Infrastructure for AI Agents
                  </span>
                  <h2 className="text-5xl lg:text-7xl font-serif font-medium leading-[1.1] tracking-tight">
                    Build. Deploy.
                    <span className="block text-primary">Earn.</span>
                  </h2>
                  <p className="text-xl text-muted-foreground">
                    The platform where builders create and monetize agents, and businesses deploy them into the tools their teams already use.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex gap-3 items-start animate-fade-in-up-fast">
                    <Zap className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold">Builders: create, publish, and earn</h3>
                      <p className="text-sm text-muted-foreground">Pick a runtime, write a system prompt, add MCP tools. Publish to the marketplace and earn on every deployment — no infrastructure to manage.</p>
                    </div>
                  </div>
                  <div className="flex gap-3 items-start animate-fade-in-up-fast">
                    <Globe className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold">Businesses: deploy in one click</h3>
                      <p className="text-sm text-muted-foreground">Browse the marketplace, deploy an agent, connect it to WhatsApp, Discord, Slack, or your web chat. Your team works exactly how they already do.</p>
                    </div>
                  </div>
                  <div className="flex gap-3 items-start animate-fade-in-up-fast">
                    <DollarSign className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold">Infrastructure that runs it all</h3>
                      <p className="text-sm text-muted-foreground">Every agent runs in its own isolated pod. Any model, any runtime. Bring your own API key or use managed credits — we never mark up AI costs.</p>
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
                    Start Building
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
                Rich responses, not<br />
                <span className="text-primary">just plain text.</span>
              </h2>
              <p className="text-lg text-muted-foreground">
                Every agent gets its own web chat with a full canvas — charts, tables, code blocks, live data widgets, and 3D visualizations rendered inline. Your agent doesn&apos;t just respond, it shows its work.
              </p>
              <div className="space-y-3">
                <div className="flex gap-3 items-start">
                  <MessageSquare className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-muted-foreground">Charts, tables, maps, code editors, and 3D visualizations — all rendered inline as the agent responds.</p>
                </div>
                <div className="flex gap-3 items-start">
                  <Globe className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-muted-foreground">Full conversation history across sessions. Persistent canvas — your agent remembers what it built.</p>
                </div>
                <div className="flex gap-3 items-start">
                  <Zap className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-muted-foreground">37 built-in UI components. Install more from the marketplace. Builders can define custom components.</p>
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
                  <div className="bg-muted rounded-lg p-3 text-sm max-w-[80%]">Show me Q1 sales performance with a breakdown by region</div>
                </div>
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium text-primary">AI</div>
                  <div className="space-y-2 max-w-[90%]">
                    <div className="bg-muted rounded-lg p-3 text-sm">
                      <p className="text-muted-foreground text-xs mb-3">Here&apos;s your Q1 breakdown — North America leading at +31%:</p>
                      <div className="bg-background rounded-lg p-3 border border-border/50">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium">Q1 Revenue by Region</span>
                          <span className="text-xs text-primary font-medium">↑ 24% overall</span>
                        </div>
                        <div className="flex items-end gap-1.5 h-16">
                          {[90, 65, 50, 75, 40, 55].map((h, i) => (
                            <div key={i} className="flex-1 bg-primary/70 rounded-t-sm" style={{ height: `${h}%` }} />
                          ))}
                        </div>
                        <div className="flex justify-between mt-1.5">
                          {["NA", "EU", "APAC", "LATAM", "ME", "AF"].map(label => (
                            <span key={label} className="text-[9px] text-muted-foreground flex-1 text-center">{label}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>


      {/* Marketplace Section */}
      <section className="py-24 relative z-10 border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/10 text-xs font-medium text-primary border border-primary/20 mb-6">
              Marketplace
            </span>
            <h2 className="text-4xl font-serif font-medium mb-4">
              The flywheel that powers<br />
              <span className="text-primary">the agent economy.</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              More builders means more agents. More agents means more businesses. The marketplace connects both sides and grows itself.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            <div className="p-8 rounded-2xl bg-card/80 backdrop-blur-md border border-border hover:border-primary/30 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                <Zap className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-3">For Builders</h3>
              <p className="text-muted-foreground text-sm mb-4">Create an agent, add MCP tools, set a price. Every time someone deploys your agent, you earn. Fork any existing agent to build faster.</p>
              <div className="space-y-2">
                {[
                  "Pick a runtime, write a system prompt",
                  "Add skills, tools, and components",
                  "Publish and earn on every deployment",
                  "Fork any public agent to customize",
                ].map(item => (
                  <div key={item} className="flex items-start gap-2 text-sm">
                    <span className="text-primary mt-0.5 flex-shrink-0">&#10003;</span>
                    <span className="text-muted-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-8 rounded-2xl bg-card/80 backdrop-blur-md border border-border hover:border-primary/30 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                <Store className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-3">For Businesses</h3>
              <p className="text-muted-foreground text-sm mb-4">Browse agents by workflow category. Deploy in one click with guided onboarding. Your agent runs inside the tools your team already uses.</p>
              <div className="space-y-2">
                {[
                  "Browse agents by workflow category",
                  "Deploy in one click with guided onboarding",
                  "Connect WhatsApp, Discord, Slack, or Telegram",
                  "Your team works the same way — agent adapts",
                ].map(item => (
                  <div key={item} className="flex items-start gap-2 text-sm">
                    <span className="text-primary mt-0.5 flex-shrink-0">&#10003;</span>
                    <span className="text-muted-foreground">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
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
              <Store className="w-8 h-8 text-primary mb-4" />
              <h3 className="text-lg font-semibold mb-2">Fork, customize, republish</h3>
              <p className="text-muted-foreground text-sm">
                Any marketplace agent can be forked, customized with your own prompt and tools, and republished. Build on what already works.
              </p>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
