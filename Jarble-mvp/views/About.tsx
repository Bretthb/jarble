"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Zap,
  Layers,
  Brain,
  MessageSquare,
  Shield,
  Users,
  CheckCircle2,
  Loader2,
  ChevronRight,
  Rocket,
  SendHorizontal,
  Settings,
  GripVertical,
  TrendingUp,
} from "lucide-react";
import Image from "next/image";
import { useAuth0 } from "@auth0/auth0-react";
import { useEffect, useState, useRef } from "react";

// ── Animated product demo ───────────────────────────────────────────────

const DEMO_BOT_NAME = "My Sales Bot";
const DEMO_GREETING =
  "Hey! I'm your new sales assistant. How can I help you today?";
const DEMO_USER_MSG = "What can you help me with?";
const DEMO_REPLY =
  "I can qualify leads, answer product questions, schedule demos, and follow up with prospects - all on autopilot.";

const STEP_LABELS = ["Name", "Runtime", "Deploy"];

function AnimatedProductDemo() {
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);
  const [typedName, setTypedName] = useState("");
  const [runtimePicked, setRuntimePicked] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployed, setDeployed] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [greeting, setGreeting] = useState("");
  const [showUser, setShowUser] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [reply, setReply] = useState("");
  const [showGrid, setShowGrid] = useState(false);
  const [gridItems, setGridItems] = useState<number[]>([]);
  const [dragIdx, setDragIdx] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => timers.current.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setStarted(true);
      },
      { threshold: 0.3 },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!started) return;

    const wait = (ms: number) =>
      new Promise<void>((r) => {
        timers.current.push(setTimeout(r, ms));
      });

    const type = async (
      text: string,
      set: (s: string) => void,
      ms: number,
    ) => {
      for (let i = 1; i <= text.length; i++) {
        set(text.slice(0, i));
        await wait(ms);
      }
    };

    (async () => {
      await wait(400);
      await type(DEMO_BOT_NAME, setTypedName, 55);
      await wait(900);
      setStep(1);
      await wait(700);
      setRuntimePicked(true);
      await wait(1000);
      setStep(2);
      await wait(500);
      setDeploying(true);
      await wait(2200);
      setDeployed(true);
      await wait(1200);
      setShowChat(true);
      await wait(500);
      await type(DEMO_GREETING, setGreeting, 18);
      await wait(1200);
      setShowUser(true);
      await wait(1000);
      setThinking(true);
      await wait(1800);
      setThinking(false);
      await type(DEMO_REPLY, setReply, 16);
      await wait(1500);
      setShowGrid(true);
      await wait(500);
      setGridItems([0]);
      await wait(400);
      setGridItems([0, 1]);
      await wait(400);
      setGridItems([0, 1, 2]);
      await wait(400);
      setGridItems([0, 1, 2, 3]);
      await wait(1200);
      setDragIdx(1);
      await wait(1500);
      setDragIdx(-1);
    })();
  }, [started]);

  const progress =
    step === 0 ? 33 : step === 1 ? 66 : deployed ? 100 : 85;

  return (
    <div
      ref={ref}
      className="rounded-xl border border-border overflow-hidden shadow-2xl"
    >
      <div className="relative min-h-[380px]">
        {/* ── Wizard view ── */}
        <div
          className={`absolute inset-0 flex flex-col bg-card transition-opacity duration-500 ${
            showChat ? "opacity-0 pointer-events-none" : "opacity-100"
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60">
            <div className="flex items-center gap-2">
              <span className="font-serif font-bold text-sm">Jarble</span>
              <span className="text-xs text-muted-foreground">
                New Deployment
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {step + 1}/3
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-secondary/50">
            <div
              className="h-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Step pills */}
          <div className="flex gap-2 px-4 py-3">
            {STEP_LABELS.map((label, i) => (
              <span
                key={label}
                className={`text-xs px-2.5 py-1 rounded-full transition-colors duration-300 ${
                  i < step
                    ? "bg-primary/10 text-primary"
                    : i === step
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground"
                }`}
              >
                {i < step && (
                  <CheckCircle2 className="w-3 h-3 inline mr-1 -mt-0.5" />
                )}
                {label}
              </span>
            ))}
          </div>

          {/* Step content */}
          <div className="flex-1 px-5 py-4">
            {step === 0 && (
              <div>
                <p className="text-sm font-medium mb-3">Name your bot</p>
                <div className="flex items-center bg-secondary/40 border border-border rounded-lg px-3 py-2.5">
                  <span className="text-sm">{typedName}</span>
                  {typedName.length < DEMO_BOT_NAME.length && (
                    <span className="w-0.5 h-4 bg-foreground ml-0.5 animate-pulse" />
                  )}
                </div>
              </div>
            )}

            {step === 1 && (
              <div>
                <p className="text-sm font-medium mb-3">Choose a runtime</p>
                <div
                  className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all duration-300 ${
                    runtimePicked
                      ? "border-primary bg-primary/5"
                      : "border-border"
                  }`}
                >
                  <Image
                    src="/openclaw-logo.svg"
                    alt="OpenClaw"
                    width={36}
                    height={36}
                    className="w-9 h-9 rounded-lg"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">OpenClaw</p>
                    <p className="text-xs text-muted-foreground">
                      Multi-platform AI runtime
                    </p>
                  </div>
                  {runtimePicked && (
                    <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
                  )}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col items-center justify-center py-6">
                {deploying && !deployed && (
                  <>
                    <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
                    <p className="text-sm text-muted-foreground">
                      Deploying your bot...
                    </p>
                  </>
                )}
                {deployed && (
                  <>
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-3" />
                    <p className="text-sm font-medium text-emerald-500">
                      Deployed!
                    </p>
                  </>
                )}
                {!deploying && !deployed && (
                  <p className="text-sm text-muted-foreground">
                    Ready to deploy
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Footer button */}
          <div className="px-5 py-3 border-t border-border/60">
            <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium bg-primary text-primary-foreground">
              {step < 2 ? (
                <>
                  Continue <ChevronRight className="w-3.5 h-3.5" />
                </>
              ) : deploying && !deployed ? (
                <>
                  Deploying <Loader2 className="w-3.5 h-3.5 animate-spin" />
                </>
              ) : deployed ? (
                <>
                  Deployed <CheckCircle2 className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  Deploy <Rocket className="w-3.5 h-3.5" />
                </>
              )}
            </span>
          </div>
        </div>

        {/* ── Chat view ── */}
        <div
          className={`absolute inset-0 flex flex-col bg-card transition-opacity duration-500 ${
            showChat && !showGrid
              ? "opacity-100"
              : "opacity-0 pointer-events-none"
          }`}
        >
          {/* Chat header */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60">
            <Image
              src="/openclaw-logo.svg"
              alt=""
              width={24}
              height={24}
              className="w-6 h-6 rounded"
            />
            <span className="text-sm font-medium">My Sales Bot</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <div className="flex-1" />
            <Settings className="w-4 h-4 text-muted-foreground" />
          </div>

          {/* Messages */}
          <div className="flex-1 px-4 py-4 space-y-4 overflow-hidden">
            {greeting && (
              <div className="flex gap-2.5 items-start">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-primary">
                    AI
                  </span>
                </div>
                <div className="bg-secondary/50 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm max-w-[85%]">
                  {greeting}
                  {greeting.length < DEMO_GREETING.length && (
                    <span className="inline-block w-0.5 h-3.5 bg-foreground ml-0.5 animate-pulse align-middle" />
                  )}
                </div>
              </div>
            )}

            {showUser && (
              <div className="flex gap-2.5 items-start justify-end">
                <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-sm max-w-[85%]">
                  {DEMO_USER_MSG}
                </div>
              </div>
            )}

            {thinking && (
              <div className="flex gap-2.5 items-start">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-primary">
                    AI
                  </span>
                </div>
                <div className="bg-secondary/50 rounded-2xl rounded-tl-sm px-3.5 py-2.5 flex gap-1">
                  <span
                    className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
              </div>
            )}

            {reply && (
              <div className="flex gap-2.5 items-start">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-primary">
                    AI
                  </span>
                </div>
                <div className="bg-secondary/50 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm max-w-[85%]">
                  {reply}
                  {reply.length < DEMO_REPLY.length && (
                    <span className="inline-block w-0.5 h-3.5 bg-foreground ml-0.5 animate-pulse align-middle" />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Input bar */}
          <div className="px-4 py-3 border-t border-border/60">
            <div className="flex gap-2 items-center">
              <div className="flex-1 bg-secondary/40 border border-border rounded-full px-4 py-2">
                <span className="text-sm text-muted-foreground">
                  Type a message...
                </span>
              </div>
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <SendHorizontal className="w-4 h-4 text-primary-foreground" />
              </div>
            </div>
          </div>
        </div>

        {/* ── Grid / Dashboard view ── */}
        <div
          className={`absolute inset-0 flex flex-col bg-card transition-opacity duration-500 ${
            showGrid ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60">
            <Image
              src="/openclaw-logo.svg"
              alt=""
              width={24}
              height={24}
              className="w-6 h-6 rounded"
            />
            <span className="text-sm font-medium">My Sales Bot</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <div className="flex-1" />
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              Dashboard
            </span>
          </div>

          {/* AI generation message */}
          <div className="px-4 pt-3 pb-2">
            <div className="flex gap-2 items-center">
              <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-[8px] font-bold text-primary">AI</span>
              </div>
              <span className="text-xs text-muted-foreground">
                Here&apos;s your sales dashboard:
              </span>
            </div>
          </div>

          {/* Component grid */}
          <div className="flex-1 px-4 pb-4 grid grid-cols-2 gap-3 content-start">
            {/* Revenue stat */}
            {gridItems.includes(0) && (
              <div
                className={`bg-secondary/30 rounded-xl p-3.5 border border-border/40 animate-fade-in-up-fast transition-all duration-300 ${
                  dragIdx === 0
                    ? "scale-[1.04] shadow-lg ring-2 ring-primary/30 z-10"
                    : ""
                }`}
              >
                <div className="flex justify-between items-start">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Revenue
                  </p>
                  <GripVertical className="w-3 h-3 text-muted-foreground/30" />
                </div>
                <p className="text-xl font-bold mt-1">$12,400</p>
                <p className="text-[10px] text-emerald-500 mt-0.5">
                  ↑ 18% from last month
                </p>
              </div>
            )}

            {/* Pipeline chart */}
            {gridItems.includes(1) && (
              <div
                className={`bg-secondary/30 rounded-xl p-3.5 border border-border/40 animate-fade-in-up-fast transition-all duration-300 ${
                  dragIdx === 1
                    ? "scale-[1.04] shadow-lg ring-2 ring-primary/30 z-10"
                    : ""
                }`}
              >
                <div className="flex justify-between items-start">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Pipeline
                  </p>
                  <GripVertical className="w-3 h-3 text-muted-foreground/30" />
                </div>
                <div className="flex items-end gap-1 h-14 mt-2">
                  {[40, 65, 45, 80, 55, 70, 90].map((h, j) => (
                    <div
                      key={j}
                      className="flex-1 bg-primary/50 rounded-t-sm"
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Active Leads */}
            {gridItems.includes(2) && (
              <div
                className={`bg-secondary/30 rounded-xl p-3.5 border border-border/40 animate-fade-in-up-fast transition-all duration-300 ${
                  dragIdx === 2
                    ? "scale-[1.04] shadow-lg ring-2 ring-primary/30 z-10"
                    : ""
                }`}
              >
                <div className="flex justify-between items-start">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Active Leads
                  </p>
                  <GripVertical className="w-3 h-3 text-muted-foreground/30" />
                </div>
                <div className="space-y-1.5 mt-2">
                  <div className="flex justify-between text-[11px]">
                    <span>Acme Corp</span>
                    <span className="text-primary font-medium">Hot</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span>TechStart</span>
                    <span className="text-amber-500 font-medium">Warm</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span>GlobalFin</span>
                    <span className="text-primary font-medium">Hot</span>
                  </div>
                </div>
              </div>
            )}

            {/* Quota progress */}
            {gridItems.includes(3) && (
              <div
                className={`bg-secondary/30 rounded-xl p-3.5 border border-border/40 animate-fade-in-up-fast transition-all duration-300 ${
                  dragIdx === 3
                    ? "scale-[1.04] shadow-lg ring-2 ring-primary/30 z-10"
                    : ""
                }`}
              >
                <div className="flex justify-between items-start">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Quota
                  </p>
                  <GripVertical className="w-3 h-3 text-muted-foreground/30" />
                </div>
                <div className="mt-3">
                  <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: "72%" }}
                    />
                  </div>
                  <div className="flex justify-between mt-1.5">
                    <span className="text-[10px] text-muted-foreground">
                      $9.2k / $12.8k
                    </span>
                    <span className="text-[10px] font-medium text-primary">
                      72%
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────

export default function About() {
  const { isAuthenticated } = useAuth0();
  const router = useRouter();

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
            <Link href="/about" className="text-sm font-medium text-primary">
              About
            </Link>
            <Link href="/pricing" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
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
      <section className="pt-36 pb-20 relative z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center animate-fade-in-up">
          <p className="text-sm font-medium text-primary mb-6 tracking-widest uppercase">Think More</p>
          <h1 className="text-5xl lg:text-6xl font-serif font-medium leading-tight mb-6">
            From <span className="text-primary">"I want a bot"</span>
            <br />to "I have a bot"
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Most AI tools are either too limited or require an engineering team.
            Jarble is for everyone in between.
          </p>
        </div>
      </section>

      {/* Product demo */}
      <section className="pb-24 relative z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <AnimatedProductDemo />
        </div>
      </section>

      {/* The problem - concise */}
      <section className="py-20 relative z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl font-serif font-medium mb-6">The problem</h2>
              <p className="text-lg text-muted-foreground leading-relaxed mb-4">
                Consumer AI toys are too limited. Developer platforms require you to be an engineer.
                There's nothing in between for the person who has a real use case, a real API key,
                and zero interest in managing infrastructure.
              </p>
              <p className="text-lg text-muted-foreground leading-relaxed">
                The real competitor isn't another product - it's inertia. It's the moment you realize
                it's going to take a weekend just to get started, and you close the laptop instead.
              </p>
            </div>
            <div className="bg-card/80 backdrop-blur-md border border-border rounded-2xl p-8 shadow-sm">
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">The hard way</span>
                  <span className="text-muted-foreground text-sm">~2 weeks</span>
                </div>
                <div className="space-y-2">
                  {["Research runtimes", "Provision a server", "Configure networking", "Set up the bot framework", "Integrate platform APIs", "Deploy and monitor"].map((step) => (
                    <div key={step} className="flex items-center gap-2 text-sm text-muted-foreground/60">
                      <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                      <span className="line-through">{step}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-border pt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground font-medium">The Jarble way</span>
                    <span className="text-primary text-sm font-medium">~2 minutes</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">Pick a runtime. Paste your key. Deploy.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What we built - cards */}
      <section className="py-20 border-y border-border/60 relative z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-serif font-medium mb-12 text-center">What we built</h2>

          <div className="grid sm:grid-cols-2 gap-6">
            <div className="bg-card/80 backdrop-blur-md border border-border rounded-2xl p-6 hover:border-primary/30 transition-colors">
              <Layers className="w-8 h-8 text-primary mb-4" />
              <h3 className="font-semibold text-lg mb-2">Runtime agnostic</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Not tied to one engine. Pick the runtime that fits your use case and swap it later. No lock-in.
              </p>
            </div>
            <div className="bg-card/80 backdrop-blur-md border border-border rounded-2xl p-6 hover:border-primary/30 transition-colors">
              <Brain className="w-8 h-8 text-primary mb-4" />
              <h3 className="font-semibold text-lg mb-2">Any model, any provider</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Bring your own key from OpenRouter, OpenAI, Anthropic, or Google AI. No markup on your costs.
              </p>
            </div>
            <div className="bg-card/80 backdrop-blur-md border border-border rounded-2xl p-6 hover:border-primary/30 transition-colors">
              <MessageSquare className="w-8 h-8 text-primary mb-4" />
              <h3 className="font-semibold text-lg mb-2">Every platform</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                WhatsApp, Discord, Telegram, Slack, Web Chat, Teams, Messenger - all from one dashboard.
              </p>
            </div>
            <div className="bg-card/80 backdrop-blur-md border border-border rounded-2xl p-6 hover:border-primary/30 transition-colors">
              <Shield className="w-8 h-8 text-primary mb-4" />
              <h3 className="font-semibold text-lg mb-2">Isolated infrastructure</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Every deployment gets its own storage and configuration. Not a shared sandbox - a dedicated instance.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Team */}
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
              { step: 3, title: "Connect Platforms", desc: "Pick where your bot lives - Discord, Slack, web, etc." },
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
                "First-mover in no-code AI deployment",
                "Model-agnostic architecture",
                "50+ platform integrations",
                "Tiered pricing for all segments",
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
            A World Where Everyone Has an AI Assistant
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            We envision a future where deploying AI is as simple as creating a social media account.
            Where small businesses have the same AI capabilities as Fortune 500 companies.
            Where creators, entrepreneurs, and teams can focus on their vision while AI handles the rest.
          </p>
          <p className="text-xl text-primary font-medium">
            Jarble is building that future.
          </p>
        </div>
      </section>

      {/* Team Section */}
      <section className="py-20 relative z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="flex items-center justify-center gap-2 text-primary font-medium mb-4">
              <Users className="w-5 h-5" />
              The Team
            </div>
            <h2 className="text-3xl font-serif font-medium mb-3">
              Built by four founders
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              Who got tired of watching good ideas die in the gap between wanting to build something and actually shipping it.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto">
            {["Tanner", "Brett", "CJ", "Albert"].map((name) => (
              <div key={name} className="bg-card/80 backdrop-blur-md border border-border rounded-xl p-5 text-center hover:border-primary/30 transition-colors">
                <div className="w-14 h-14 rounded-full bg-primary/10 mx-auto mb-3 flex items-center justify-center">
                  <span className="text-lg font-serif font-bold text-primary">{name[0]}</span>
                </div>
                <p className="font-medium text-sm">{name}</p>
                <p className="text-xs text-muted-foreground">Co-Founder</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 relative z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-serif font-medium mb-4">
            Ready to close the gap?
          </h2>
          <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
            If deploying a bot seemed like too much work, that's exactly the problem we built Jarble to solve.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Button
              size="lg"
              onClick={() => router.push(isAuthenticated ? "/dashboard" : "/login")}
              className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-6 font-medium"
            >
              <Zap className="w-5 h-5 mr-2" />
              Get Started
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
              <Link href="/terms" className="text-muted-foreground hover:text-primary transition-colors">Terms of Service</Link>
              <Link href="/privacy" className="text-muted-foreground hover:text-primary transition-colors">Privacy Policy</Link>
              <span className="text-muted-foreground/50 cursor-default" title="Coming soon">Documentation</span>
              <span className="text-muted-foreground/50 cursor-default" title="Coming soon">Contact</span>
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
