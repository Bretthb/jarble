"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  Rocket,
  HelpCircle,
  Cpu,
  HardDrive,
  MemoryStick,
  Gift,
  ChevronRight,
  RotateCcw,
  SlidersHorizontal,
  MailWarning,
  MailCheck,
  CreditCard,
} from "lucide-react";
import QRCode from "react-qr-code";
import { DeploymentLoader } from "@/components/WizardLoader";
import { calculateMonthlyPriceCents, formatPriceCents } from "@/lib/pricing";
import type { RuntimeEntry } from "../types";
import {
  LLM_MODELS,
  getProviderById,
  CPU_OPTIONS,
  MEMORY_OPTIONS,
  STORAGE_OPTIONS,
} from "../wizardStepConfig";

interface StepDeployProps {
  isDeploying: boolean;
  deployProgress: number;
  name: string;
  runtime?: RuntimeEntry;
  llmMode: "included" | "byok";
  llmProvider: string;
  llmModel: string;
  isFree: boolean;
  cpuLimit: string | null;
  setCpuLimit: (v: string | null) => void;
  memoryMb: number | null;
  setMemoryMb: (v: number | null) => void;
  storageMb: number | null;
  setStorageMb: (v: number | null) => void;
  emailVerified: boolean;
  deployPhase: "idle" | "deploying" | "pairing" | "paired";
  telegramBotUsername: string | null;
  // Stripe checkout (redirect)
  checkoutConfirmed: boolean;
  isRedirectingToCheckout: boolean;
  onCheckout: () => void;
}

export default function StepDeploy({
  isDeploying,
  deployProgress,
  name,
  runtime,
  llmMode,
  llmProvider,
  llmModel,
  isFree,
  cpuLimit,
  setCpuLimit,
  memoryMb,
  setMemoryMb,
  storageMb,
  setStorageMb,
  emailVerified,
  deployPhase,
  telegramBotUsername,
  checkoutConfirmed,
  isRedirectingToCheckout,
  onCheckout,
}: StepDeployProps) {
  const providerDef = getProviderById(llmProvider);
  const modelDef = LLM_MODELS.find((m) => m.id === llmModel);
  const [showHardware, setShowHardware] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);

  const resendVerificationMutation = trpc.user.resendVerificationEmail.useMutation({
    onSuccess: () => {
      toast.success("Verification email sent! Check your inbox.");
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Failed to send verification email");
    },
    onSettled: () => setIsResendingVerification(false),
  });

  // Effective values (custom or runtime defaults)
  const effectiveCpu = cpuLimit ?? runtime?.cpuLimit ?? "2.0";
  const effectiveMemory = memoryMb ?? runtime?.memoryMb ?? 2048;
  const effectiveStorage = storageMb ?? runtime?.storageMb ?? 30;
  const isCustomized = cpuLimit !== null || memoryMb !== null || storageMb !== null;

  // Dynamic price based on actual hardware selection
  const dynamicPriceCents = calculateMonthlyPriceCents(effectiveCpu, effectiveMemory, effectiveStorage);
  const needsPayment = !isFree && runtime && dynamicPriceCents > 0;

  const handleResetToRecommended = () => {
    setCpuLimit(null);
    setMemoryMb(null);
    setStorageMb(null);
  };

  return (
    <div className="space-y-6 text-center">
      {isDeploying ? (
        <div className="py-8">
          <DeploymentLoader progress={deployProgress} />
          {llmMode === "included" && (
            <p className="text-sm text-muted-foreground mt-4 animate-pulse">
              Setting up LLM access...
            </p>
          )}
        </div>
      ) : deployPhase === "paired" && telegramBotUsername ? (
        /* Pairing complete — brief success before auto-redirect */
        <div className="py-8">
          <div className="bg-secondary/50 border border-border rounded-lg p-8 text-center space-y-6">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10 text-primary" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-primary mb-1">Paired!</h3>
              <p className="text-muted-foreground text-sm">
                Your bot <strong>@{telegramBotUsername}</strong> is paired and ready to chat
              </p>
            </div>
            <div className="flex flex-col items-center gap-3">
              <div className="bg-white p-4 rounded-xl shadow-sm inline-block">
                <QRCode value={`https://t.me/${telegramBotUsername}`} size={160} level="M" />
              </div>
              <p className="text-xs text-muted-foreground">
                Scan to open <strong>@{telegramBotUsername}</strong> in Telegram
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              Redirecting to dashboard...
            </div>
          </div>
        </div>
      ) : deployPhase === "pairing" && telegramBotUsername ? (
        /* Waiting for Telegram pairing — pod is booting with token */
        <div className="py-8">
          <div className="bg-secondary/50 border border-border rounded-lg p-8 text-center space-y-6">
            <div className="flex flex-col items-center gap-3">
              <div className="bg-white p-4 rounded-xl shadow-sm inline-block">
                <QRCode value={`https://t.me/${telegramBotUsername}`} size={180} level="M" />
              </div>
              <p className="text-sm text-muted-foreground">
                Scan to open <strong>@{telegramBotUsername}</strong> in Telegram
              </p>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-medium">Send your bot any message to pair</p>
              <p className="text-xs text-muted-foreground">
                Your bot is starting up with Telegram enabled. Once ready, send it any
                message and we&apos;ll auto-approve the pairing.
              </p>
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                Waiting for pairing request...
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div>
            <h2 className="text-2xl font-bold mb-2">Deploy</h2>
            <p className="text-muted-foreground">
              Your deployment is configured and ready to launch!
            </p>
          </div>

          {!emailVerified && (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/50 px-4 py-3 text-left">
              <MailWarning className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Email verification required</p>
                <p className="text-xs text-muted-foreground">
                  Check your inbox for a verification link. You need to verify your email before deploying.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsResendingVerification(true);
                  resendVerificationMutation.mutate();
                }}
                disabled={isResendingVerification}
                className="shrink-0 border-border hover:bg-secondary/50"
              >
                {isResendingVerification ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <MailCheck className="w-3.5 h-3.5 mr-1.5" />
                )}
                Resend
              </Button>
            </div>
          )}

          {/* Payment success badge */}
          {checkoutConfirmed && (
            <div className="flex items-center gap-3 rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3 text-left">
              <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
              <p className="text-sm font-medium text-green-500">Payment confirmed — ready to deploy!</p>
            </div>
          )}

          {/* Stripe Checkout — shown for paid runtimes before payment */}
          {!checkoutConfirmed && needsPayment && (
            <div className="rounded-xl border border-border bg-card p-6 text-center space-y-4">
              <p className="text-sm font-semibold">{formatPriceCents(dynamicPriceCents)}/mo</p>
              <p className="text-xs text-muted-foreground">
                You&apos;ll be redirected to Stripe to complete payment
              </p>
              <Button
                onClick={onCheckout}
                disabled={isRedirectingToCheckout}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                {isRedirectingToCheckout ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Redirecting...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Subscribe — {formatPriceCents(dynamicPriceCents)}/mo
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Ready-to-deploy summary — shown when free OR after payment confirmed */}
          {(checkoutConfirmed || !needsPayment) && (
          <div className="bg-secondary/50 rounded-xl border border-border/50 p-12">
            <div className="flex flex-col items-center gap-4">
              <div className="w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center border-2 border-primary/50">
                <Rocket className="w-10 h-10 text-primary" />
              </div>
              <div>
                <p className="text-lg font-semibold">Ready for Takeoff!</p>
                <p className="text-muted-foreground text-sm mt-1">
                  <span className="text-primary font-medium">{name}</span> is
                  configured and waiting to be deployed
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-3 mt-4">
                <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-secondary/50 text-foreground border border-border">
                  <CheckCircle2 className="w-3 h-3" /> Named
                </span>
                <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-secondary/50 text-foreground border border-border">
                  <CheckCircle2 className="w-3 h-3" />{" "}
                  {runtime?.name || "Runtime"} selected
                </span>
                <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-secondary/50 text-foreground border border-border">
                  <CheckCircle2 className="w-3 h-3" /> LLM:{" "}
                  {llmMode === "byok"
                    ? `${providerDef?.name ?? llmProvider}`
                    : "Included Credits"}
                </span>
                <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-secondary/50 text-foreground border border-border">
                  <CheckCircle2 className="w-3 h-3" /> Model:{" "}
                  {modelDef?.name ?? llmModel}
                </span>
                <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-secondary/50 text-foreground border border-border">
                  <Cpu className="w-3 h-3" /> {effectiveCpu} vCPU
                </span>
                <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-secondary/50 text-foreground border border-border">
                  <MemoryStick className="w-3 h-3" /> {effectiveMemory >= 1024 ? `${effectiveMemory / 1024} GB` : `${effectiveMemory} MB`} RAM
                </span>
                <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-secondary/50 text-foreground border border-border">
                  <HardDrive className="w-3 h-3" /> {effectiveStorage} GB Storage
                </span>
                {isFree && (
                  <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-secondary/50 text-foreground border border-border">
                    <Gift className="w-3 h-3" /> Free for 7 days
                  </span>
                )}
              </div>
            </div>
          </div>
          )}

          {/* Hardware Configuration (collapsible) */}
          <div className="text-left">
            <button
              onClick={() => setShowHardware(!showHardware)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span className="font-medium">Hardware Configuration</span>
              {isFree ? (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-secondary text-muted-foreground">
                  Free Tier
                </span>
              ) : isCustomized ? (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-secondary text-muted-foreground">
                  Custom
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-secondary text-muted-foreground">
                  Recommended
                </span>
              )}
              <ChevronRight
                className={`w-4 h-4 ml-auto transition-transform ${
                  showHardware ? "rotate-90" : ""
                }`}
              />
            </button>

            {showHardware && (
              <div className="mt-4 space-y-5 p-5 rounded-lg border border-border bg-secondary/30">
                {/* Free tier notice */}
                {isFree && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50 border border-border">
                    <Gift className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground">
                      Free tier deployments use starter hardware specs ({CPU_OPTIONS[0]?.label} vCPU, 2 GB RAM, {STORAGE_OPTIONS[0]?.label} storage).
                      Upgrade to a paid plan for customizable resources.
                    </p>
                  </div>
                )}

                {/* Recommended button */}
                {!isFree && (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Defaults from <strong>{runtime?.name ?? "runtime"}</strong> catalog.
                    Adjust if you need more (or less) resources.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleResetToRecommended}
                    disabled={!isCustomized}
                    className="border-border hover:bg-secondary hover:border-primary/50 hover:text-primary text-xs shrink-0"
                  >
                    <RotateCcw className="w-3 h-3 mr-1.5" />
                    Recommended
                  </Button>
                </div>
                )}

                {/* CPU selector */}
                <div className={`space-y-2 ${isFree ? "opacity-50 pointer-events-none" : ""}`}>
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5 text-sm">
                      <Cpu className="w-4 h-4 text-muted-foreground" /> vCPU
                    </Label>
                    <span className="text-sm font-mono font-medium text-foreground">
                      {effectiveCpu}
                      {!isFree && cpuLimit === null && (
                        <span className="text-[10px] text-primary ml-1.5">(recommended)</span>
                      )}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {CPU_OPTIONS.map((opt) => {
                      const val = opt.value as string;
                      const isRec = val === (runtime?.cpuLimit ?? "2.0");
                      return (
                        <button
                          key={val}
                          onClick={() => setCpuLimit(isRec ? null : val)}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all border ${
                            effectiveCpu === val
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-secondary/50 text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          {opt.label}
                          {isRec && (
                            <span className="block text-[9px] text-primary mt-0.5">rec</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Memory selector */}
                <div className={`space-y-2 ${isFree ? "opacity-50 pointer-events-none" : ""}`}>
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5 text-sm">
                      <MemoryStick className="w-4 h-4 text-muted-foreground" /> RAM
                    </Label>
                    <span className="text-sm font-mono font-medium text-foreground">
                      {effectiveMemory >= 1024 ? `${effectiveMemory / 1024} GB` : `${effectiveMemory} MB`}
                      {!isFree && memoryMb === null && (
                        <span className="text-[10px] text-primary ml-1.5">(recommended)</span>
                      )}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {MEMORY_OPTIONS.map((opt) => {
                      const val = opt.value as number;
                      const isRec = val === (runtime?.memoryMb ?? 2048);
                      return (
                        <button
                          key={val}
                          onClick={() => setMemoryMb(isRec ? null : val)}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all border ${
                            effectiveMemory === val
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-secondary/50 text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          {opt.label}
                          {isRec && (
                            <span className="block text-[9px] text-primary mt-0.5">rec</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Storage selector */}
                <div className={`space-y-2 ${isFree ? "opacity-50 pointer-events-none" : ""}`}>
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5 text-sm">
                      <HardDrive className="w-4 h-4 text-muted-foreground" /> Storage
                    </Label>
                    <span className="text-sm font-mono font-medium text-foreground">
                      {effectiveStorage} GB
                      {!isFree && storageMb === null && (
                        <span className="text-[10px] text-primary ml-1.5">(recommended)</span>
                      )}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {STORAGE_OPTIONS.map((opt) => {
                      const val = opt.value as number;
                      const isRec = val === (runtime?.storageMb ?? 30);
                      return (
                        <button
                          key={val}
                          onClick={() => setStorageMb(isRec ? null : val)}
                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all border ${
                            effectiveStorage === val
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-secondary/50 text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          {opt.label}
                          {isRec && (
                            <span className="block text-[9px] text-primary mt-0.5">rec</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Info hint */}
                {!isFree && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50 border border-border">
                  <HelpCircle className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    Not sure? Click <strong>Recommended</strong> to use the
                    optimal settings for {runtime?.name ?? "this runtime"}.
                    You can always adjust these later from the dashboard.
                  </p>
                </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Rocket className="w-4 h-4 text-primary" />
            <p className="text-sm">
              {needsPayment && !checkoutConfirmed
                ? "Complete payment to deploy your bot"
                : "Click \"Deploy\" to launch your bot!"}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
