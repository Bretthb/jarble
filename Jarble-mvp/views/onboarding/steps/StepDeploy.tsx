"use client";

import { useState, useMemo } from "react";
import type { Appearance } from "@stripe/stripe-js";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  Rocket,
  MailWarning,
  MailCheck,
  CreditCard,
  Tag,
  X,
} from "lucide-react";
import QRCode from "react-qr-code";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { StripePaymentForm } from "@/components/StripePaymentForm";
import { DeploymentLoader } from "@/components/WizardLoader";
import { formatPriceCents } from "@/lib/pricing";
import type { RuntimeEntry } from "../types";
import { LLM_MODELS, getProviderById } from "../wizardStepConfig";

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

/* ── Fixed beta pricing ──────────────────────────────────────────────── */

const BASE_PRICE_CENTS = 2500; // $25.00/mo without promo
const PROMO_PRICE_CENTS = 1799; // $17.99/mo with valid promo (cpx31 minimum)

interface StepDeployProps {
  isDeploying: boolean;
  deployProgress: number;
  name: string;
  runtime?: RuntimeEntry;
  llmMode: "included" | "byok";
  llmProvider: string;
  llmModel: string;
  creditLimitDollars: number;
  linkToDeploymentId: string | null;
  emailVerified: boolean;
  deployPhase: "idle" | "deploying" | "pairing" | "paired";
  telegramBotUsername: string | null;
  // Promo code
  promoCode: string;
  setPromoCode: (code: string) => void;
  promoValid: boolean | null;
  setPromoValid: (valid: boolean | null) => void;
  // Stripe inline payment (Elements)
  checkoutConfirmed: boolean;
  stripeClientSecret: string | null;
  isLoadingCheckout: boolean;
  onInitCheckout: () => void;
  onCheckoutComplete: () => void;
}

export default function StepDeploy({
  isDeploying,
  deployProgress,
  name,
  runtime,
  llmMode,
  llmProvider,
  llmModel,
  creditLimitDollars,
  linkToDeploymentId,
  emailVerified,
  deployPhase,
  telegramBotUsername,
  promoCode,
  setPromoCode,
  promoValid,
  setPromoValid,
  checkoutConfirmed,
  stripeClientSecret,
  isLoadingCheckout,
  onInitCheckout,
  onCheckoutComplete,
}: StepDeployProps) {
  const providerDef = getProviderById(llmProvider);
  const modelDef = LLM_MODELS.find((m) => m.id === llmModel);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [isValidatingPromo, setIsValidatingPromo] = useState(false);

  const resendVerificationMutation = trpc.user.resendVerificationEmail.useMutation({
    onSuccess: () => {
      toast.success("Verification email sent! Check your inbox.");
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Failed to send verification email");
    },
    onSettled: () => setIsResendingVerification(false),
  });

  // Build Stripe Elements appearance to match app theme (light/dark)
  const stripeAppearance = useMemo<Appearance>(() => {
    const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
    return {
      theme: isDark ? "night" : "stripe",
      variables: {
        colorPrimary: "#c85a5a",
        colorBackground: isDark ? "#1a1a1a" : "#ffffff",
        colorText: isDark ? "#e8e6e2" : "#1a1a1a",
        colorTextSecondary: isDark ? "#8a8a8a" : "#887a7a",
        colorDanger: "#c45050",
        fontFamily: "'Inter', sans-serif",
        borderRadius: "0.5rem",
        colorTextPlaceholder: isDark ? "#5a5a5a" : "#b0a2a2",
      },
      rules: {
        ".Input": {
          border: `1px solid ${isDark ? "rgba(200, 90, 90, 0.15)" : "#e2d6d6"}`,
          backgroundColor: isDark ? "#141414" : "#ffffff",
          boxShadow: "none",
        },
        ".Input:focus": {
          border: "1px solid #c85a5a",
          boxShadow: `0 0 0 1px ${isDark ? "rgba(200, 90, 90, 0.25)" : "#c85a5a"}`,
        },
        ".Label": {
          color: isDark ? "#8a8a8a" : "#887a7a",
          fontSize: "0.8125rem",
        },
        ".Tab": {
          border: `1px solid ${isDark ? "rgba(200, 90, 90, 0.08)" : "#eae1e1"}`,
          backgroundColor: isDark ? "#202020" : "#f3efef",
        },
        ".Tab--selected": {
          border: "1px solid #c85a5a",
          backgroundColor: isDark ? "#1a1a1a" : "#ffffff",
        },
      },
    };
  }, []);

  // Fixed pricing: $25 base, $13.99 with valid promo
  const computePriceCents = promoValid === true ? PROMO_PRICE_CENTS : BASE_PRICE_CENTS;
  const managedKeyCents = llmMode === "included" && !linkToDeploymentId ? creditLimitDollars * 100 : 0;
  const totalPriceCents = computePriceCents + managedKeyCents;

  const handleValidatePromo = async () => {
    const code = promoCode.trim();
    if (!code) return;
    setIsValidatingPromo(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/promo/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.valid) {
        setPromoValid(true);
        toast.success("Promo code applied!");
      } else {
        setPromoValid(false);
        toast.error(data.message || "Invalid promo code");
      }
    } catch {
      setPromoValid(false);
      toast.error("Failed to validate promo code");
    } finally {
      setIsValidatingPromo(false);
    }
  };

  const handleClearPromo = () => {
    setPromoCode("");
    setPromoValid(null);
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
        <div className="py-8">
          <div className="bg-secondary/50 border border-border rounded-lg p-8 text-center space-y-6">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10 text-primary" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-primary mb-1">Paired!</h3>
              <p className="text-muted-foreground text-sm">
                Your agent <strong>@{telegramBotUsername}</strong> is paired and ready to chat
              </p>
            </div>
            <div className="flex flex-col items-center gap-3">
              <div className="bg-card p-4 rounded-xl shadow-sm dark:shadow-none inline-block">
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
        <div className="py-8">
          <div className="bg-secondary/50 border border-border rounded-lg p-8 text-center space-y-6">
            <div className="flex flex-col items-center gap-3">
              <div className="bg-card p-4 rounded-xl shadow-sm dark:shadow-none inline-block">
                <QRCode value={`https://t.me/${telegramBotUsername}`} size={180} level="M" />
              </div>
              <p className="text-sm text-muted-foreground">
                Scan to open <strong>@{telegramBotUsername}</strong> in Telegram
              </p>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-medium">Send your agent any message to pair</p>
              <p className="text-xs text-muted-foreground">
                Your agent is starting up with Telegram enabled. Once ready, send it any
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
              <p className="text-sm font-medium text-green-500">Payment confirmed, ready to deploy!</p>
            </div>
          )}

          {/* Promo code section */}
          {!checkoutConfirmed && (
            <div className="rounded-xl border border-border bg-card p-5 text-left space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Tag className="w-4 h-4 text-muted-foreground" />
                Promo Code
              </div>
              {promoValid === true ? (
                <div className="flex items-center justify-between rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span className="text-sm font-medium text-green-500">
                      {promoCode} applied - {formatPriceCents(BASE_PRICE_CENTS - PROMO_PRICE_CENTS)}/mo saved!
                    </span>
                  </div>
                  <button onClick={handleClearPromo} className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter promo code"
                    value={promoCode}
                    onChange={(e) => {
                      setPromoCode(e.target.value.toUpperCase());
                      if (promoValid !== null) setPromoValid(null);
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleValidatePromo(); }}
                    className={promoValid === false ? "border-destructive" : ""}
                  />
                  <Button
                    variant="outline"
                    onClick={handleValidatePromo}
                    disabled={!promoCode.trim() || isValidatingPromo}
                  >
                    {isValidatingPromo ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Apply"
                    )}
                  </Button>
                </div>
              )}
              {promoValid === false && (
                <p className="text-xs text-destructive">Invalid or expired promo code</p>
              )}
            </div>
          )}

          {/* Pricing summary + Stripe payment */}
          {!checkoutConfirmed && !stripeClientSecret && (
            <div className="rounded-xl border border-border bg-card p-6 text-center space-y-4">
              <div>
                {promoValid === true && (
                  <p className="text-sm text-muted-foreground line-through mb-1">
                    {formatPriceCents(BASE_PRICE_CENTS + managedKeyCents)}/mo
                  </p>
                )}
                <p className="text-2xl font-bold">{formatPriceCents(totalPriceCents)}/mo</p>
                <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                  <p>Compute: {formatPriceCents(computePriceCents)}/mo{promoValid === true ? " (promo applied)" : ""}</p>
                  {managedKeyCents > 0 && (
                    <p>LLM Credits: {formatPriceCents(managedKeyCents)}/mo</p>
                  )}
                </div>
              </div>
              <Button
                onClick={onInitCheckout}
                disabled={isLoadingCheckout}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                {isLoadingCheckout ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Loading checkout...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Subscribe - {formatPriceCents(totalPriceCents)}/mo
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Stripe Elements payment form */}
          {!checkoutConfirmed && stripeClientSecret && stripePromise && (
            <div className="rounded-xl border border-border bg-card p-6 space-y-4">
              <div className="text-center">
                <p className="text-sm font-semibold">{formatPriceCents(totalPriceCents)}/mo</p>
                <div className="text-xs text-muted-foreground mt-1">
                  <span>Compute: {formatPriceCents(computePriceCents)}/mo</span>
                  {managedKeyCents > 0 && (
                    <span> + LLM Credits: {formatPriceCents(managedKeyCents)}/mo</span>
                  )}
                </div>
              </div>
              <Elements
                stripe={stripePromise}
                options={{ clientSecret: stripeClientSecret, appearance: stripeAppearance }}
              >
                <StripePaymentForm
                  onSuccess={onCheckoutComplete}
                  priceLabel={`${formatPriceCents(totalPriceCents)}/mo`}
                />
              </Elements>
            </div>
          )}

          {/* Ready-to-deploy summary */}
          {checkoutConfirmed && (
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
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Rocket className="w-4 h-4 text-primary" />
            <p className="text-sm">
              {!checkoutConfirmed
                ? "Complete payment to deploy your agent"
                : "Click \"Deploy\" to launch your agent!"}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
