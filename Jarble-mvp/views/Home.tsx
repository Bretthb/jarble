"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import Image from "next/image";
import { ArrowRight, Zap, Shield, Gauge, Loader2 } from "lucide-react";
import { useState } from "react";
import ProfileDropdown from "@/components/ProfileDropdown";

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
  const { user, isAuthenticated, isLoading } = useAuth0();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");

  const handleStartOnboarding = () => {
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    // Send to dashboard — deploy gate checks happen there
    router.push("/dashboard");
  };

  if (isLoading) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground relative">
      {/* Navigation */}
      <nav className="fixed inset-x-0 top-0 z-50 bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <h1 className="font-serif font-bold text-2xl tracking-tight">Jarble</h1>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/about" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
              About
            </Link>
            <Link href="/pricing" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
              Pricing
            </Link>
            <Link href="/marketplace" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
              Marketplace
            </Link>
            {isAuthenticated ? (
              <>
                <Link href="/dashboard" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                  Dashboard
                </Link>
                <ProfileDropdown />
              </>
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

      {/* Hero + Integrations share one background for seamless blend */}
      <div className="relative pt-16">
        {/* Hero Section */}
        <section className="relative z-10 pt-32 pb-20 lg:pt-48 lg:pb-32 px-4 scroll-mt-20">
          <div className="max-w-6xl mx-auto relative lg:grid lg:grid-cols-[1fr_1fr] lg:gap-4 lg:items-start lg:pt-8">
            {/* Mobile: static image - positioned behind hero text */}
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

            {/* Text content - left column */}
            <div className="relative z-10">
            <div className="max-w-xl space-y-8 animate-fade-in-up">
              <div className="space-y-4">
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-secondary/80 backdrop-blur-sm text-xs font-medium text-muted-foreground border border-border/50">
                  No-Code AI Platform
                </span>
                <h2 className="text-4xl sm:text-6xl lg:text-7xl font-serif font-medium leading-[1.1] tracking-tight">
                  Deploy Your AI
                  <span className="block text-primary">with Jarble</span>
                </h2>
                <p className="text-lg sm:text-xl text-muted-foreground">
                  Create and deploy powerful AI bots across WhatsApp, Discord, Slack, and more. No coding required.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex gap-3 items-start animate-fade-in-up-fast">
                  <Zap className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold">Lightning Fast Setup</h3>
                    <p className="text-sm text-muted-foreground">Get your bot running in under 5 minutes</p>
                  </div>
                </div>
                <div className="flex gap-3 items-start animate-fade-in-up-fast">
                  <Shield className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold">Secure & Reliable</h3>
                    <p className="text-sm text-muted-foreground">Enterprise-grade security and uptime</p>
                  </div>
                </div>
                <div className="flex gap-3 items-start animate-fade-in-up-fast">
                  <Gauge className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold">Flexible Tiers</h3>
                    <p className="text-sm text-muted-foreground">Scale from Bronze to Platinum as you grow</p>
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
                  Start Creating
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </div>
            </div>
            </div>

            {/* Desktop: video with moving character - only visible on sm+ screens */}
            <div className="hidden sm:flex justify-center lg:justify-start lg:-ml-4 animate-fade-in-scale">
              <div className="relative w-full max-w-lg aspect-square flex items-center justify-center">
                <div className="absolute inset-0 bg-gradient-to-tr from-muted to-transparent rounded-full blur-3xl opacity-25" />
                <video
                  autoPlay
                  muted
                  playsInline
                  preload="metadata"
                  className="relative w-full h-full object-contain"
                  aria-label="Jarble thinker hero animation"
                  poster="/hero-mobile.webp"
                >
                  <source src="/hero-animation.webm" type="video/webm" media="(min-width: 640px)" />
                </video>
              </div>
            </div>
          </div>
        </section>

        {/* Integrations Section */}
        <section data-tour="integrations" className="relative py-24 overflow-hidden scroll-mt-20">
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
      </div>

      {/* Features Grid */}
      <section className="py-24 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="p-6 rounded-xl bg-card/80 backdrop-blur-md border border-border shadow-sm animate-fade-in-up-fast">
              <h3 className="text-xl font-serif font-medium text-primary mb-3">You're the Owner:</h3>
              <p className="text-muted-foreground">Your bots, your data, your rules. Full control over your AI agents.</p>
            </div>
            <div className="p-6 rounded-xl bg-card/80 backdrop-blur-md border border-border shadow-sm animate-fade-in-up-fast">
              <h3 className="text-xl font-serif font-medium text-primary mb-3">Set the Context:</h3>
              <p className="text-muted-foreground">Define your bot's knowledge, personality, and how it responds.</p>
            </div>
            <div className="p-6 rounded-xl bg-card/80 backdrop-blur-md border border-border shadow-sm animate-fade-in-up-fast">
              <h3 className="text-xl font-serif font-medium text-primary mb-3">Set the Rules:</h3>
              <p className="text-muted-foreground">Configure boundaries, guardrails, and behavior for your AI.</p>
            </div>
            <div className="p-6 rounded-xl bg-card/80 backdrop-blur-md border border-border shadow-sm animate-fade-in-up-fast">
              <h3 className="text-xl font-serif font-medium text-primary mb-3">Upgradable:</h3>
              <p className="text-muted-foreground">From agent skills to hardware, we've got you covered.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 relative z-10 border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="font-serif font-bold text-foreground">Jarble</span>
            </div>
            <nav className="flex flex-wrap justify-center gap-x-8 gap-y-2">
              <Link href="/about" className="text-muted-foreground hover:text-primary transition-colors">About</Link>
              <Link href="/pricing" className="text-muted-foreground hover:text-primary transition-colors">Pricing</Link>
              <span className="text-muted-foreground/50 cursor-default" title="Coming soon">Documentation</span>
              <span className="text-muted-foreground/50 cursor-default" title="Coming soon">API Reference</span>
              <span className="text-muted-foreground/50 cursor-default" title="Coming soon">Terms of Service</span>
              <span className="text-muted-foreground/50 cursor-default" title="Coming soon">Privacy Policy</span>
              <span className="text-muted-foreground/50 cursor-default" title="Coming soon">Contact</span>
            </nav>
          </div>
          <div className="mt-8 pt-8 text-center text-muted-foreground text-sm">
            <p>&copy; 2026 Jarble. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
