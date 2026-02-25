"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import {
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Loader2,
  Rocket,
  Gift,
} from "lucide-react";
import ProfileDropdown from "@/components/ProfileDropdown";
import { motion, AnimatePresence } from "framer-motion";
import { calculateMonthlyPriceCents } from "@/lib/pricing";
import {
  getWizardSteps,
  detectProviderFromKey,
  getDefaultModelForProvider,
  DEFAULT_INCLUDED_MODEL,
  DEFAULT_CREDIT_PLAN,
  type LLMProviderDef,
} from "./onboarding/wizardStepConfig";
import type { KeyValidationStatus, RuntimeEntry } from "./onboarding/types";
import StepName from "./onboarding/steps/StepName";
import StepChooseRuntime from "./onboarding/steps/StepChooseRuntime";
import StepLlmSetup from "./onboarding/steps/StepLlmSetup";
import StepDeploy from "./onboarding/steps/StepDeploy";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// ─── Main Component ──────────────────────────────────────────────────

export default function OnboardingWizard() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading, getAccessTokenSilently } = useAuth0();

  // Step navigation
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployProgress, setDeployProgress] = useState(0);

  // Form state
  const [deploymentName, setDeploymentName] = useState("");
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<number | null>(null);
  const [selectedRuntimeSlug, setSelectedRuntimeSlug] = useState<string | null>(null);
  const [llmMode, setLlmMode] = useState<"included" | "byok">("byok");
  const [llmProvider, setLlmProvider] = useState<LLMProviderDef["id"]>("openrouter");
  const [llmModel, setLlmModel] = useState<string>(DEFAULT_INCLUDED_MODEL);
  const [llmApiKey, setLlmApiKey] = useState("");
  const [creditLimitDollars, setCreditLimitDollars] = useState<number>(DEFAULT_CREDIT_PLAN);
  const [linkToDeploymentId, setLinkToDeploymentId] = useState<string | null>(null);
  const [keyValidation, setKeyValidation] = useState<KeyValidationStatus>("idle");
  const [telegramBotToken, setTelegramBotToken] = useState<string | null>(null);
  const [telegramBotUsername, setTelegramBotUsername] = useState<string | null>(null);
  const [createdDeploymentId, setCreatedDeploymentId] = useState<string | null>(null);
  const [deployPhase, setDeployPhase] = useState<"idle" | "deploying" | "pairing" | "paired">("idle");

  // Stripe inline payment (Elements)
  const [checkoutComplete, setCheckoutComplete] = useState(false);
  const [stripeClientSecret, setStripeClientSecret] = useState<string | null>(null);
  const [isLoadingCheckout, setIsLoadingCheckout] = useState(false);

  // Telegram pairing poll mutation (used in deploy step after deploy succeeds)
  const pollTelegramMutation = trpc.platformCredentials.pollTelegramPairing.useMutation();

  // Poll for Telegram pairing after deploy succeeds with a telegram token
  useEffect(() => {
    if (deployPhase !== "pairing" || !createdDeploymentId) return;

    let active = true;
    let inFlight = false;

    const interval = setInterval(async () => {
      if (inFlight || !active) return;
      inFlight = true;
      try {
        const result = await pollTelegramMutation.mutateAsync({ deploymentId: createdDeploymentId });
        if (!active) return;
        if (result.status === "paired") {
          setDeployPhase("paired");
          toast.success("Telegram paired successfully!");
          setTimeout(() => router.replace("/dashboard"), 2500);
        }
      } catch {
        // Keep polling on transient errors
      } finally {
        inFlight = false;
      }
    }, 3000);

    // 8 minute timeout
    const timeout = setTimeout(() => {
      if (active) {
        active = false;
        clearInterval(interval);
        toast.error("Pairing timed out — you can pair from the dashboard later.");
        setTimeout(() => router.replace("/dashboard"), 2000);
      }
    }, 8 * 60 * 1000);

    return () => {
      active = false;
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [deployPhase, createdDeploymentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hardware config (optional overrides — null means "use runtime catalog defaults")
  const [cpuLimit, setCpuLimit] = useState<string | null>(null);
  const [memoryMb, setMemoryMb] = useState<number | null>(null);
  const [storageMb, setStorageMb] = useState<number | null>(null);

  // Derived steps
  const steps = getWizardSteps(selectedRuntimeSlug);
  const currentStep = steps[currentStepIndex];
  const currentStepId = currentStep?.id ?? "name";

  // Clamp step index when steps change (e.g. switching runtime)
  useEffect(() => {
    if (currentStepIndex >= steps.length) {
      setCurrentStepIndex(Math.max(0, steps.length - 1));
    }
  }, [steps.length, currentStepIndex]);

  // Detect ?checkout=success return from Stripe Checkout redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      setCheckoutComplete(true);
      // Jump to deploy step
      const deployIdx = steps.findIndex((s) => s.id === "deploy");
      if (deployIdx >= 0) setCurrentStepIndex(deployIdx);
      // Clean up URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-detect provider when key changes
  useEffect(() => {
    if (llmMode === "byok" && llmApiKey.length >= 3) {
      const detected = detectProviderFromKey(llmApiKey);
      if (detected) {
        setLlmProvider(detected);
        // Set default model for the detected provider
        const defaultModel = getDefaultModelForProvider(detected);
        if (defaultModel) setLlmModel(defaultModel.id);
      }
    }
    // Reset validation when key changes
    setKeyValidation("idle");
  }, [llmApiKey, llmMode]);

  // When switching to included mode, reset to the included default
  useEffect(() => {
    if (llmMode === "included") {
      setLlmModel(DEFAULT_INCLUDED_MODEL);
    }
  }, [llmMode]);

  // Fetch runtimes from API
  const runtimesQuery = trpc.runtimeCatalog.list.useQuery();

  // Check free deployment status
  const canDeployQuery = trpc.deployment.canDeploy.useQuery(undefined, {
    enabled: isAuthenticated && !authLoading,
  });

  // Fetch linkable deployments (existing credit pool owners)
  const linkableQuery = trpc.deployment.listLinkableDeployments.useQuery(undefined, {
    enabled: isAuthenticated && !authLoading && llmMode === "included",
  });

  // Key validation mutation
  const validateKeyMutation = trpc.openrouter.validateProviderKey.useMutation({
    onSuccess: (data) => {
      setKeyValidation(data.valid ? "valid" : "invalid");
      if (data.valid) {
        toast.success("API key validated successfully!");
      } else {
        toast.error("Invalid API key. Please check and try again.");
      }
    },
    onError: () => {
      setKeyValidation("invalid");
      toast.error("Failed to validate key. Please try again.");
    },
  });

  const deployMutation = trpc.deployment.deploy.useMutation({
    onSuccess: () => {
      toast.success("Deployed successfully!");
      setIsDeploying(false);
      // Redirect to Tambo chat page for the newly deployed bot
      const targetId = createdDeploymentId || id;
      if (targetId && targetId !== "new") {
        router.replace(`/d/${targetId}`);
      } else {
        router.replace("/dashboard");
      }
    },
    onError: (error: { message?: string }) => {
      toast.error(error.message || "Deployment failed");
      setIsDeploying(false);
    },
  });

  const createMutation = trpc.deployment.create.useMutation({
    onSuccess: (data: { id?: string } | null | undefined) => {
      if (data?.id) {
        setCreatedDeploymentId(data.id);
        deployMutation.mutate(data.id);
      }
    },
    onError: (error: { message?: string }) => {
      toast.error(error.message || "Failed to create deployment");
      setIsDeploying(false);
    },
  });

  const handleValidateKey = useCallback(() => {
    if (!llmApiKey.trim()) return;
    setKeyValidation("validating");
    validateKeyMutation.mutate({
      provider: llmProvider,
      apiKey: llmApiKey,
    });
  }, [llmApiKey, llmProvider, validateKeyMutation]);

  // Create an incomplete Stripe subscription and get clientSecret for PaymentElement
  const handleInitCheckout = useCallback(async () => {
    setIsLoadingCheckout(true);
    try {
      const token = await getAccessTokenSilently();
      const res = await fetch(`${API_URL}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          runtimeSlug: selectedRuntimeSlug,
          cpuLimit: cpuLimit || undefined,
          memoryMb: memoryMb || undefined,
          storageMb: storageMb || undefined,
          inline: true,
        }),
      });
      const data = await res.json();
      if (data.clientSecret) {
        setStripeClientSecret(data.clientSecret);
      } else {
        toast.error(data.error || "Failed to start checkout");
      }
    } catch {
      toast.error("Failed to reach payment service");
    } finally {
      setIsLoadingCheckout(false);
    }
  }, [getAccessTokenSilently, selectedRuntimeSlug, cpuLimit, memoryMb, storageMb]);

  // Reset payment form when hardware config changes (price changes)
  useEffect(() => {
    if (stripeClientSecret) {
      setStripeClientSecret(null);
    }
  }, [cpuLimit, memoryMb, storageMb]); // eslint-disable-line react-hooks/exhaustive-deps

  // Extract deploy logic so both handleNext and payment form can call it
  const triggerDeploy = useCallback(() => {
    if (!user?.email_verified) {
      toast.error("Please verify your email before deploying.");
      return;
    }
    setIsDeploying(true);
    if (id !== "new") {
      setCreatedDeploymentId(id);
      deployMutation.mutate(id);
    } else if (createdDeploymentId) {
      deployMutation.mutate(createdDeploymentId);
    } else {
      createMutation.mutate({
        name: deploymentName,
        runtimeCatalogId: selectedRuntimeId!,
        llmMode,
        llmProvider: llmMode === "byok" ? llmProvider : "openrouter",
        llmModel,
        llmApiKey: llmMode === "byok" ? llmApiKey : undefined,
        creditLimitDollars: llmMode === "included" && !linkToDeploymentId ? creditLimitDollars : undefined,
        linkToDeploymentId: llmMode === "included" && linkToDeploymentId ? linkToDeploymentId : undefined,
        cpuLimit: cpuLimit || undefined,
        memoryMb: memoryMb || undefined,
        storageMb: storageMb || undefined,
      });
    }
  }, [user, id, createdDeploymentId, deploymentName, selectedRuntimeId, llmMode, llmProvider, llmModel, llmApiKey, creditLimitDollars, linkToDeploymentId, cpuLimit, memoryMb, storageMb, deployMutation, createMutation]);

  const canProceed = (): boolean => {
    switch (currentStepId) {
      case "name":
        return deploymentName.trim().length >= 2;
      case "runtime":
        return selectedRuntimeId !== null;
      case "llm":
        if (llmMode === "included") return true;
        return keyValidation === "valid";
      case "deploy": {
        const deployRuntime = runtimesQuery.data?.find((r: RuntimeEntry) => r.id === selectedRuntimeId);
        const eCpu = cpuLimit ?? deployRuntime?.cpuLimit ?? "2.0";
        const eMem = memoryMb ?? deployRuntime?.memoryMb ?? 2048;
        const eSto = storageMb ?? deployRuntime?.storageMb ?? 30;
        const dynamicPrice = calculateMonthlyPriceCents(eCpu, eMem, eSto);
        const needsPayment = dynamicPrice > 0 && !checkoutComplete && !isFreeAvailable;
        return !needsPayment;
      }
      default:
        return true;
    }
  };

  const hasDeployed = !!createdDeploymentId && !isDeploying && deployPhase !== "idle";

  const handleNext = async () => {
    if (currentStepId === "deploy" && !isDeploying && deployPhase === "idle") {
      triggerDeploy();
    } else if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    }
  };

  const handleRuntimeSelect = (runtimeId: number, runtimeSlug: string) => {
    setSelectedRuntimeId(runtimeId);
    setSelectedRuntimeSlug(runtimeSlug);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-8 bg-card border-border">
          <p className="text-foreground mb-4">Please log in to continue</p>
          <Button onClick={() => router.push("/login")}>Sign In</Button>
        </Card>
      </div>
    );
  }

  const isFreeAvailable = canDeployQuery.data && !canDeployQuery.data.freeUsed;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Sticky top bar */}
      <header className="border-b border-border/60 bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="https://azeubylyzvcqot5l.public.blob.vercel-storage.com/logos/jarblelogo.png"
              alt="Jarble"
              className="w-8 h-8 object-contain rounded"
            />
            <span className="font-semibold text-sm">New Deployment</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">{currentStepIndex + 1}/{steps.length}</span>
            <ProfileDropdown />
          </div>
        </div>
        {/* Progress bar integrated into header */}
        <div className="w-full bg-secondary/40 h-1">
          <div
            className="bg-primary h-1 transition-all duration-500"
            style={{
              width: `${((currentStepIndex + 1) / steps.length) * 100}%`,
            }}
          />
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Free Trial Banner */}
        {isFreeAvailable && (
          <div className="mb-6 px-3 py-2.5 rounded-lg border border-border bg-secondary/50 flex items-center gap-2.5">
            <Gift className="w-4 h-4 text-primary shrink-0" />
            <p className="text-xs font-medium text-foreground">
              First deployment free for 7 days — no credit card required
            </p>
          </div>
        )}

        {/* Step navigation */}
        <nav className="flex items-center gap-1 mb-8">
          {steps.map((step, idx) => {
            const StepIcon = step.icon;
            const isCompleted = idx < currentStepIndex;
            const isCurrent = idx === currentStepIndex;
            return (
              <div key={step.id} className="flex items-center">
                <button
                  onClick={() => idx <= currentStepIndex && !hasDeployed && setCurrentStepIndex(idx)}
                  disabled={idx > currentStepIndex || hasDeployed}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : isCompleted
                      ? "bg-secondary text-foreground hover:bg-secondary/80 cursor-pointer"
                      : "text-muted-foreground/50 cursor-not-allowed"
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  ) : (
                    <StepIcon className="w-3.5 h-3.5" />
                  )}
                  <span className="hidden sm:inline">{step.title}</span>
                </button>
                {idx < steps.length - 1 && (
                  <div className={`w-6 h-px mx-1 ${isCompleted ? "bg-primary/40" : "bg-border"}`} />
                )}
              </div>
            );
          })}
        </nav>

        {/* Step Content */}
        <div className="mb-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStepId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              {currentStepId === "name" && (
                <StepName name={deploymentName} setName={setDeploymentName} />
              )}
              {currentStepId === "runtime" && (
                <StepChooseRuntime
                  runtimes={runtimesQuery.data ?? []}
                  isLoading={runtimesQuery.isLoading}
                  selectedId={selectedRuntimeId}
                  onSelect={handleRuntimeSelect}
                  isFreeAvailable={!!isFreeAvailable}
                />
              )}
              {currentStepId === "llm" && (
                <StepLlmSetup
                  llmMode={llmMode}
                  setLlmMode={setLlmMode}
                  llmProvider={llmProvider}
                  setLlmProvider={setLlmProvider}
                  llmModel={llmModel}
                  setLlmModel={setLlmModel}
                  llmApiKey={llmApiKey}
                  setLlmApiKey={setLlmApiKey}
                  creditLimitDollars={creditLimitDollars}
                  setCreditLimitDollars={setCreditLimitDollars}
                  linkToDeploymentId={linkToDeploymentId}
                  setLinkToDeploymentId={setLinkToDeploymentId}
                  linkableDeployments={linkableQuery.data ?? []}
                  keyValidation={keyValidation}
                  onValidateKey={handleValidateKey}
                  isValidating={validateKeyMutation.isPending}
                />
              )}
              {currentStepId === "deploy" && (
                <StepDeploy
                  isDeploying={isDeploying}
                  deployProgress={deployProgress}
                  name={deploymentName}
                  runtime={
                    runtimesQuery.data?.find(
                      (r: { id: number }) => r.id === selectedRuntimeId
                    )
                  }
                  llmMode={llmMode}
                  llmProvider={llmProvider}
                  llmModel={llmModel}
                  isFree={!!isFreeAvailable}
                  cpuLimit={cpuLimit}
                  setCpuLimit={setCpuLimit}
                  memoryMb={memoryMb}
                  setMemoryMb={setMemoryMb}
                  storageMb={storageMb}
                  setStorageMb={setStorageMb}
                  emailVerified={!!user?.email_verified}
                  deployPhase={deployPhase}
                  telegramBotUsername={telegramBotUsername}
                  checkoutConfirmed={checkoutComplete}
                  stripeClientSecret={stripeClientSecret}
                  isLoadingCheckout={isLoadingCheckout}
                  onInitCheckout={handleInitCheckout}
                  onCheckoutComplete={() => setCheckoutComplete(true)}
                />
              )}
              {/* Telegram step removed — platform connections happen via Tambo chat after deploy */}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex justify-between items-center gap-4 py-4 border-t border-border/50">
          <Button
            variant="ghost"
            onClick={handlePrevious}
            disabled={currentStepIndex === 0 || isDeploying || hasDeployed}
            className="text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <Button
            onClick={handleNext}
            disabled={!canProceed() || isDeploying || hasDeployed}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold min-w-[120px]"
          >
            {currentStepId === "deploy" ? (
              isDeploying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deploying...
                </>
              ) : deployPhase === "pairing" ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Pairing...
                </>
              ) : deployPhase === "paired" ? (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Paired!
                </>
              ) : (
                <>
                  Deploy
                  <Rocket className="w-4 h-4 ml-2" />
                </>
              )
            ) : (
              <>
                Continue
                <ChevronRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
