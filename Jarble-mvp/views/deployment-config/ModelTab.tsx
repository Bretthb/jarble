import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Key,
  Shield,
  ShieldCheck,
  ShieldX,
  Link2,
  RefreshCw,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
} from "lucide-react";
import type { ModelTabProps } from "./types";

const PROVIDERS = [
  { id: "jarble", name: "Jarble Managed", description: "We handle everything" },
  { id: "anthropic", name: "Anthropic", description: "Claude models" },
  { id: "openai", name: "OpenAI", description: "GPT models" },
  { id: "google", name: "Google", description: "Gemini models" },
];

const MODELS: Record<string, { id: string; name: string }[]> = {
  jarble: [{ id: "auto", name: "Auto (Recommended)" }],
  anthropic: [
    { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
    { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
    { id: "claude-haiku", name: "Claude Haiku" },
  ],
  openai: [
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
    { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
  ],
  google: [
    { id: "gemini-2.0-pro", name: "Gemini 2.0 Pro" },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
  ],
};

export function ModelTab({ formData, updateFormData, deployment, deploymentId }: ModelTabProps) {
  const dep = deployment as any;
  const llmMode = dep?.llmMode as string | undefined;
  const isLinked = !!dep?.llmApiKeySourceDeploymentId;
  const isIncluded = llmMode === "included" && !isLinked;
  const isByok = llmMode === "byok" || (!llmMode && formData.modelProvider !== "jarble");
  const hasKey = !!dep?.llmApiKey;

  const showProviderModel = !isLinked; // Linked deployments can't change provider/model

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Model Configuration</h2>
        <p className="text-muted-foreground text-sm">Choose and configure your AI model</p>
      </div>

      {/* Section 1: Provider & Model Selection */}
      {showProviderModel && (
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">Provider</Label>
            <div className="grid grid-cols-2 gap-3">
              {PROVIDERS.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => {
                    updateFormData("modelProvider", provider.id);
                    updateFormData("modelName", MODELS[provider.id]?.[0]?.id || "");
                  }}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    formData.modelProvider === provider.id
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border bg-secondary/50 hover:border-primary/30 hover:shadow-sm"
                  }`}
                >
                  <h3 className="font-semibold">{provider.name}</h3>
                  <p className="text-sm text-muted-foreground">{provider.description}</p>
                </button>
              ))}
            </div>
          </div>

          {formData.modelProvider && (
            <div>
              <Label htmlFor="modelName" className="mb-2 block">Model</Label>
              <select
                id="modelName"
                value={formData.modelName}
                onChange={(e) => updateFormData("modelName", e.target.value)}
                className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {MODELS[formData.modelProvider]?.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Section 2: Key Management (context-dependent) */}
      {deployment && (
        <div className="pt-2">
          {isLinked ? (
            <LinkedKeySection deploymentId={deploymentId} deployment={dep} />
          ) : isIncluded ? (
            <IncludedKeySection deploymentId={deploymentId} deployment={dep} />
          ) : isByok ? (
            <ByokKeySection
              formData={formData}
              updateFormData={updateFormData}
              deploymentId={deploymentId}
              deployment={dep}
              hasKey={hasKey}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

// ─── Included Credits Key Section ───────────────────────────────────────

function IncludedKeySection({ deploymentId, deployment }: { deploymentId: string; deployment: any }) {
  const [newLimit, setNewLimit] = useState<string>(String(deployment.llmCreditLimitDollars || 5));
  const [isRegenerating, setIsRegenerating] = useState(false);

  const usageQuery = trpc.openrouter.getKeyUsage.useQuery(
    { deploymentId },
    { staleTime: 30_000, refetchInterval: 60_000 }
  );

  const updateLimitMutation = trpc.openrouter.updateKeyLimit.useMutation({
    onSuccess: () => {
      toast.success("Credit limit updated");
      usageQuery.refetch();
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Failed to update credit limit");
    },
  });

  const revokeMutation = trpc.openrouter.revokeKey.useMutation({
    onSuccess: () => {
      toast.success("Key revoked — switched to BYOK mode");
      window.location.reload();
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Failed to revoke key");
    },
  });

  const provisionMutation = trpc.openrouter.provisionKey.useMutation({
    onSuccess: () => {
      toast.success("New key provisioned!");
      setIsRegenerating(false);
      usageQuery.refetch();
      window.location.reload();
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Failed to provision new key");
      setIsRegenerating(false);
    },
  });

  const usage = usageQuery.data;
  const keyHash = deployment.llmApiKeyId;
  const maskedKey = keyHash ? `...${keyHash.slice(-8)}` : "—";
  const isDisabled = usage?.disabled ?? false;

  const handleUpdateLimit = () => {
    const dollars = parseInt(newLimit, 10);
    if (isNaN(dollars) || dollars < 1 || dollars > 1000) {
      toast.error("Limit must be between $1 and $1,000");
      return;
    }
    updateLimitMutation.mutate({ deploymentId, limitDollars: dollars });
  };

  const handleRevoke = () => {
    if (confirm("Revoke this key? The deployment will switch to BYOK mode and you'll need to provide your own API key.")) {
      revokeMutation.mutate({ deploymentId });
    }
  };

  const handleRegenerate = () => {
    if (confirm("Regenerate key? The current key will be revoked and a new one provisioned. Usage counters will reset.")) {
      setIsRegenerating(true);
      revokeMutation.mutate({ deploymentId }, {
        onSuccess: () => {
          provisionMutation.mutate({
            deploymentId,
            limitDollars: parseInt(newLimit, 10) || 5,
          });
        },
        onError: () => setIsRegenerating(false),
      });
    }
  };

  return (
    <Card className="p-5 bg-card border-border space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Included Credits</h3>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            {isDisabled ? (
              <ShieldX className="w-3.5 h-3.5 text-red-500" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
            )}
            <span className={isDisabled ? "text-red-500 font-medium" : "text-green-500 font-medium"}>
              {isDisabled ? "Disabled" : "Active"}
            </span>
          </span>
          <span className="text-muted-foreground font-mono">{maskedKey}</span>
        </div>
      </div>

      {/* Usage meter */}
      {usageQuery.isLoading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-2 rounded-full bg-secondary" />
          <div className="flex justify-between">
            <div className="h-3 w-20 rounded bg-secondary" />
            <div className="h-3 w-20 rounded bg-secondary" />
          </div>
        </div>
      ) : usage ? (
        <>
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-muted-foreground">Credit Usage</span>
              <span className="font-mono font-medium">
                ${usage.usage.toFixed(2)}
                {usage.limit != null && ` / $${usage.limit.toFixed(2)}`}
              </span>
            </div>
            <Progress
              value={usage.limit ? Math.min((usage.usage / usage.limit) * 100, 100) : 0}
              className="h-2"
            />
          </div>

          {/* Breakdown */}
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-2 rounded-md bg-secondary/50">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Daily</p>
              <p className="text-sm font-mono font-medium">${usage.usageDaily.toFixed(2)}</p>
            </div>
            <div className="text-center p-2 rounded-md bg-secondary/50">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Weekly</p>
              <p className="text-sm font-mono font-medium">${usage.usageWeekly.toFixed(2)}</p>
            </div>
            <div className="text-center p-2 rounded-md bg-secondary/50">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Monthly</p>
              <p className="text-sm font-mono font-medium">${usage.usageMonthly.toFixed(2)}</p>
            </div>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">No usage data available</p>
      )}

      {/* Credit limit editor */}
      <div className="flex items-center gap-3 pt-1">
        <Label className="text-xs text-muted-foreground whitespace-nowrap">Monthly Limit</Label>
        <div className="flex items-center gap-2 flex-1">
          <span className="text-sm text-muted-foreground">$</span>
          <Input
            type="number"
            min={1}
            max={1000}
            value={newLimit}
            onChange={(e) => setNewLimit(e.target.value)}
            className="h-8 w-24 bg-secondary/50 border-border font-mono text-sm"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleUpdateLimit}
            disabled={updateLimitMutation.isPending}
            className="h-8 text-xs"
          >
            {updateLimitMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              "Update"
            )}
          </Button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-border/50">
        <Button
          size="sm"
          variant="outline"
          onClick={handleRegenerate}
          disabled={isRegenerating || revokeMutation.isPending}
          className="text-xs h-8"
        >
          {isRegenerating ? (
            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3 mr-1.5" />
          )}
          Regenerate Key
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRevoke}
          disabled={revokeMutation.isPending || isRegenerating}
          className="text-xs h-8 text-red-500 hover:text-red-600 hover:bg-red-500/5 border-red-500/20"
        >
          {revokeMutation.isPending && !isRegenerating ? (
            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
          ) : (
            <Trash2 className="w-3 h-3 mr-1.5" />
          )}
          Revoke Key
        </Button>
        <p className="text-[10px] text-muted-foreground ml-auto">
          Revoke switches to BYOK mode
        </p>
      </div>
    </Card>
  );
}

// ─── Linked Key Section ─────────────────────────────────────────────────

function LinkedKeySection({ deploymentId, deployment }: { deploymentId: string; deployment: any }) {
  const sourceId = deployment.llmApiKeySourceDeploymentId;

  const usageQuery = trpc.openrouter.getKeyUsage.useQuery(
    { deploymentId },
    { staleTime: 30_000, refetchInterval: 60_000 }
  );

  const usage = usageQuery.data;

  return (
    <Card className="p-5 bg-card border-border space-y-4">
      <div className="flex items-center gap-2">
        <Link2 className="w-4 h-4 text-violet-500" />
        <h3 className="text-sm font-semibold">Linked Credit Pool</h3>
      </div>

      <p className="text-xs text-muted-foreground">
        This deployment shares a credit pool with another deployment. Usage is tracked at the pool level.
      </p>

      {/* Shared usage meter */}
      {usageQuery.isLoading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-2 rounded-full bg-secondary" />
          <div className="flex justify-between">
            <div className="h-3 w-20 rounded bg-secondary" />
            <div className="h-3 w-20 rounded bg-secondary" />
          </div>
        </div>
      ) : usage ? (
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-muted-foreground">Pool Usage</span>
            <span className="font-mono font-medium">
              ${usage.usage.toFixed(2)}
              {usage.limit != null && ` / $${usage.limit.toFixed(2)}`}
            </span>
          </div>
          <Progress
            value={usage.limit ? Math.min((usage.usage / usage.limit) * 100, 100) : 0}
            className="h-2"
          />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No usage data available</p>
      )}

      <p className="text-xs text-muted-foreground">
        To manage credit limits or regenerate the key, visit the pool owner's configuration page.
      </p>

      {sourceId && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => window.location.href = `/d/${sourceId}/configure`}
          className="text-xs h-8"
        >
          <Key className="w-3 h-3 mr-1.5" />
          Go to Pool Owner
        </Button>
      )}
    </Card>
  );
}

// ─── BYOK Key Section ───────────────────────────────────────────────────

function ByokKeySection({
  formData,
  updateFormData,
  deploymentId,
  deployment,
  hasKey,
}: {
  formData: { apiKey: string; modelProvider: string };
  updateFormData: (key: string, value: string) => void;
  deploymentId: string;
  deployment: any;
  hasKey: boolean;
}) {
  const [validationStatus, setValidationStatus] = useState<"idle" | "validating" | "valid" | "invalid">("idle");

  const validateMutation = trpc.openrouter.validateProviderKey.useMutation({
    onSuccess: (data: { valid: boolean }) => {
      setValidationStatus(data.valid ? "valid" : "invalid");
      if (data.valid) {
        toast.success("API key is valid!");
      } else {
        toast.error("API key is invalid");
      }
    },
    onError: (err: { message?: string }) => {
      setValidationStatus("invalid");
      toast.error(err.message || "Failed to validate key");
    },
  });

  const handleValidate = () => {
    if (!formData.apiKey) {
      toast.error("Enter an API key first");
      return;
    }
    setValidationStatus("validating");
    const providerMap: Record<string, string> = {
      jarble: "openrouter",
      anthropic: "anthropic",
      openai: "openai",
      google: "google",
    };
    const provider = providerMap[formData.modelProvider] || "openrouter";
    validateMutation.mutate({ provider: provider as any, apiKey: formData.apiKey });
  };

  const showApiKey = formData.modelProvider && formData.modelProvider !== "jarble";

  return (
    <Card className="p-5 bg-card border-border space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-semibold">API Key (BYOK)</h3>
        </div>
        <span className={`flex items-center gap-1.5 text-xs font-medium ${
          hasKey ? "text-green-500" : "text-muted-foreground"
        }`}>
          {hasKey ? (
            <>
              <Shield className="w-3.5 h-3.5" />
              Configured
            </>
          ) : (
            <>
              <ShieldX className="w-3.5 h-3.5" />
              Not Set
            </>
          )}
        </span>
      </div>

      {hasKey && (
        <p className="text-xs text-muted-foreground">
          An API key is configured and encrypted. Enter a new key below to replace it.
        </p>
      )}

      {showApiKey && (
        <div>
          <Label htmlFor="apiKey" className="mb-2 block text-xs">{hasKey ? "Update Key" : "API Key"}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="apiKey"
              type="password"
              value={formData.apiKey}
              onChange={(e) => {
                updateFormData("apiKey", e.target.value);
                setValidationStatus("idle");
              }}
              className="bg-secondary/50 border-border text-foreground font-mono text-sm flex-1"
              placeholder="sk-..."
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleValidate}
              disabled={!formData.apiKey || validationStatus === "validating"}
              className="h-9 text-xs shrink-0"
            >
              {validationStatus === "validating" ? (
                <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
              ) : validationStatus === "valid" ? (
                <CheckCircle2 className="w-3 h-3 mr-1.5 text-green-500" />
              ) : validationStatus === "invalid" ? (
                <XCircle className="w-3 h-3 mr-1.5 text-red-500" />
              ) : (
                <Shield className="w-3 h-3 mr-1.5" />
              )}
              Validate
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Your API key is encrypted with AES-256-GCM before storage. Save changes to apply.
          </p>
        </div>
      )}

      {!showApiKey && (
        <p className="text-xs text-muted-foreground">
          Select a provider other than "Jarble Managed" to enter your own API key.
        </p>
      )}
    </Card>
  );
}
