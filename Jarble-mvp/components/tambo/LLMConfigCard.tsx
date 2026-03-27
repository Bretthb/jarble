"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { vanillaClient } from "@/lib/trpc-vanilla";
import {
  LLM_PROVIDERS,
  getModelsForProvider,
  getDefaultModelForProvider,
  getProviderById,
  detectProviderFromKey,
} from "@/views/onboarding/wizardStepConfig";

interface LLMConfigCardProps {
  deploymentId: string;
  currentProvider: string;
  currentModel: string;
  suggestedProvider?: string;
  suggestedModel?: string;
}

export default function LLMConfigCard({
  deploymentId,
  currentProvider,
  currentModel,
  suggestedProvider,
  suggestedModel,
}: LLMConfigCardProps) {
  const [provider, setProvider] = useState(suggestedProvider || currentProvider);
  const [model, setModel] = useState(suggestedModel || currentModel);
  const [apiKey, setApiKey] = useState("");
  const [keyStatus, setKeyStatus] = useState<
    "idle" | "validating" | "valid" | "invalid"
  >("idle");
  const [isSaving, setIsSaving] = useState(false);

  const providerDef = getProviderById(provider);
  const models = getModelsForProvider(provider);
  const isDirty = provider !== currentProvider || model !== currentModel || apiKey.length > 0;

  const handleProviderSelect = (id: string) => {
    setProvider(id);
    const defaultModel = getDefaultModelForProvider(id);
    if (defaultModel) setModel(defaultModel.id);
    setApiKey("");
    setKeyStatus("idle");
  };

  const handleKeyChange = (val: string) => {
    setApiKey(val);
    setKeyStatus("idle");
    if (val.length >= 3) {
      const detected = detectProviderFromKey(val);
      if (detected && detected !== provider) {
        handleProviderSelect(detected);
      }
    }
  };

  const handleValidate = async () => {
    if (!apiKey.trim()) return;
    setKeyStatus("validating");
    try {
      const result = await vanillaClient.openrouter.validateProviderKey.mutate({
        provider: provider as "openrouter" | "openai" | "anthropic" | "google",
        apiKey,
      });
      setKeyStatus(result.valid ? "valid" : "invalid");
    } catch {
      setKeyStatus("invalid");
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await vanillaClient.deployment.update.mutate({
        id: deploymentId,
        llmProvider: provider as "openrouter" | "openai" | "anthropic" | "google",
        llmModel: model,
        ...(apiKey.trim() ? { llmApiKey: apiKey } : {}),
      });
      toast.success("LLM config updated!");
    } catch {
      toast.error("Failed to update LLM config");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <h4 className="text-sm font-semibold">LLM Configuration</h4>

      {/* Provider grid */}
      <div>
        <Label className="mb-2 block text-xs text-muted-foreground">
          Provider
        </Label>
        <div className="grid grid-cols-2 gap-2">
          {LLM_PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => handleProviderSelect(p.id)}
              className={`p-3 rounded-lg border text-left transition-all ${
                provider === p.id
                  ? "border-primary bg-primary/10"
                  : "border-border bg-secondary/30 hover:border-primary/50"
              }`}
            >
              <span className="text-sm font-medium">{p.name}</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {p.description}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Model selector */}
      <div>
        <Label className="mb-2 block text-xs text-muted-foreground">
          Model
        </Label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} - {m.description}
            </option>
          ))}
        </select>
      </div>

      {/* API Key */}
      <div className="space-y-2">
        <Label className="block text-xs text-muted-foreground">
          API Key (leave blank to keep current)
        </Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => handleKeyChange(e.target.value)}
              placeholder={providerDef?.keyPlaceholder ?? "sk-..."}
              className={`bg-secondary/50 border-border pr-10 ${
                keyStatus === "valid"
                  ? "border-green-500"
                  : keyStatus === "invalid"
                  ? "border-red-500"
                  : ""
              }`}
            />
            {keyStatus === "valid" && (
              <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400" />
            )}
            {keyStatus === "invalid" && (
              <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-400" />
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleValidate}
            disabled={!apiKey.trim() || keyStatus === "validating"}
            className="border-border shrink-0 h-9"
          >
            {keyStatus === "validating" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              "Validate"
            )}
          </Button>
        </div>
        {providerDef?.keyUrl && (
          <p className="text-[11px] text-muted-foreground">
            Get your key from{" "}
            <a
              href={providerDef.keyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-0.5"
            >
              {providerDef.name}
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </p>
        )}
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!isDirty || isSaving || (apiKey.length > 0 && keyStatus !== "valid")}
          className="h-8"
        >
          {isSaving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
          Save Changes
        </Button>
      </div>
    </div>
  );
}
