"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Target,
  Lightbulb,
  Users,
  Rocket,
  Puzzle,
  Globe,
  TrendingUp,
  CheckCircle2,
  Zap,
  Store,
} from "lucide-react";
import { useAuth0 } from "@auth0/auth0-react";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";



export default function About() {
  const { isAuthenticated } = useAuth0();
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background text-foreground relative">
      <MarketingNav />

      {/* Hero Section */}
      <section className="pt-32 pb-20 relative overflow-hidden z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center animate-fade-in-up">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary/80 backdrop-blur-sm text-xs font-medium text-muted-foreground border border-border/50 mb-8">
            Infrastructure for AI Agents
          </div>
          <h1 className="text-5xl lg:text-6xl font-serif font-medium leading-tight mb-6">
            The infrastructure layer<br />
            <span className="text-primary">the agent economy runs on.</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Builders create and monetize agents. Businesses deploy and run them.
            The marketplace connects both sides. The infrastructure makes it all work.
          </p>
        </div>
      </section>

      {/* The Problem Section */}
      <section className="py-20 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="animate-fade-in-up">
              <div className="flex items-center gap-2 text-primary font-medium mb-4">
                <Target className="w-5 h-5" />
                The Problem
              </div>
              <h2 className="text-4xl font-serif font-medium mb-6">
                AI is Powerful, But Hard to Deploy
              </h2>
              <p className="text-lg text-muted-foreground mb-6">
                Businesses want to leverage AI, but face significant barriers:
              </p>
              <ul className="space-y-4">
                <li className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="text-muted-foreground text-sm">✕</span>
                  </div>
                  <div>
                    <span className="font-semibold">Technical complexity</span>
                    <p className="text-muted-foreground text-sm">Requires developers, infrastructure, and ongoing maintenance</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="text-muted-foreground text-sm">✕</span>
                  </div>
                  <div>
                    <span className="font-semibold">Platform fragmentation</span>
                    <p className="text-muted-foreground text-sm">Different APIs for Discord, Slack, WhatsApp, email, etc.</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="text-muted-foreground text-sm">✕</span>
                  </div>
                  <div>
                    <span className="font-semibold">Model lock-in</span>
                    <p className="text-muted-foreground text-sm">Tied to a single AI provider with no flexibility</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="text-muted-foreground text-sm">✕</span>
                  </div>
                  <div>
                    <span className="font-semibold">Scaling challenges</span>
                    <p className="text-muted-foreground text-sm">Managing growth, costs, and reliability is a full-time job</p>
                  </div>
                </li>
              </ul>
            </div>
            <div className="relative animate-fade-in-up-fast">
              <div className="relative bg-card/80 backdrop-blur-md border border-border rounded-2xl p-8 shadow-sm">
                <div className="text-6xl font-bold text-center mb-4">
                  <span className="text-destructive">73%</span>
                </div>
                <p className="text-center text-muted-foreground">
                  of businesses say deploying AI is their #1 challenge
                </p>
                <div className="mt-6 pt-6 border-t border-border">
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-bold text-primary">6-12mo</div>
                      <p className="text-sm text-muted-foreground">Avg. time to deploy</p>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-primary">$50K+</div>
                      <p className="text-sm text-muted-foreground">Typical dev cost</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The Solution Section */}
      <section className="py-20 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <div className="flex items-center justify-center gap-2 text-primary font-medium mb-4">
              <Lightbulb className="w-5 h-5" />
              The Solution
            </div>
            <h2 className="text-4xl font-serif font-medium mb-6">
              Jarble: AI Deployment Made Simple
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              We handle the complexity so you can focus on what matters: using AI to grow your business.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="bg-card/80 backdrop-blur-md border border-border rounded-2xl p-8 shadow-sm hover:border-primary/30 transition-colors animate-fade-in-up-fast">
              <div className="w-12 h-12 rounded-xl bg-secondary/80 flex items-center justify-center mb-6">
                <Rocket className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-serif font-medium mb-3">Guided Deployment</h3>
              <p className="text-muted-foreground">
                A white-glove onboarding experience that is still a product motion, not a consulting engagement. From idea to live agent in one sitting.
              </p>
            </div>
            <div className="bg-card/80 backdrop-blur-md border border-border rounded-2xl p-8 shadow-sm hover:border-primary/30 transition-colors animate-fade-in-up-fast">
              <div className="w-12 h-12 rounded-xl bg-secondary/80 flex items-center justify-center mb-6">
                <Puzzle className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-serif font-medium mb-3">Universal Integration</h3>
              <p className="text-muted-foreground">
                Deploy to WhatsApp, Discord, Slack, Telegram, and a full-featured web chat, all from a single dashboard. Your agent, everywhere your team already is.
              </p>
            </div>
            <div className="bg-card/80 backdrop-blur-md border border-border rounded-2xl p-8 shadow-sm hover:border-primary/30 transition-colors animate-fade-in-up-fast">
              <div className="w-12 h-12 rounded-xl bg-secondary/80 flex items-center justify-center mb-6">
                <Globe className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-serif font-medium mb-3">Model Agnostic</h3>
              <p className="text-muted-foreground">
                Use any AI provider (OpenAI, Anthropic, Google, Mistral) or let us handle it.
                Switch models anytime without code changes.
              </p>
            </div>
            <div className="bg-card/80 backdrop-blur-md border border-border rounded-2xl p-6 hover:border-primary/30 transition-colors">
              <Store className="w-8 h-8 text-primary mb-4" />
              <h3 className="font-semibold text-lg mb-2">A two-sided marketplace</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Builders publish agents and earn on every deployment. Businesses discover and deploy pre-built agents. Fork any agent to customize it.
              </p>
            </div>
            <div className="bg-card/80 backdrop-blur-md border border-border rounded-2xl p-6 hover:border-primary/30 transition-colors">
              <Zap className="w-8 h-8 text-primary mb-4" />
              <h3 className="font-semibold text-lg mb-2">MCP tools and skills</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Agents connect to external tools via MCP: web search, calculators, custom APIs. Install skills from the marketplace or build your own.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-serif font-medium mb-6">
              From Zero to Deployed in <span className="text-primary">Minutes</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-4 gap-8">
            {[
              { step: 1, title: "Choose Your Model", desc: "Select from top AI providers or use our managed service" },
              { step: 2, title: "Configure Behavior", desc: "Set personality, knowledge base, and guardrails" },
              { step: 3, title: "Connect Platforms", desc: "Pick where your agent lives: Discord, Slack, web, and more." },
              { step: 4, title: "Deploy & Scale", desc: "Go live instantly, scale automatically as you grow" },
            ].map((item) => (
              <div key={item.step} className="relative animate-fade-in-up-fast">
                <div className="text-6xl font-bold text-primary/20 absolute -top-4 -left-2">{item.step}</div>
                <div className="relative pt-8">
                  <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                  <p className="text-muted-foreground text-sm">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Market Opportunity (Investor-focused) */}
      <section className="py-20 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <div className="flex items-center justify-center gap-2 text-primary font-medium mb-4">
              <TrendingUp className="w-5 h-5" />
              Market Opportunity
            </div>
            <h2 className="text-4xl font-serif font-medium mb-6">
              The AI Platform Market is Exploding
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8 mb-12">
            <div className="bg-card/80 backdrop-blur-md border border-border rounded-2xl p-8 text-center shadow-sm animate-fade-in-up-fast">
              <div className="text-5xl font-bold text-primary mb-2">$150B</div>
              <p className="text-foreground">AI market by 2027</p>
              <p className="text-sm text-muted-foreground mt-2">Growing 37% CAGR</p>
            </div>
            <div className="bg-card/80 backdrop-blur-md border border-border rounded-2xl p-8 text-center shadow-sm animate-fade-in-up-fast">
              <div className="text-5xl font-bold text-primary mb-2">77%</div>
              <p className="text-foreground">Companies exploring AI</p>
              <p className="text-sm text-muted-foreground mt-2">Gartner 2024</p>
            </div>
            <div className="bg-card/80 backdrop-blur-md border border-border rounded-2xl p-8 text-center shadow-sm animate-fade-in-up-fast">
              <div className="text-5xl font-bold text-primary mb-2">5M+</div>
              <p className="text-foreground">Discord bots active</p>
              <p className="text-sm text-muted-foreground mt-2">And growing daily</p>
            </div>
          </div>

          <div className="bg-secondary/30 backdrop-blur-sm border border-border rounded-2xl p-8 animate-fade-in-up-fast">
            <h3 className="text-2xl font-serif font-medium mb-4 text-center">Why Jarble Wins</h3>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                "Infrastructure platform for the agent economy",
                "Model-agnostic, runtime-agnostic architecture",
                "Two-sided marketplace with builder economics",
                "Every agent runs in its own isolated pod",
              ].map((point) => (
                <div key={point} className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" />
                  <span className="text-foreground">{point}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Vision Section */}
      <section className="py-20 relative z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="flex items-center justify-center gap-2 text-primary font-medium mb-4">
            <Rocket className="w-5 h-5" />
            Our Vision
          </div>
          <h2 className="text-4xl font-serif font-medium mb-6">
            The infrastructure layer the agent economy runs on
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            As the AI agent ecosystem fragments across runtimes, models, tools, and platforms, Jarble becomes the connective tissue that makes it all work together.
            Builders focus on what their agents do. Businesses focus on the work the agents perform. The infrastructure runs invisibly underneath.
          </p>
          <p className="text-xl text-primary font-medium">
            Build. Deploy. Earn.
          </p>
        </div>
      </section>


      {/* CTA Section */}
      <section className="py-20 relative z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-serif font-medium mb-6">
            Ready to build?
          </h2>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            Deploy your first agent, publish to the marketplace, or reach out if you want a guided onboarding walkthrough.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              size="lg"
              onClick={() => router.push(isAuthenticated ? "/dashboard" : "/login")}
              className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-6 font-medium"
            >
              <Zap className="w-5 h-5 mr-2" />
              Get Started Free
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => window.location.href = "mailto:hello@jarble.ai"}
              className="rounded-full border-input bg-background/50 backdrop-blur-sm hover:bg-secondary/50"
            >
              Contact Us
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
