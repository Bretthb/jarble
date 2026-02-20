"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Loader2,
  Bot,
  Send,
  Rocket,
  HelpCircle,
  Cpu,
  HardDrive,
  MemoryStick,
  Key,
  Gift,
  ShieldCheck,
  ExternalLink,
  AlertCircle,
  RotateCcw,
  SlidersHorizontal,
  MailWarning,
  MailCheck,
  Link2,
  Crown,
  Plus,
} from "lucide-react";
import QRCode from "react-qr-code";
import { DeploymentLoader } from "@/components/WizardLoader";
import ProfileDropdown from "@/components/ProfileDropdown";
import { motion, AnimatePresence } from "framer-motion";
import {
  getWizardSteps,
  detectProviderFromKey,
  LLM_PROVIDERS,
  LLM_MODELS,
  getProviderById,
  getModelsForProvider,
  getDefaultModelForProvider,
  DEFAULT_INCLUDED_MODEL,
  CREDIT_PLANS,
  DEFAULT_CREDIT_PLAN,
  CPU_OPTIONS,
  MEMORY_OPTIONS,
  STORAGE_OPTIONS,
  type WizardStepDef,
  type LLMProviderDef,
  type LLMModelDef,
  type CreditPlanDef,
} from "./onboarding/wizardStepConfig";

// ─── Types ───────────────────────────────────────────────────────────

type KeyValidationStatus = "idle" | "validating" | "valid" | "invalid";

interface RuntimeEntry {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  cpuLimit: string;
  memoryMb: number;
  storageMb: number;
  monthlyPriceCents: number;
}

// ─── Main Component ──────────────────────────────────────────────────

export default function OnboardingWizard() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth0();

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

  // When provider changes manually (BYOK), reset model to that provider's default
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
      if (telegramBotToken) {
        // Telegram token was included — stay on deploy step and poll for pairing
        setDeployPhase("pairing");
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

  const canProceed = (): boolean => {
    switch (currentStepId) {
      case "name":
        return deploymentName.trim().length >= 2;
      case "runtime":
        return selectedRuntimeId !== null;
      case "llm":
        if (llmMode === "included") return true;
        // BYOK requires a validated key
        return keyValidation === "valid";
      case "deploy":
        return true;
      case "telegram":
        return !!telegramBotUsername;
      default:
        return true;
    }
  };

  const hasDeployed = !!createdDeploymentId && !isDeploying && deployPhase !== "idle";

  const handleNext = async () => {
    if (currentStepId === "deploy" && !isDeploying && deployPhase === "idle") {
      if (!user?.email_verified) {
        toast.error("Please verify your email before deploying.");
        return;
      }
      setIsDeploying(true);
      if (id !== "new") {
        setCreatedDeploymentId(id);
        deployMutation.mutate(id);
      } else if (createdDeploymentId) {
        // Deployment already created but deploy failed — retry deploy only
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
          telegramBotToken: telegramBotToken || undefined,
        });
      }
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
                />
              )}
              {currentStepId === "telegram" && (
                <StepConnectTelegram
                  telegramBotToken={telegramBotToken}
                  setTelegramBotToken={setTelegramBotToken}
                  telegramBotUsername={telegramBotUsername}
                  setTelegramBotUsername={setTelegramBotUsername}
                />
              )}
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

// ─── Step: Name ──────────────────────────────────────────────────────

function StepName({
  name,
  setName,
}: {
  name: string;
  setName: (name: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Name Your Deployment</h2>
        <p className="text-muted-foreground">
          Give your AI deployment a name
        </p>
      </div>
      <div>
        <Label htmlFor="deploymentName" className="mb-2 block">
          Deployment Name
        </Label>
        <Input
          id="deploymentName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-secondary/50 border-border text-foreground text-lg py-6 rounded-lg"
          placeholder="My Deployment"
          autoFocus
        />
        <p className="text-xs text-muted-foreground mt-2">
          This is how your deployment will be identified. You can change it
          later.
        </p>
      </div>
      {name.trim().length >= 2 && (
        <div className="flex items-center gap-2 text-primary text-sm">
          <CheckCircle2 className="w-4 h-4" />
          Great name!
        </div>
      )}
    </div>
  );
}

// ─── Step: Choose Runtime ────────────────────────────────────────────

function StepChooseRuntime({
  runtimes,
  isLoading,
  selectedId,
  onSelect,
  isFreeAvailable,
}: {
  runtimes: RuntimeEntry[];
  isLoading: boolean;
  selectedId: number | null;
  onSelect: (id: number, slug: string) => void;
  isFreeAvailable: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Choose Runtime</h2>
        <p className="text-muted-foreground">
          Select a runtime for your deployment. The remaining setup steps will
          adapt to your choice.
        </p>
      </div>

      <div className="grid gap-4">
        {runtimes.map((runtime) => {
          const isSelected = selectedId === runtime.id;
          return (
            <button
              key={runtime.id}
              onClick={() => onSelect(runtime.id, runtime.slug)}
              className={`w-full text-left p-6 rounded-xl border-2 transition-all ${
                isSelected
                  ? "border-primary bg-primary/10 shadow-sm"
                  : "border-border hover:border-primary/50 bg-secondary/30 hover:bg-secondary/40"
              }`}
            >
              <div className="flex items-center gap-4">
                <div
                  className={`w-16 h-16 rounded-xl flex items-center justify-center ${
                    runtime.slug === "openclaw"
                      ? "bg-gradient-to-br from-purple-500 to-blue-500"
                      : "bg-gradient-to-br from-emerald-500 to-teal-500"
                  }`}
                >
                  <Bot className="w-8 h-8 text-white" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-lg">{runtime.name}</h3>
                    {isFreeAvailable && (
                      <span className="px-2 py-0.5 rounded-full bg-secondary text-muted-foreground text-xs font-medium">
                        Free for 7 days
                      </span>
                    )}
                    {!isFreeAvailable && runtime.monthlyPriceCents > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-xs font-medium">
                        ${(runtime.monthlyPriceCents / 100).toFixed(0)}/mo
                      </span>
                    )}
                    {!isFreeAvailable && runtime.monthlyPriceCents === 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-secondary text-muted-foreground text-xs font-medium">
                        Pricing TBD
                      </span>
                    )}
                    {isSelected && (
                      <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                        Selected
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {runtime.description}
                  </p>
                </div>
                {isSelected && (
                  <CheckCircle2 className="w-6 h-6 text-primary shrink-0" />
                )}
              </div>

              {/* Hardware specs */}
              <div className="mt-4 flex flex-wrap gap-3">
                <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-secondary/60 text-muted-foreground">
                  <Cpu className="w-3 h-3" /> {runtime.cpuLimit} vCPU
                </span>
                <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-secondary/60 text-muted-foreground">
                  <MemoryStick className="w-3 h-3" /> {runtime.memoryMb >= 1024 ? `${runtime.memoryMb / 1024} GB` : `${runtime.memoryMb} MB`} RAM
                </span>
                <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-secondary/60 text-muted-foreground">
                  <HardDrive className="w-3 h-3" /> {runtime.storageMb} GB
                  Storage
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-start gap-3 p-4 rounded-lg bg-secondary/50 border border-border">
        <HelpCircle className="w-5 h-5 text-muted-foreground mt-0.5" />
        <p className="text-sm text-muted-foreground">
          More runtimes coming soon! After launch, you&apos;ll be able to choose
          from additional runtimes with different capabilities and hardware
          configurations.
        </p>
      </div>
    </div>
  );
}

// ─── Model Selector (shared by Included & BYOK) ─────────────────────

function ModelSelector({
  models,
  selectedModel,
  onSelectModel,
}: {
  models: LLMModelDef[];
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
}) {
  return (
    <div>
      <Label className="mb-3 block text-sm font-medium">Choose Model</Label>
      <div className="grid gap-2">
        {models.map((model) => {
          const isActive = selectedModel === model.id;
          return (
            <button
              key={model.id}
              onClick={() => onSelectModel(model.id)}
              className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
                isActive
                  ? "border-primary bg-primary/10"
                  : "border-border bg-secondary/30 hover:border-primary/50 hover:bg-secondary/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{model.name}</span>
                    {model.isDefault && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-secondary text-muted-foreground">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {model.description}
                  </p>
                </div>
                {isActive && (
                  <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step: LLM Setup (Enhanced) ─────────────────────────────────────

function StepLlmSetup({
  llmMode,
  setLlmMode,
  llmProvider,
  setLlmProvider,
  llmModel,
  setLlmModel,
  llmApiKey,
  setLlmApiKey,
  creditLimitDollars,
  setCreditLimitDollars,
  linkToDeploymentId,
  setLinkToDeploymentId,
  linkableDeployments,
  keyValidation,
  onValidateKey,
  isValidating,
}: {
  llmMode: "included" | "byok";
  setLlmMode: (mode: "included" | "byok") => void;
  llmProvider: LLMProviderDef["id"];
  setLlmProvider: (provider: LLMProviderDef["id"]) => void;
  llmModel: string;
  setLlmModel: (model: string) => void;
  llmApiKey: string;
  setLlmApiKey: (key: string) => void;
  creditLimitDollars: number;
  setCreditLimitDollars: (limit: number) => void;
  linkToDeploymentId: string | null;
  setLinkToDeploymentId: (id: string | null) => void;
  linkableDeployments: { id: string; name: string; runtime: string; llmCreditLimitDollars: number | null }[];
  keyValidation: KeyValidationStatus;
  onValidateKey: () => void;
  isValidating: boolean;
}) {
  const activeProvider = getProviderById(llmProvider);
  const availableModels = getModelsForProvider(
    llmMode === "included" ? "openrouter" : llmProvider
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">LLM Setup</h2>
        <p className="text-muted-foreground">
          Choose how your deployment accesses AI models
        </p>
      </div>

      <div className="grid gap-4">
        {/* Included Credits Option */}
        <div
          onClick={() => setLlmMode("included")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && setLlmMode("included")}
          className={`w-full text-left p-6 rounded-xl border-2 transition-all cursor-pointer ${
            llmMode === "included"
              ? "border-primary bg-primary/10 shadow-sm"
              : "border-border hover:border-primary/50 bg-secondary/30 hover:bg-secondary/40"
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-lg">Included Credits</h3>
                <span className="px-2 py-0.5 rounded-full bg-secondary text-muted-foreground text-xs font-medium">
                  Auto-Provisioned
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Use Jarble-managed LLM credits via OpenRouter. No API key needed
                — we handle everything.
              </p>
            </div>
            {llmMode === "included" && (
              <CheckCircle2 className="w-6 h-6 text-primary shrink-0" />
            )}
          </div>
          {llmMode === "included" && (
            <div className="mt-4 space-y-4">
              <div className="p-4 rounded-lg bg-secondary/50 border border-border">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                  <p className="text-sm text-muted-foreground">
                    {linkToDeploymentId
                      ? "This deployment will share an existing credit pool."
                      : "An OpenRouter API key will be automatically provisioned when you deploy. Choose a monthly credit plan below."}
                  </p>
                </div>
              </div>

              {/* Credit Pool Selector (only shown if linkable deployments exist) */}
              {linkableDeployments.length > 0 && (
                <div>
                  <Label className="mb-3 block text-sm font-medium">
                    Credit Pool
                  </Label>
                  <div className="grid gap-2">
                    {/* Create New Pool option */}
                    <button
                      onClick={() => setLinkToDeploymentId(null)}
                      className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
                        linkToDeploymentId === null
                          ? "border-primary bg-primary/10"
                          : "border-border bg-secondary/30 hover:border-primary/50 hover:bg-secondary/50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Plus className="w-4 h-4 text-primary" />
                          <span className="font-medium text-sm">Create New Pool</span>
                        </div>
                        {linkToDeploymentId === null && (
                          <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 ml-6">
                        Provision a new OpenRouter API key with its own spending cap
                      </p>
                    </button>

                    {/* Existing pools */}
                    {linkableDeployments.map((dep) => (
                      <button
                        key={dep.id}
                        onClick={() => setLinkToDeploymentId(dep.id)}
                        className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
                          linkToDeploymentId === dep.id
                            ? "border-primary bg-primary/10"
                            : "border-border bg-secondary/30 hover:border-primary/50 hover:bg-secondary/50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Link2 className="w-4 h-4 text-muted-foreground" />
                            <span className="font-medium text-sm">{dep.name}</span>
                            {dep.llmCreditLimitDollars && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-secondary text-muted-foreground">
                                ${dep.llmCreditLimitDollars}/mo
                              </span>
                            )}
                          </div>
                          {linkToDeploymentId === dep.id && (
                            <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 ml-6">
                          Share the credit pool from this deployment
                        </p>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Linked deployments share the same OpenRouter API key and monthly spending cap.
                  </p>
                </div>
              )}

              {/* Credit Plan Selector (only shown when creating new pool) */}
              {linkToDeploymentId === null && (
              <div>
                <Label className="mb-3 block text-sm font-medium">
                  Monthly Credit Plan
                </Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {CREDIT_PLANS.map((plan) => {
                    const isActive = creditLimitDollars === plan.value;
                    return (
                      <button
                        key={plan.value}
                        onClick={() => setCreditLimitDollars(plan.value)}
                        className={`relative p-3 rounded-lg border-2 text-left transition-all ${
                          isActive
                            ? "border-primary bg-primary/10 shadow-sm"
                            : "border-border bg-secondary/30 hover:border-primary/50 hover:bg-secondary/40"
                        }`}
                      >
                        <div className="font-semibold text-base">{plan.label}</div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">
                          {plan.description}
                        </p>
                        {plan.isDefault && (
                          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-secondary text-muted-foreground">
                            Default
                          </span>
                        )}
                        {isActive && (
                          <CheckCircle2 className="absolute top-1.5 right-1.5 w-4 h-4 text-primary" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              )}

              {/* Model selector for included credits */}
              <ModelSelector
                models={availableModels}
                selectedModel={llmModel}
                onSelectModel={setLlmModel}
              />
            </div>
          )}
        </div>

        {/* BYOK Option */}
        <div
          onClick={() => setLlmMode("byok")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && setLlmMode("byok")}
          className={`w-full text-left p-6 rounded-xl border-2 transition-all cursor-pointer ${
            llmMode === "byok"
              ? "border-primary bg-primary/10 shadow-sm"
              : "border-border hover:border-primary/50 bg-secondary/30 hover:bg-secondary/40"
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
              <Key className="w-7 h-7 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-lg">
                  Bring Your Own Key (BYOK)
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-secondary text-muted-foreground text-xs font-medium">
                  Recommended
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Use your own API key from any supported provider. Full control
                over model selection and costs.
              </p>
            </div>
            {llmMode === "byok" && (
              <CheckCircle2 className="w-6 h-6 text-primary shrink-0" />
            )}
          </div>
        </div>
      </div>

      {/* BYOK: Provider Selection + Key Input */}
      {llmMode === "byok" && (
        <div className="space-y-6">
          {/* Provider Grid */}
          <div>
            <Label className="mb-3 block text-sm font-medium">
              Choose Provider
            </Label>
            <div className="grid grid-cols-2 gap-3">
              {LLM_PROVIDERS.map((provider) => {
                const isActive = llmProvider === provider.id;
                return (
                  <button
                    key={provider.id}
                    onClick={() => {
                      setLlmProvider(provider.id);
                      // Set default model for the new provider
                      const defaultModel = getDefaultModelForProvider(provider.id);
                      if (defaultModel) setLlmModel(defaultModel.id);
                      // Clear key if switching provider manually
                      if (llmApiKey.trim() && !llmApiKey.startsWith(provider.keyPrefix)) {
                        setLlmApiKey("");
                      }
                    }}
                    className={`p-4 rounded-lg border-2 text-left transition-all ${
                      isActive
                        ? "border-primary bg-primary/10 shadow-sm"
                        : "border-border bg-secondary/30 hover:border-primary/50 hover:bg-secondary/40 hover:shadow-sm"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold text-sm">
                        {provider.name}
                      </h4>
                      {provider.recommended && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-secondary text-muted-foreground">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {provider.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* API Key Input */}
          <div className="space-y-3">
            <Label htmlFor="llmApiKey" className="block text-sm font-medium">
              {activeProvider?.name ?? "Provider"} API Key
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="llmApiKey"
                  type="password"
                  value={llmApiKey}
                  onChange={(e) => setLlmApiKey(e.target.value)}
                  className={`bg-secondary/50 border-border text-foreground pr-10 ${
                    keyValidation === "valid"
                      ? "border-green-500 focus:ring-green-500"
                      : keyValidation === "invalid"
                      ? "border-red-500 focus:ring-red-500"
                      : ""
                  }`}
                  placeholder={activeProvider?.keyPlaceholder ?? "sk-..."}
                />
                {/* Validation status icon */}
                {keyValidation === "valid" && (
                  <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400" />
                )}
                {keyValidation === "invalid" && (
                  <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-400" />
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={onValidateKey}
                disabled={!llmApiKey.trim() || isValidating}
                className="border-border hover:bg-secondary/80 shrink-0"
              >
                {isValidating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Validate"
                )}
              </Button>
            </div>

            {/* Status message */}
            {keyValidation === "valid" && (
              <p className="text-xs text-green-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3" />
                Key validated! Connected to {activeProvider?.name}.
              </p>
            )}
            {keyValidation === "invalid" && (
              <p className="text-xs text-red-400 flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3" />
                Invalid key. Please check and try again.
              </p>
            )}
            {keyValidation === "idle" && llmApiKey.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Click &quot;Validate&quot; to verify your key before proceeding.
              </p>
            )}

            {/* Provider link */}
            <p className="text-xs text-muted-foreground">
              Get your API key from{" "}
              <a
                href={activeProvider?.keyUrl ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                {activeProvider?.name ?? "your provider"}
                <ExternalLink className="w-3 h-3" />
              </a>
              . Your key is encrypted and never shared.
            </p>
          </div>

          {/* Model selector for BYOK */}
          <ModelSelector
            models={availableModels}
            selectedModel={llmModel}
            onSelectModel={setLlmModel}
          />

          {/* Auto-detection hint */}
          <div className="flex items-start gap-3 p-4 rounded-lg bg-secondary/50 border border-border">
            <HelpCircle className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              <strong>Tip:</strong> Just paste your API key — we&apos;ll
              auto-detect the provider from the key prefix. Or select a provider
              first, then enter your key.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step: Deploy ────────────────────────────────────────────────────

function StepDeploy({
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
}: {
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
}) {
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
              Click &quot;Deploy&quot; to launch your bot!
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Step: Connect Telegram (Pre-Deploy — Token Validation Only) ─────

function StepConnectTelegram({
  telegramBotToken,
  setTelegramBotToken,
  telegramBotUsername,
  setTelegramBotUsername,
}: {
  telegramBotToken: string | null;
  setTelegramBotToken: (token: string | null) => void;
  telegramBotUsername: string | null;
  setTelegramBotUsername: (username: string | null) => void;
}) {
  const [tokenInput, setTokenInput] = useState(telegramBotToken ?? "");
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleValidate = async () => {
    const token = tokenInput.trim();
    if (!token) return;

    setIsValidating(true);
    setValidationError(null);

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = await res.json();

      if (!data.ok) {
        setValidationError("Invalid bot token. Please check and try again.");
        setIsValidating(false);
        return;
      }

      const username = data.result.username as string;
      setTelegramBotToken(token);
      setTelegramBotUsername(username);
      toast.success(`Bot @${username} validated!`);
    } catch {
      setValidationError("Failed to validate token. Check your connection and try again.");
    } finally {
      setIsValidating(false);
    }
  };

  const handleClear = () => {
    setTokenInput("");
    setTelegramBotToken(null);
    setTelegramBotUsername(null);
    setValidationError(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Connect Telegram</h2>
        <p className="text-muted-foreground">
          Create a Telegram bot and enter its token. We&apos;ll include it when deploying so your bot starts with Telegram enabled.
        </p>
      </div>

      {telegramBotUsername ? (
        /* Token validated — show success */
        <div className="bg-secondary/50 border border-border rounded-lg p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-primary">@{telegramBotUsername}</h3>
            <p className="text-muted-foreground text-sm mt-1">Bot token validated. It will be included when you deploy.</p>
          </div>
          <button
            onClick={handleClear}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Use a different token
          </button>
        </div>
      ) : (
        <>
          {/* Step 1: Create bot with BotFather */}
          <div className="bg-secondary/50 rounded-lg p-6 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Send className="w-5 h-5 text-primary" />
              Create Your Telegram Bot
            </h3>
            <ol className="text-sm text-muted-foreground space-y-3 list-decimal list-inside">
              <li>
                Open{" "}
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  @BotFather
                  <ExternalLink className="w-3 h-3" />
                </a>{" "}
                in Telegram
              </li>
              <li>
                Send <strong>/newbot</strong> and follow the prompts to pick a name
              </li>
              <li>
                Copy the <strong>API token</strong> BotFather gives you
              </li>
            </ol>
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block"
            >
              <Button type="button" variant="outline" className="border-border hover:bg-secondary/80">
                <ExternalLink className="w-4 h-4 mr-2" />
                Open BotFather
              </Button>
            </a>
          </div>

          {/* Step 2: Paste token + validate */}
          <div className="space-y-3">
            <Label htmlFor="telegramToken" className="block text-sm font-medium">
              Bot Token
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="telegramToken"
                  type="password"
                  value={tokenInput}
                  onChange={(e) => {
                    setTokenInput(e.target.value);
                    setValidationError(null);
                  }}
                  className={`bg-secondary/50 border-border text-foreground pr-10 ${
                    validationError ? "border-red-500 focus:ring-red-500" : ""
                  }`}
                  placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                />
                {validationError && (
                  <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-400" />
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleValidate}
                disabled={!tokenInput.trim() || isValidating}
                className="border-border hover:bg-secondary/80 shrink-0"
              >
                {isValidating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Validate"
                )}
              </Button>
            </div>

            {validationError && (
              <p className="text-xs text-red-400 flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3" />
                {validationError}
              </p>
            )}
            {!validationError && tokenInput.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Click &quot;Validate&quot; to verify your bot token before deploying.
              </p>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-secondary/50 border border-border">
              <HelpCircle className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-foreground font-medium">
                  Why Telegram?
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Telegram bots are instant to set up — just create one with
                  BotFather, paste the token, and you&apos;re chatting. No phone
                  number or QR scan required.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 rounded-lg bg-secondary/50 border border-border">
              <ShieldCheck className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-foreground font-medium">
                  Your token is encrypted
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Your bot token is AES-256 encrypted at rest and never exposed
                  in the dashboard.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
