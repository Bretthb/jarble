"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2,
  Loader2,
  Key,
  ShieldCheck,
  ExternalLink,
  AlertCircle,
  HelpCircle,
  Link2,
  Plus,
} from "lucide-react";
import type { KeyValidationStatus } from "../types";
import {
  LLM_PROVIDERS,
  MANAGED_KEY_PLANS,
  getProviderById,
  getModelsForProvider,
  type LLMProviderDef,
  type LLMModelDef,
} from "../wizardStepConfig";

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

// ─── Step: LLM Setup ─────────────────────────────────────────────────

interface StepLlmSetupProps {
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
}

export default function StepLlmSetup({
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
}: StepLlmSetupProps) {
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
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setLlmMode("included"))}
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
                - we handle everything.
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
                  {MANAGED_KEY_PLANS.map((plan) => {
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
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setLlmMode("byok"))}
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
                      const defaultModel = getModelsForProvider(provider.id).find((m) => m.isDefault) || getModelsForProvider(provider.id)[0];
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
              <strong>Tip:</strong> Just paste your API key - we&apos;ll
              auto-detect the provider from the key prefix. Or select a provider
              first, then enter your key.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
