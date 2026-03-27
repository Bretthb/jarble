"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, DollarSign, Globe, Zap } from "lucide-react";
import ProfileDropdown from "@/components/ProfileDropdown";
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
                <div className="space-y-6">
                  <span className="inline-flex items-center px-3 py-1 rounded-full bg-secondary/80 backdrop-blur-sm text-xs font-medium text-muted-foreground border border-border/50">
                    Now in beta
                  </span>
                  <h2 className="text-5xl lg:text-7xl font-serif font-medium leading-[1.1] tracking-tight">
                    Your AI agent,
                    <span className="block text-primary">live today.</span>
                  </h2>
                  <p className="text-xl text-muted-foreground leading-relaxed">
                    Stop waiting on developers, vendors, and implementation timelines. Jarble gets your AI agent running in one sitting - and keeps it working after.
                  </p>
                </div>

                <div className="pt-2 flex flex-col sm:flex-row gap-3">
                  <Button
                    data-tour="hero-cta"
                    size="lg"
                    onClick={handleStartOnboarding}
                    className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-6 font-medium"
                  >
                    Launch Your First Agent
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                  <Button
                    size="lg"
                    variant="ghost"
                    asChild
                    className="rounded-full px-6 font-medium text-muted-foreground hover:text-foreground"
                  >
                    <Link href="/pricing">See pricing</Link>
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
              <h2 className="text-4xl font-serif font-medium leading-tight">
                Your agent is a link.<br />
                <span className="text-primary">Share it and go.</span>
              </h2>
              <p className="text-lg text-muted-foreground">
                Every Jarble agent gets its own URL. Send it to a colleague, bookmark it, drop it in Slack. No app to install, no account required. Just open it and start working.
              </p>
              <p className="text-muted-foreground">
                When you&apos;re ready to go further, connect WhatsApp, Discord, Telegram, or Slack - your agent moves with you.
              </p>
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

      {/* Why Jarble */}
      <section className="pt-12 pb-24 sm:py-24 relative z-10 border-t border-border bg-muted/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-serif font-medium mb-4">
              Built for people who <span className="text-primary">ship, not tinker</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Most AI platforms hand you a blank canvas and wish you luck. Jarble gets you to a running agent and keeps it working.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <div className="p-8 rounded-xl bg-card border border-border">
              <Zap className="w-7 h-7 text-primary mb-4" />
              <h3 className="text-lg font-semibold mb-2">Live in an afternoon</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                A guided setup takes you from nothing to a running agent without touching code or infrastructure. Most teams are live the same day.
              </p>
            </div>
            <div className="p-8 rounded-xl bg-card border border-border">
              <Globe className="w-7 h-7 text-primary mb-4" />
              <h3 className="text-lg font-semibold mb-2">Everywhere your team works</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Web chat, WhatsApp, Discord, Slack, Telegram. One agent, deployed once, available on every platform your team already uses.
              </p>
            </div>
            <div className="p-8 rounded-xl bg-card border border-border">
              <DollarSign className="w-7 h-7 text-primary mb-4" />
              <h3 className="text-lg font-semibold mb-2">Your AI costs stay yours</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Bring your own API key. We host the agent - you pay OpenAI, Anthropic, or Google directly. No markup, no surprises on your bill.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 relative z-10">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <h2 className="text-4xl lg:text-5xl font-serif font-medium mb-4">
            Ready to stop planning<br />and start running?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Join the beta. Your first agent could be live before end of day.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              size="lg"
              onClick={handleStartOnboarding}
              className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-8 font-medium"
            >
              Launch Your First Agent
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              asChild
              className="rounded-full px-8 font-medium"
            >
              <Link href="/beta">Apply for Beta</Link>
            </Button>
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
              <Link href="/terms" className="text-muted-foreground hover:text-primary transition-colors">Terms of Service</Link>
              <Link href="/privacy" className="text-muted-foreground hover:text-primary transition-colors">Privacy Policy</Link>
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
