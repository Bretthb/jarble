"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { API_URL } from "@/lib/trpc";

const DISCORD_INVITE_URL = "https://discord.gg/REPLACE_ME";

interface BetaFormData {
  name: string;
  email: string;
  useCase: string;
  experience: string;
}

export default function BetaPage() {
  const [form, setForm] = useState<BetaFormData>({
    name: "",
    email: "",
    useCase: "",
    experience: "beginner",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/api/beta-signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to submit application");
      }

      setSubmitted(true);
      // Open Discord invite in new tab
      window.open(DISCORD_INVITE_URL, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="fixed inset-x-0 top-0 z-50 bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Link href="/" className="font-serif font-bold text-2xl tracking-tight hover:text-primary transition-colors">
              Jarble
            </Link>
          </div>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </Link>
        </div>
      </nav>

      <div className="pt-32 pb-24 px-4">
        <div className="max-w-xl mx-auto">
          {/* Header */}
          <div className="text-center mb-10 space-y-4">
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/10 text-xs font-semibold text-primary border border-primary/20">
              Beta Testing — March 29, 2026
            </span>
            <h1 className="text-4xl sm:text-5xl font-serif font-medium tracking-tight">
              Join the <span className="text-primary">Beta</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-md mx-auto">
              Be among the first to test Jarble. Our 2-week beta starts March 29th — apply now for early access.
            </p>
          </div>

          {submitted ? (
            /* Success state */
            <div className="rounded-xl border border-border bg-card/80 backdrop-blur-md p-8 text-center space-y-5">
              <div className="w-14 h-14 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7 text-green-500" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-serif font-medium">Application Received</h2>
                <p className="text-muted-foreground">
                  Thanks, {form.name}! We'll review your application and reach out at{" "}
                  <span className="text-foreground font-medium">{form.email}</span> if you're selected.
                </p>
              </div>
              <div className="pt-2 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Join our Discord to connect with other testers and stay updated:
                </p>
                <Button
                  size="lg"
                  className="rounded-full px-6"
                  onClick={() => window.open(DISCORD_INVITE_URL, "_blank", "noopener,noreferrer")}
                >
                  Join Discord Server
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          ) : (
            /* Application form */
            <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card/80 backdrop-blur-md p-8 space-y-6">
              {/* Name */}
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  id="name"
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Your full name"
                  className="w-full px-4 py-2.5 rounded-lg bg-background border border-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all text-sm"
                />
              </div>

              {/* Email */}
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email <span className="text-red-400">*</span>
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="you@example.com"
                  className="w-full px-4 py-2.5 rounded-lg bg-background border border-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all text-sm"
                />
              </div>

              {/* Experience level */}
              <div className="space-y-2">
                <label htmlFor="experience" className="text-sm font-medium">
                  Technical experience
                </label>
                <select
                  id="experience"
                  value={form.experience}
                  onChange={(e) => setForm({ ...form, experience: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-lg bg-background border border-input text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all text-sm"
                >
                  <option value="beginner">Beginner — No coding experience</option>
                  <option value="intermediate">Intermediate — Some technical background</option>
                  <option value="advanced">Advanced — Developer / engineer</option>
                </select>
              </div>

              {/* Use case */}
              <div className="space-y-2">
                <label htmlFor="useCase" className="text-sm font-medium">
                  What would you use Jarble for?
                </label>
                <textarea
                  id="useCase"
                  value={form.useCase}
                  onChange={(e) => setForm({ ...form, useCase: e.target.value })}
                  placeholder="e.g. Customer support bot for my Shopify store, personal assistant on Discord..."
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-lg bg-background border border-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all text-sm resize-none"
                />
              </div>

              {error && (
                <p className="text-sm text-red-400">{error}</p>
              )}

              <Button
                type="submit"
                size="lg"
                disabled={isSubmitting || !form.name.trim() || !form.email.trim()}
                className="w-full rounded-full font-medium"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    Apply for Beta Access
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                Selected testers will be notified by email before March 29th.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
