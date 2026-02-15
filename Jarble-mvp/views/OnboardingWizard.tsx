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
  MessageCircle,
  Rocket,
  PartyPopper,
  HelpCircle,
  LogOut,
  Smartphone,
  RefreshCw,
  Cpu,
  HardDrive,
  MemoryStick,
  Key,
  Sparkles,
  Gift,
  ShieldCheck,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import { DeploymentLoader } from "@/components/WizardLoader";
import {
  getWizardSteps,
  detectProviderFromKey,
  LLM_PROVIDERS,
  getProviderById,
  type WizardStepDef,
  type LLMProviderDef,
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
  const { isAuthenticated, isLoading: authLoading, logout } = useAuth0();

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
  const [llmApiKey, setLlmApiKey] = useState("");
  const [keyValidation, setKeyValidation] = useState<KeyValidationStatus>("idle");
  const [whatsappConnected, setWhatsappConnected] = useState(false);

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
      }
    }
    // Reset validation when key changes
    setKeyValidation("idle");
  }, [llmApiKey, llmMode]);

  // Fetch runtimes from API
  const runtimesQuery = trpc.runtimeCatalog.list.useQuery();

  // Check free deployment status
  const canDeployQuery = trpc.deployment.canDeploy.useQuery(undefined, {
    enabled: isAuthenticated && !authLoading,
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
      // Move to next step after deploy (WhatsApp or finish)
      const deployStepIdx = steps.findIndex((s) => s.id === "deploy");
      if (deployStepIdx < steps.length - 1) {
        setCurrentStepIndex(deployStepIdx + 1);
      } else {
        toast.success("Setup complete! Your deployment is ready.");
        router.push("/dashboard");
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
      case "whatsapp":
        return whatsappConnected;
      default:
        return true;
    }
  };

  const handleNext = async () => {
    if (currentStepId === "deploy" && !isDeploying) {
      setIsDeploying(true);
      if (id !== "new") {
        deployMutation.mutate(id);
      } else {
        createMutation.mutate({
          name: deploymentName,
          runtimeCatalogId: selectedRuntimeId!,
          llmMode,
          llmProvider: llmMode === "byok" ? llmProvider : "openrouter",
          llmApiKey: llmMode === "byok" ? llmApiKey : undefined,
        });
      }
    } else if (currentStepId === "whatsapp") {
      toast.success("Setup complete! Your deployment is ready.");
      router.push("/dashboard");
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
    <div className="min-h-screen bg-background text-foreground py-8">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="mb-12 flex items-center gap-4">
          <img
            src="https://azeubylyzvcqot5l.public.blob.vercel-storage.com/logos/jarblelogo.png"
            alt="Jarble Logo"
            className="w-16 h-16 object-contain rounded-lg"
          />
          <div className="flex-1">
            <h1 className="text-4xl font-bold mb-2">Create Your Deployment</h1>
            <p className="text-muted-foreground">
              Step {currentStepIndex + 1} of {steps.length}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              logout({ logoutParams: { returnTo: window.location.origin } })
            }
            className="border-border hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-500"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Log Out
          </Button>
        </div>

        {/* Free Trial Banner */}
        {isFreeAvailable && (
          <div className="mb-8 rounded-lg border border-green-500/30 bg-green-500/10 p-4 flex items-center gap-3">
            <Gift className="w-5 h-5 text-green-400 shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-400">
                Your first deployment is free for 7 days!
              </p>
              <p className="text-xs text-green-400/70 mt-0.5">
                No credit card required. Try any runtime at no cost.
              </p>
            </div>
          </div>
        )}

        {/* Dynamic Progress Bar */}
        <div className="mb-12">
          <div className="flex justify-between mb-4">
            {steps.map((step, idx) => {
              const StepIcon = step.icon;
              return (
                <button
                  key={step.id}
                  onClick={() =>
                    idx <= currentStepIndex && setCurrentStepIndex(idx)
                  }
                  disabled={idx > currentStepIndex}
                  className={`flex flex-col items-center gap-2 ${
                    idx <= currentStepIndex
                      ? "cursor-pointer"
                      : "cursor-not-allowed opacity-60"
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-all ${
                      idx < currentStepIndex
                        ? "bg-green-500/20 border border-green-500 text-green-400 hover:bg-green-500/30"
                        : idx === currentStepIndex
                        ? "bg-primary border border-primary text-primary-foreground"
                        : "bg-secondary/80 border border-border text-muted-foreground"
                    }`}
                  >
                    {idx < currentStepIndex ? (
                      "✓"
                    ) : (
                      <StepIcon className="w-5 h-5" />
                    )}
                  </div>
                  <span
                    className={`text-xs text-center hidden sm:block ${
                      idx === currentStepIndex
                        ? "text-primary"
                        : "text-muted-foreground"
                    }`}
                  >
                    {step.title}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="w-full bg-secondary/80 rounded-full h-1">
            <div
              className="bg-primary h-1 rounded-full transition-all duration-300"
              style={{
                width: `${((currentStepIndex + 1) / steps.length) * 100}%`,
              }}
            />
          </div>
        </div>

        {/* Step Content */}
        <Card className="bg-card border-border p-8 mb-8">
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
              llmApiKey={llmApiKey}
              setLlmApiKey={setLlmApiKey}
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
              isFree={!!isFreeAvailable}
            />
          )}
          {currentStepId === "whatsapp" && (
            <StepConnectWhatsApp
              connected={whatsappConnected}
              setConnected={setWhatsappConnected}
            />
          )}
        </Card>

        {/* Navigation */}
        <div className="flex justify-between gap-4">
          <Button
            variant="outline"
            onClick={handlePrevious}
            disabled={currentStepIndex === 0 || isDeploying}
            className="border-border hover:bg-secondary/80"
          >
            <ChevronLeft className="w-4 h-4 mr-2" />
            Previous
          </Button>
          <Button
            onClick={handleNext}
            disabled={!canProceed() || isDeploying}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
          >
            {currentStepId === "deploy" ? (
              isDeploying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deploying...
                </>
              ) : (
                <>
                  Deploy
                  <Rocket className="w-4 h-4 ml-2" />
                </>
              )
            ) : currentStepId === "whatsapp" ? (
              <>
                Finish Setup
                <PartyPopper className="w-4 h-4 ml-2" />
              </>
            ) : currentStepIndex === steps.length - 1 ? (
              <>
                Finish
                <PartyPopper className="w-4 h-4 ml-2" />
              </>
            ) : (
              <>
                Next
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
          className="bg-secondary/80 border-border text-foreground text-lg py-6"
          placeholder="My Deployment"
          autoFocus
        />
        <p className="text-xs text-muted-foreground mt-2">
          This is how your deployment will be identified. You can change it
          later.
        </p>
      </div>
      {name.trim().length >= 2 && (
        <div className="flex items-center gap-2 text-green-400 text-sm">
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
              className={`w-full text-left p-6 rounded-lg border-2 transition-all ${
                isSelected
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/50 bg-secondary/30 hover:bg-secondary/50"
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
                      <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 text-xs font-medium">
                        Free for 7 days
                      </span>
                    )}
                    {!isFreeAvailable && runtime.monthlyPriceCents > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-xs font-medium">
                        ${(runtime.monthlyPriceCents / 100).toFixed(0)}/mo
                      </span>
                    )}
                    {!isFreeAvailable && runtime.monthlyPriceCents === 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-medium">
                        Pricing TBD
                      </span>
                    )}
                    {isSelected && (
                      <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 text-xs font-medium">
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
                <span className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-secondary/80 text-muted-foreground">
                  <Cpu className="w-3 h-3" /> {runtime.cpuLimit} vCPU
                </span>
                <span className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-secondary/80 text-muted-foreground">
                  <MemoryStick className="w-3 h-3" /> {runtime.memoryMb} MB RAM
                </span>
                <span className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-secondary/80 text-muted-foreground">
                  <HardDrive className="w-3 h-3" /> {runtime.storageMb} MB
                  Storage
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
        <HelpCircle className="w-5 h-5 text-blue-400 mt-0.5" />
        <p className="text-sm text-blue-300">
          More runtimes coming soon! After launch, you&apos;ll be able to choose
          from additional runtimes with different capabilities and hardware
          configurations.
        </p>
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
  llmApiKey,
  setLlmApiKey,
  keyValidation,
  onValidateKey,
  isValidating,
}: {
  llmMode: "included" | "byok";
  setLlmMode: (mode: "included" | "byok") => void;
  llmProvider: LLMProviderDef["id"];
  setLlmProvider: (provider: LLMProviderDef["id"]) => void;
  llmApiKey: string;
  setLlmApiKey: (key: string) => void;
  keyValidation: KeyValidationStatus;
  onValidateKey: () => void;
  isValidating: boolean;
}) {
  const activeProvider = getProviderById(llmProvider);

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
        <button
          onClick={() => setLlmMode("included")}
          className={`w-full text-left p-6 rounded-lg border-2 transition-all ${
            llmMode === "included"
              ? "border-primary bg-primary/10"
              : "border-border hover:border-primary/50 bg-secondary/30 hover:bg-secondary/50"
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-lg">Included Credits</h3>
                <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 text-xs font-medium">
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
            <div className="mt-4 p-4 rounded-lg bg-green-500/10 border border-green-500/30">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-green-400" />
                <p className="text-sm text-green-300">
                  An OpenRouter API key will be automatically provisioned when
                  you deploy. Includes $5/month in LLM credits.
                </p>
              </div>
            </div>
          )}
        </button>

        {/* BYOK Option */}
        <button
          onClick={() => setLlmMode("byok")}
          className={`w-full text-left p-6 rounded-lg border-2 transition-all ${
            llmMode === "byok"
              ? "border-primary bg-primary/10"
              : "border-border hover:border-primary/50 bg-secondary/30 hover:bg-secondary/50"
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
                <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-xs font-medium">
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
        </button>
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
                      // Clear key if switching provider manually
                      if (llmApiKey.trim() && !llmApiKey.startsWith(provider.keyPrefix)) {
                        setLlmApiKey("");
                      }
                    }}
                    className={`p-4 rounded-lg border-2 text-left transition-all ${
                      isActive
                        ? "border-primary bg-primary/10"
                        : "border-border bg-secondary/30 hover:border-primary/50 hover:bg-secondary/50"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold text-sm">
                        {provider.name}
                      </h4>
                      {provider.recommended && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/20 text-blue-400">
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
                  className={`bg-secondary/80 border-border text-foreground pr-10 ${
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

          {/* Auto-detection hint */}
          <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
            <HelpCircle className="w-5 h-5 text-blue-400 mt-0.5 shrink-0" />
            <p className="text-sm text-blue-300">
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
  isFree,
}: {
  isDeploying: boolean;
  deployProgress: number;
  name: string;
  runtime?: RuntimeEntry;
  llmMode: "included" | "byok";
  llmProvider: string;
  isFree: boolean;
}) {
  const providerDef = getProviderById(llmProvider);

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
      ) : (
        <>
          <div>
            <h2 className="text-2xl font-bold mb-2">Deploy</h2>
            <p className="text-muted-foreground">
              Your deployment is configured and ready to launch!
            </p>
          </div>
          <div className="bg-secondary/50 rounded-lg p-12">
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
                <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/30">
                  <CheckCircle2 className="w-3 h-3" /> Named
                </span>
                <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/30">
                  <CheckCircle2 className="w-3 h-3" />{" "}
                  {runtime?.name || "Runtime"} selected
                </span>
                <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/30">
                  <CheckCircle2 className="w-3 h-3" /> LLM:{" "}
                  {llmMode === "byok"
                    ? `BYOK (${providerDef?.name ?? llmProvider})`
                    : "Included Credits"}
                </span>
                {isFree && (
                  <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/30">
                    <Gift className="w-3 h-3" /> Free for 7 days
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Rocket className="w-4 h-4 text-primary" />
            <p className="text-sm">
              Click &quot;Deploy&quot; to launch
              {runtime?.slug === "openclaw" ? ", then connect WhatsApp!" : "!"}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Step: Connect WhatsApp ──────────────────────────────────────────

function StepConnectWhatsApp({
  connected,
  setConnected,
}: {
  connected: boolean;
  setConnected: (connected: boolean) => void;
}) {
  const [qrExpired, setQrExpired] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Connect WhatsApp</h2>
        <p className="text-muted-foreground">
          Link your WhatsApp to chat with your deployment
        </p>
      </div>
      {connected ? (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-8 text-center">
          <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-10 h-10 text-green-400" />
          </div>
          <h3 className="text-xl font-semibold text-green-400 mb-2">
            WhatsApp Connected!
          </h3>
          <p className="text-muted-foreground text-sm">
            Your WhatsApp account is linked and ready to go
          </p>
        </div>
      ) : (
        <>
          <div className="bg-secondary/50 rounded-lg p-6">
            <div className="flex flex-col md:flex-row gap-6 items-center">
              <div className="relative">
                <div
                  className={`w-48 h-48 bg-white rounded-lg flex items-center justify-center ${
                    qrExpired ? "opacity-50" : ""
                  }`}
                >
                  <div className="p-4">
                    <div className="grid grid-cols-8 gap-0.5">
                      {Array.from({ length: 64 }).map((_, i) => (
                        <div
                          key={i}
                          className={`w-4 h-4 ${
                            Math.random() > 0.5 ? "bg-black" : "bg-white"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                {qrExpired && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setQrExpired(false);
                        setConnected(false);
                      }}
                      className="bg-white text-black hover:bg-gray-100"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Refresh QR
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-4">
                <h3 className="font-semibold flex items-center gap-2">
                  <Smartphone className="w-5 h-5 text-green-400" />
                  Scan with WhatsApp
                </h3>
                <ol className="text-sm text-muted-foreground space-y-3 list-decimal list-inside">
                  <li>Open WhatsApp on your phone</li>
                  <li>
                    Tap <strong>Menu</strong> or <strong>Settings</strong> and
                    select <strong>Linked Devices</strong>
                  </li>
                  <li>
                    Tap <strong>Link a Device</strong>
                  </li>
                  <li>Point your phone at this QR code to scan</li>
                </ol>
              </div>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
              <HelpCircle className="w-5 h-5 text-blue-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-blue-300 font-medium">
                  Why WhatsApp?
                </p>
                <p className="text-xs text-blue-400/80 mt-1">
                  WhatsApp lets you chat with your deployment from your phone
                  instantly. No app downloads needed!
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/30">
              <svg
                className="w-5 h-5 text-green-400 mt-0.5 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
              <div>
                <p className="text-sm text-green-300 font-medium">
                  Your privacy is protected
                </p>
                <p className="text-xs text-green-400/80 mt-1">
                  Messages are end-to-end encrypted. We never store your
                  personal chats.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
