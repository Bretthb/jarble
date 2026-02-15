"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Sparkles,
  Check,
  X,
  Zap,
  HelpCircle,
  ArrowRight,
  Building2,
  MessageSquare
} from "lucide-react";
import { useAuth0 } from "@auth0/auth0-react";
import { useState } from "react";
import dynamic from "next/dynamic";
import { SubscribeButton } from "@/components/SubscribeButton";

const WatercolorBlob = dynamic(() => import("@/components/WatercolorBlob"), {
  ssr: false,
});

// Actual tiers — pricing is TBD, these are templates
const TIERS = [
  {
    id: 1,
    name: "free",
    displayName: "Free",
    description: "Get started with your first AI deployment",
    price: 0,
    popular: false,
    maxDeployments: 1,
    features: [
      { name: "1 AI deployment", included: true },
      { name: "OpenClaw runtime", included: true },
      { name: "Community support", included: true },
      { name: "Basic configuration", included: true },
      { name: "Persistent storage", included: true },
      { name: "Multiple platform connections", included: false },
      { name: "Priority support", included: false },
      { name: "Custom runtimes", included: false },
    ]
  },
  {
    id: 2,
    name: "pro",
    displayName: "Pro",
    description: "For builders ready to go live",
    price: null, // TBD
    popular: true,
    maxDeployments: 1,
    features: [
      { name: "1 AI deployment", included: true },
      { name: "All runtimes", included: true },
      { name: "Email support", included: true },
      { name: "Full configuration", included: true },
      { name: "Persistent storage", included: true },
      { name: "Multiple platform connections", included: true },
      { name: "Priority support", included: false },
      { name: "Custom runtimes", included: false },
    ]
  },
  {
    id: 3,
    name: "agency",
    displayName: "Agency",
    description: "For teams managing multiple deployments",
    price: null, // TBD
    popular: false,
    maxDeployments: 2,
    features: [
      { name: "2 AI deployments", included: true },
      { name: "All runtimes", included: true },
      { name: "Priority support", included: true },
      { name: "Full configuration", included: true },
      { name: "Persistent storage", included: true },
      { name: "Multiple platform connections", included: true },
      { name: "Priority support", included: true },
      { name: "Custom runtimes", included: true },
    ]
  },
];

const FAQ = [
  {
    question: "Can I change plans later?",
    answer: "Yes! You can upgrade or downgrade your plan at any time. When upgrading, you'll get immediate access to new features. When downgrading, changes take effect at the end of your billing cycle."
  },
  {
    question: "What is a deployment?",
    answer: "A deployment is a running AI instance on our infrastructure. Each deployment gets its own persistent storage, configuration, and platform connections. Think of it as your own dedicated AI agent."
  },
  {
    question: "Can I use my own API keys?",
    answer: "Yes! You can bring your own OpenRouter, OpenAI, Anthropic, or Google API keys. This gives you full control over model selection and costs."
  },
  {
    question: "What platforms can I connect?",
    answer: "Currently we support WhatsApp as the initial interface for OpenClaw. Discord, Slack, Telegram, and web chat integrations are coming soon."
  },
  {
    question: "What happens to my data if I downgrade?",
    answer: "Your deployment data is stored on persistent block storage and is never deleted automatically. If you exceed your plan's deployment limit, you'll need to remove deployments before creating new ones."
  },
  {
    question: "Is there a free trial for paid plans?",
    answer: "The Free tier is free forever with no credit card required. It's a great way to explore Jarble. Upgrade when you need more deployments or features."
  },
];

export default function Pricing() {
  const { isAuthenticated, loginWithRedirect } = useAuth0();
  const router = useRouter();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const handleGetStarted = (tierName: string) => {
    if (tierName === "free") {
      if (isAuthenticated) {
        router.push("/dashboard");
      } else {
        loginWithRedirect();
      }
    }
    // Pro and Agency handled by SubscribeButton
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
            Simple, Transparent
            <span className="block text-primary">Pricing</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Start free, scale as you grow. No hidden fees, no surprises.
          </p>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="pb-20 relative z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-3 gap-6">
            {TIERS.map((tier) => (
              <div
                key={tier.id}
                className={`relative rounded-2xl p-6 border animate-fade-in-up-fast ${
                  tier.popular
                    ? "bg-card/80 backdrop-blur-md border-primary shadow-lg"
                    : "bg-card/80 backdrop-blur-md border-border"
                }`}
              >
                {tier.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full">
                      Most Popular
                    </span>
                  </div>
                )}

                <div className="text-center mb-6">
                  <h3 className="text-xl font-serif font-medium mb-1">{tier.displayName}</h3>
                  <p className="text-sm text-muted-foreground">{tier.description}</p>
                </div>

                <div className="text-center mb-6">
                  <div className="flex items-baseline justify-center gap-1">
                    {tier.price === 0 ? (
                      <span className="text-4xl font-bold">Free</span>
                    ) : tier.price === null ? (
                      <span className="text-3xl font-bold text-muted-foreground">Coming Soon</span>
                    ) : (
                      <>
                        <span className="text-4xl font-bold">
                          ${(tier.price / 100).toFixed(0)}
                        </span>
                        <span className="text-muted-foreground">/mo</span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {tier.maxDeployments} deployment{tier.maxDeployments > 1 ? "s" : ""} included
                  </p>
                </div>

                {tier.name === "free" ? (
                  <Button
                    onClick={() => handleGetStarted("free")}
                    className="w-full mb-6 rounded-full border-input bg-background/50 backdrop-blur-sm hover:bg-secondary/50"
                  >
                    Get Started Free
                  </Button>
                ) : tier.price !== null ? (
                  <div className="mb-6">
                    <SubscribeButton
                      tier={tier.name as "pro" | "agency"}
                      className="w-full rounded-full"
                    />
                  </div>
                ) : (
                  <Button
                    disabled
                    className="w-full mb-6 rounded-full opacity-50"
                  >
                    Coming Soon
                  </Button>
                )}

                <ul className="space-y-3">
                  {tier.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2">
                      {feature.included ? (
                        <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      ) : (
                        <X className="w-5 h-5 text-muted-foreground/50 flex-shrink-0 mt-0.5" />
                      )}
                      <span className={feature.included ? "text-foreground" : "text-muted-foreground"}>
                        {feature.name}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
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

      {/* Feature Comparison Table */}
      <section className="py-20 relative z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-serif font-medium text-center mb-12">
            Compare Plans
          </h2>

          <div className="overflow-x-auto rounded-xl border border-border bg-card/80 backdrop-blur-md">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-4 px-4 font-medium text-muted-foreground">Feature</th>
                  {TIERS.map((tier) => (
                    <th key={tier.id} className="text-center py-4 px-4 font-bold">
                      {tier.displayName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border">
                  <td className="py-4 px-4 text-foreground">Deployments</td>
                  {TIERS.map((tier) => (
                    <td key={tier.id} className="text-center py-4 px-4">{tier.maxDeployments}</td>
                  ))}
                </tr>
                <tr className="border-b border-border">
                  <td className="py-4 px-4 text-foreground">Persistent Storage</td>
                  {TIERS.map((tier) => (
                    <td key={tier.id} className="text-center py-4 px-4">
                      <Check className="w-5 h-5 text-green-600 mx-auto" />
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-border">
                  <td className="py-4 px-4 text-foreground">Platform Connections</td>
                  <td className="text-center py-4 px-4 text-muted-foreground">1</td>
                  <td className="text-center py-4 px-4 text-muted-foreground">Multiple</td>
                  <td className="text-center py-4 px-4 text-muted-foreground">Multiple</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-4 px-4 text-foreground">Runtimes</td>
                  <td className="text-center py-4 px-4 text-muted-foreground">OpenClaw</td>
                  <td className="text-center py-4 px-4 text-muted-foreground">All</td>
                  <td className="text-center py-4 px-4 text-muted-foreground">All + Custom</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-4 px-4 text-foreground">Support</td>
                  <td className="text-center py-4 px-4 text-muted-foreground">Community</td>
                  <td className="text-center py-4 px-4 text-muted-foreground">Email</td>
                  <td className="text-center py-4 px-4 text-muted-foreground">Priority</td>
                </tr>
                <tr>
                  <td className="py-4 px-4 text-foreground">Custom Runtimes</td>
                  <td className="text-center py-4 px-4"><X className="w-5 h-5 text-muted-foreground/50 mx-auto" /></td>
                  <td className="text-center py-4 px-4"><X className="w-5 h-5 text-muted-foreground/50 mx-auto" /></td>
                  <td className="text-center py-4 px-4"><Check className="w-5 h-5 text-green-600 mx-auto" /></td>
                </tr>
              </tbody>
            </table>
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
                    ▼
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
            Start free, no credit card required.
          </p>
          <Button
            size="lg"
            onClick={() => isAuthenticated ? router.push("/dashboard") : loginWithRedirect()}
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
