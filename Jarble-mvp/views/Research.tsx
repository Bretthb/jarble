"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useAuth0 } from "@auth0/auth0-react";
import {
  ArrowRight,
  FlaskConical,
  Boxes,
  ShieldCheck,
  Gauge,
  Network,
  FileText,
} from "lucide-react";
import MarketingNav from "@/components/marketing/MarketingNav";
import MarketingFooter from "@/components/marketing/MarketingFooter";

const RESEARCH_AREAS = [
  {
    icon: Boxes,
    title: "Harness-agnostic orchestration",
    desc: "How a single infrastructure layer can deploy, scale, and route across many agent harnesses without coupling to any one of them.",
  },
  {
    icon: Network,
    title: "Multi-agent workflows",
    desc: "DAG-based pipelines with cycles, human-in-the-loop pauses, and nested subflows. What it takes to run agent teams reliably in production.",
  },
  {
    icon: ShieldCheck,
    title: "Isolation and security",
    desc: "Per-deployment pod isolation, forward-auth ingress, and encrypted credential handling for agents that touch real user data.",
  },
  {
    icon: Gauge,
    title: "Autoscaling economics",
    desc: "Right-sizing compute for bursty agent workloads, and the cost model that makes per-deployment scaling sustainable.",
  },
];

const NOTES = [
  {
    tag: "Infrastructure",
    title: "Why the moat is the infrastructure layer, not the agent",
    desc: "A look at how isolation, config sync, LLM routing, and autoscaling compound into a durable platform advantage.",
  },
  {
    tag: "Orchestration",
    title: "Running agent teams as durable DAGs",
    desc: "Lessons from building a flow engine that survives pod restarts and supports feedback loops between agents.",
  },
  {
    tag: "Reliability",
    title: "Config sync under concurrency",
    desc: "Using advisory locks and durable lifecycle jobs so concurrent deployment mutations serialize instead of racing.",
  },
];

export default function Research() {
  const { isAuthenticated } = useAuth0();
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background text-foreground relative">
      <MarketingNav />

      {/* Hero */}
      <section className="pt-32 pb-20 relative overflow-hidden z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center animate-fade-in-up">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary/80 backdrop-blur-sm text-xs font-medium text-muted-foreground border border-border/50 mb-8">
            <FlaskConical className="w-4 h-4 text-primary" />
            Jarble Research
          </div>
          <h1 className="text-5xl lg:text-6xl font-serif font-medium leading-tight mb-6">
            Building the infrastructure<br />
            <span className="text-primary">the agent economy runs on.</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            We share what we learn while making agents deployable, scalable, and
            safe to run in production. Open notes on orchestration, isolation, and
            the operational layer underneath the agent economy.
          </p>
        </div>
      </section>

      {/* Research areas */}
      <section className="py-20 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-serif font-medium mb-6">
              What we are researching
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              The hard problems live in the operational layer. These are the areas
              we are pushing on.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-8">
            {RESEARCH_AREAS.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="bg-card/80 backdrop-blur-md border border-border rounded-2xl p-8 shadow-sm hover:border-primary/30 transition-colors animate-fade-in-up-fast"
              >
                <div className="w-12 h-12 rounded-xl bg-secondary/80 flex items-center justify-center mb-6">
                  <Icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-serif font-medium mb-3">{title}</h3>
                <p className="text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Notes */}
      <section className="py-20 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center gap-2 text-primary font-medium mb-4">
            <FileText className="w-5 h-5" />
            Notes and write-ups
          </div>
          <h2 className="text-4xl font-serif font-medium mb-12 text-center">
            Recent reading
          </h2>

          <div className="grid md:grid-cols-3 gap-8">
            {NOTES.map(({ tag, title, desc }) => (
              <div
                key={title}
                className="bg-card/80 backdrop-blur-md border border-border rounded-2xl p-6 hover:border-primary/30 transition-colors animate-fade-in-up-fast"
              >
                <span className="inline-block text-xs font-medium uppercase tracking-wide text-primary mb-4">
                  {tag}
                </span>
                <h3 className="font-semibold text-lg mb-2">{title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          <p className="text-center text-sm text-muted-foreground mt-12">
            More write-ups are on the way. Want to collaborate or share a finding?
            Reach out at hello@jarble.ai.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 relative z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-serif font-medium mb-6">
            Build on the same infrastructure
          </h2>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            Everything we research ships into the platform. Deploy your first agent
            and run on the operational layer we are building.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              size="lg"
              onClick={() => router.push(isAuthenticated ? "/dashboard" : "/login")}
              className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-6 font-medium"
            >
              Get Started Free
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => (window.location.href = "mailto:hello@jarble.ai")}
              className="rounded-full border-input bg-background/50 backdrop-blur-sm hover:bg-secondary/50"
            >
              Contact Us
            </Button>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
