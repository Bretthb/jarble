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

const WatercolorBlob = dynamic(() => import("@/components/WatercolorBlob"), {
  ssr: false,
});

// Pricing tiers - matches MOCK_TIERS in OnboardingWizard
const TIERS = [
  {
    id: 1,
    name: "bronze",
    displayName: "Bronze",
    description: "Perfect for getting started",
    maxConnections: 2,
    maxSkills: 5,
    monthlyRequests: 1000,
    price: 0,
    popular: false,
    features: [
      { name: "AI Bot deployment", included: true },
      { name: "2 platform connections", included: true },
      { name: "5 skills from marketplace", included: true },
      { name: "1,000 requests/month", included: true },
      { name: "Community support", included: true },
      { name: "Basic analytics", included: true },
      { name: "Custom branding", included: false },
      { name: "Priority support", included: false },
      { name: "API access", included: false },
    ]
  },
  {
    id: 2,
    name: "silver",
    displayName: "Silver",
    description: "For growing projects",
    maxConnections: 5,
    maxSkills: 15,
    monthlyRequests: 10000,
    price: 1999,
    popular: true,
    features: [
      { name: "AI Bot deployment", included: true },
      { name: "5 platform connections", included: true },
      { name: "15 skills from marketplace", included: true },
      { name: "10,000 requests/month", included: true },
      { name: "Email support", included: true },
      { name: "Advanced analytics", included: true },
      { name: "Custom branding", included: true },
      { name: "Priority support", included: false },
      { name: "API access", included: false },
    ]
  },
  {
    id: 3,
    name: "gold",
    displayName: "Gold",
    description: "For serious builders",
    maxConnections: 15,
    maxSkills: 50,
    monthlyRequests: 100000,
    price: 4999,
    popular: false,
    features: [
      { name: "AI Bot deployment", included: true },
      { name: "15 platform connections", included: true },
      { name: "50 skills from marketplace", included: true },
      { name: "100,000 requests/month", included: true },
      { name: "Priority email support", included: true },
      { name: "Advanced analytics", included: true },
      { name: "Custom branding", included: true },
      { name: "Priority support", included: true },
      { name: "API access", included: true },
    ]
  },
  {
    id: 4,
    name: "platinum",
    displayName: "Platinum",
    description: "Unlimited power",
    maxConnections: -1,
    maxSkills: -1,
    monthlyRequests: -1,
    price: 9999,
    popular: false,
    features: [
      { name: "AI Bot deployment", included: true },
      { name: "Unlimited connections", included: true },
      { name: "Unlimited skills", included: true },
      { name: "Unlimited requests", included: true },
      { name: "Dedicated support", included: true },
      { name: "Custom analytics dashboard", included: true },
      { name: "White-label solution", included: true },
      { name: "24/7 priority support", included: true },
      { name: "Full API access", included: true },
    ]
  },
];

const FAQ = [
  {
    question: "Can I change plans later?",
    answer: "Yes! You can upgrade or downgrade your plan at any time. When upgrading, you'll get immediate access to new features. When downgrading, changes take effect at the end of your billing cycle."
  },
  {
    question: "What counts as a 'request'?",
    answer: "A request is any message your bot processes and responds to. This includes messages from any connected platform. Unused requests don't roll over to the next month."
  },
  {
    question: "Can I use my own API keys?",
    answer: "Absolutely! You can bring your own API keys from OpenAI, Anthropic, Google, or Mistral. This gives you full control over costs and model selection. Alternatively, use our managed service and we handle everything."
  },
  {
    question: "What platforms can I connect to?",
    answer: "We support 50+ platforms including WhatsApp, Discord, Slack, Telegram, web chat, email, and many more. New integrations are added regularly based on user feedback."
  },
  {
    question: "Is there a free trial?",
    answer: "The Bronze tier is free forever with no credit card required. It's a great way to explore Jarble and build your first bot. Upgrade when you're ready to scale."
  },
  {
    question: "What's included in priority support?",
    answer: "Priority support includes faster response times (under 4 hours), dedicated support channels, and direct access to our engineering team for complex issues."
  },
];

function formatPrice(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(0)}`;
}

export default function Pricing() {
  const { isAuthenticated } = useAuth0();
  const router = useRouter();
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">("monthly");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const getAnnualPrice = (monthlyPrice: number) => {
    if (monthlyPrice === 0) return 0;
    return Math.round(monthlyPrice * 12 * 0.8);
  };

  const handleGetStarted = (tierName: string) => {
    if (isAuthenticated) {
      router.push("/dashboard");
    } else {
      router.push("/register");
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
                onClick={() => router.push("/login")}
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
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
            Start free, scale as you grow. No hidden fees, no surprises.
          </p>

          {/* Billing Toggle */}
          <div className="inline-flex items-center gap-4 bg-secondary/80 backdrop-blur-sm rounded-full p-1.5 border border-border/50">
            <button
              onClick={() => setBillingPeriod("monthly")}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                billingPeriod === "monthly"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-primary"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingPeriod("annual")}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                billingPeriod === "annual"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-primary"
              }`}
            >
              Annual
              <span className="ml-2 text-xs bg-green-600/20 text-green-600 px-2 py-0.5 rounded-full">
                Save 20%
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="pb-20 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {TIERS.map((tier) => {
              const price = billingPeriod === "annual"
                ? getAnnualPrice(tier.price)
                : tier.price;

              return (
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
                      <span className="text-4xl font-bold">
                        {formatPrice(price)}
                      </span>
                      {price > 0 && (
                        <span className="text-muted-foreground">
                          /{billingPeriod === "annual" ? "year" : "mo"}
                        </span>
                      )}
                    </div>
                    {billingPeriod === "annual" && tier.price > 0 && (
                      <p className="text-sm text-green-600 mt-1">
                        ${(tier.price / 100).toFixed(0)}/mo billed annually
                      </p>
                    )}
                  </div>

                  <Button
                    onClick={() => handleGetStarted(tier.name)}
                    className={`w-full mb-6 rounded-full ${
                      tier.popular
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "border-input bg-background/50 backdrop-blur-sm hover:bg-secondary/50"
                    }`}
                  >
                    {tier.price === 0 ? "Get Started Free" : "Get Started"}
                  </Button>

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
              );
            })}
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
              For large organizations with custom requirements, dedicated infrastructure,
              SLA guarantees, and enterprise security needs.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                size="lg"
                variant="outline"
                onClick={() => window.location.href = "mailto:enterprise@jarble.ai"}
                className="rounded-full border-input bg-background/50 backdrop-blur-sm hover:bg-secondary/50"
              >
                <MessageSquare className="w-5 h-5 mr-2" />
                Contact Sales
              </Button>
              <Button
                size="lg"
                onClick={() => router.push("/about")}
                className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-6 font-medium"
              >
                Learn More
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Comparison Table */}
      <section className="py-20 relative z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
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
                  <td className="py-4 px-4 text-foreground">Platform Connections</td>
                  {TIERS.map((tier) => (
                    <td key={tier.id} className="text-center py-4 px-4">
                      {tier.maxConnections === -1 ? "Unlimited" : tier.maxConnections}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-border">
                  <td className="py-4 px-4 text-foreground">Skills from Marketplace</td>
                  {TIERS.map((tier) => (
                    <td key={tier.id} className="text-center py-4 px-4">
                      {tier.maxSkills === -1 ? "Unlimited" : tier.maxSkills}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-border">
                  <td className="py-4 px-4 text-foreground">Monthly Requests</td>
                  {TIERS.map((tier) => (
                    <td key={tier.id} className="text-center py-4 px-4">
                      {tier.monthlyRequests === -1 ? "Unlimited" : tier.monthlyRequests.toLocaleString()}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-border">
                  <td className="py-4 px-4 text-foreground">Support</td>
                  <td className="text-center py-4 px-4 text-muted-foreground">Community</td>
                  <td className="text-center py-4 px-4 text-muted-foreground">Email</td>
                  <td className="text-center py-4 px-4 text-muted-foreground">Priority</td>
                  <td className="text-center py-4 px-4 text-muted-foreground">Dedicated</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-4 px-4 text-foreground">API Access</td>
                  <td className="text-center py-4 px-4"><X className="w-5 h-5 text-muted-foreground/50 mx-auto" /></td>
                  <td className="text-center py-4 px-4"><X className="w-5 h-5 text-muted-foreground/50 mx-auto" /></td>
                  <td className="text-center py-4 px-4"><Check className="w-5 h-5 text-green-600 mx-auto" /></td>
                  <td className="text-center py-4 px-4"><Check className="w-5 h-5 text-green-600 mx-auto" /></td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-4 px-4 text-foreground">Custom Branding</td>
                  <td className="text-center py-4 px-4"><X className="w-5 h-5 text-muted-foreground/50 mx-auto" /></td>
                  <td className="text-center py-4 px-4"><Check className="w-5 h-5 text-green-600 mx-auto" /></td>
                  <td className="text-center py-4 px-4"><Check className="w-5 h-5 text-green-600 mx-auto" /></td>
                  <td className="text-center py-4 px-4"><Check className="w-5 h-5 text-green-600 mx-auto" /></td>
                </tr>
                <tr>
                  <td className="py-4 px-4 text-foreground">White Label</td>
                  <td className="text-center py-4 px-4"><X className="w-5 h-5 text-muted-foreground/50 mx-auto" /></td>
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
            Join thousands of builders using Jarble to deploy AI bots.
            Start free, no credit card required.
          </p>
          <Button
            size="lg"
            onClick={() => router.push(isAuthenticated ? "/dashboard" : "/register")}
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
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors">Documentation</a>
              <a href="#" className="text-muted-foreground hover:text-primary transition-colors">Contact</a>
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
