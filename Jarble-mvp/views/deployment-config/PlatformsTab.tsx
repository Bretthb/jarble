"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Settings,
  Shield,
  Loader2,
  ExternalLink,
  CheckCircle2,
  Eye,
  EyeOff,
  Copy,
  Save,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PLATFORM_CONFIGS } from "./types";
import type { PlatformConfig, PlatformsTabProps } from "./types";

export function PlatformsTab({ formData, updateFormData, deploymentId }: PlatformsTabProps) {
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformConfig | null>(null);
  const [platformCredentials, setPlatformCredentials] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  // ── API queries & mutations ─────────────────────────────────────────
  const credentialsQuery = trpc.platformCredentials.getByDeployment.useQuery(
    { deploymentId },
    { enabled: !!deploymentId }
  );

  const saveMutation = trpc.platformCredentials.save.useMutation({
    onSuccess: () => {
      toast.success(`${selectedPlatform?.name} configuration saved!`);
      setConfigModalOpen(false);
      credentialsQuery.refetch();
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Failed to save credentials");
    },
  });

  const deleteMutation = trpc.platformCredentials.delete.useMutation({
    onSuccess: (_data: unknown, variables: { platformId: string }) => {
      const platform = PLATFORM_CONFIGS.find(p => p.id === variables.platformId);
      toast.success(`${platform?.name} disconnected`);
      credentialsQuery.refetch();
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Failed to disconnect platform");
    },
  });

  const testMutation = trpc.platformCredentials.testConnection.useMutation({
    onSuccess: (data: { success: boolean; message: string }) => {
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Connection test failed");
    },
  });

  // ── Sync connected platforms from API data into formData ────────────
  useEffect(() => {
    if (credentialsQuery.data) {
      const connectedIds = credentialsQuery.data.map((c: any) => c.platformId);
      const currentPlatforms = formData.platforms || [];

      // Only update if the list actually changed
      const changed =
        connectedIds.length !== currentPlatforms.length ||
        connectedIds.some((id: string) => !currentPlatforms.includes(id));

      if (changed) {
        updateFormData("platforms", connectedIds);
      }
    }
  }, [credentialsQuery.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const openConfigModal = (platform: PlatformConfig) => {
    setSelectedPlatform(platform);
    // Pre-fill with masked credentials if connected (user must re-enter to update)
    const existing = credentialsQuery.data?.find((c: any) => c.platformId === platform.id);
    if (existing) {
      setPlatformCredentials(existing.maskedCredentials || {});
    } else {
      setPlatformCredentials({});
    }
    setShowSecrets({});
    setConfigModalOpen(true);
  };

  const handleSaveCredentials = () => {
    if (!selectedPlatform) return;

    saveMutation.mutate({
      deploymentId,
      platformId: selectedPlatform.id,
      credentials: platformCredentials,
    });
  };

  const handleTestConnection = () => {
    if (!selectedPlatform) return;

    testMutation.mutate({
      deploymentId,
      platformId: selectedPlatform.id,
      credentials: platformCredentials,
    });
  };

  const handleDisconnect = (platformId: string) => {
    if (!confirm("Are you sure you want to disconnect this platform? This will remove all credentials.")) {
      return;
    }

    deleteMutation.mutate({ deploymentId, platformId });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  const toggleSecretVisibility = (key: string) => {
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Platform Integrations</h2>
        <p className="text-muted-foreground text-sm">Connect and configure your deployment channels</p>
      </div>

      {/* Security Notice */}
      <div className="flex items-start gap-3 p-4 rounded-lg bg-secondary/50 border border-border">
        <Shield className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-foreground">Credentials are encrypted</p>
          <p className="text-xs text-muted-foreground mt-1">
            All API keys and tokens are encrypted at rest and never logged. Only you can access them.
          </p>
        </div>
      </div>

      {/* Connected Platforms */}
      {formData.platforms?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            Connected Platforms
          </h3>
          <div className="space-y-3">
            {PLATFORM_CONFIGS.filter(p => formData.platforms?.includes(p.id)).map((platform) => (
              <div
                key={platform.id}
                className="p-4 rounded-lg border border-border bg-secondary/30 hover:border-primary/30 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-secondary/80 flex items-center justify-center text-xl">
                      {platform.icon}
                    </div>
                    <div>
                      <h3 className="font-semibold flex items-center gap-2">
                        {platform.name}
                        <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                          Connected
                        </span>
                      </h3>
                      <p className="text-sm text-muted-foreground">{platform.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openConfigModal(platform)}
                      className="border-border hover:bg-secondary/80"
                    >
                      <Settings className="w-4 h-4 mr-1" />
                      Configure
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDisconnect(platform.id)}
                      disabled={deleteMutation.isPending}
                      className="border-border text-muted-foreground hover:bg-secondary/80"
                    >
                      {deleteMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <X className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available Platforms */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground mb-3">
          {formData.platforms?.length > 0 ? "Add More Platforms" : "Available Platforms"}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {PLATFORM_CONFIGS.filter(p => !formData.platforms?.includes(p.id)).map((platform) => (
            <div
              key={platform.id}
              className="p-4 rounded-lg border border-border bg-secondary/50 hover:border-primary/30 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center text-xl">
                    {platform.icon}
                  </div>
                  <div>
                    <h3 className="font-semibold">{platform.name}</h3>
                    <p className="text-xs text-muted-foreground">{platform.description}</p>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <a
                  href={platform.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:text-primary/90 flex items-center gap-1"
                >
                  View docs <ExternalLink className="w-3 h-3" />
                </a>
                <Button
                  size="sm"
                  onClick={() => openConfigModal(platform)}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  Connect
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Configuration Modal */}
      <Dialog open={configModalOpen} onOpenChange={setConfigModalOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-lg max-h-[85vh] overflow-y-auto">
          {selectedPlatform && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <span className="text-2xl">{selectedPlatform.icon}</span>
                  Configure {selectedPlatform.name}
                </DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  Enter your credentials to connect
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 mt-4">
                {/* Security reminder */}
                <div className="flex items-start gap-2 p-3 rounded-lg bg-secondary/50 border border-border">
                  <Shield className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    Your credentials are encrypted and stored securely. They are never logged or shared.
                  </p>
                </div>

                {/* WhatsApp special case — no credential fields */}
                {selectedPlatform.id === "whatsapp" && selectedPlatform.fields.length === 0 && (
                  <div className="p-4 rounded-lg bg-secondary/50 border border-border text-center">
                    <p className="text-sm text-foreground font-medium mb-1">QR Code Pairing</p>
                    <p className="text-xs text-muted-foreground">
                      WhatsApp uses QR code pairing via Baileys. No credentials needed — connect via the deployment console after deploying.
                    </p>
                  </div>
                )}

                {/* Credential Fields */}
                {selectedPlatform.fields.map((field) => (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 block text-sm">
                      {field.label}
                      {field.required && <span className="text-red-400 ml-1">*</span>}
                    </Label>
                    {field.type === "textarea" ? (
                      <textarea
                        id={field.key}
                        value={platformCredentials[field.key] || ""}
                        onChange={(e) => setPlatformCredentials(prev => ({ ...prev, [field.key]: e.target.value }))}
                        className="w-full min-h-[80px] px-3 py-2 bg-secondary/80 border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                        placeholder={field.placeholder}
                      />
                    ) : (
                      <div className="relative">
                        <Input
                          id={field.key}
                          type={field.type === "password" && !showSecrets[field.key] ? "password" : "text"}
                          value={platformCredentials[field.key] || ""}
                          onChange={(e) => setPlatformCredentials(prev => ({ ...prev, [field.key]: e.target.value }))}
                          className="bg-secondary/80 border-border text-foreground pr-20"
                          placeholder={field.placeholder}
                        />
                        {field.type === "password" && (
                          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => toggleSecretVisibility(field.key)}
                              className="p-1 text-muted-foreground hover:text-foreground"
                            >
                              {showSecrets[field.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                            {platformCredentials[field.key] && (
                              <button
                                type="button"
                                onClick={() => copyToClipboard(platformCredentials[field.key])}
                                className="p-1 text-muted-foreground hover:text-foreground"
                              >
                                <Copy className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {field.helpText && (
                      <p className="text-xs text-muted-foreground mt-1">{field.helpText}</p>
                    )}
                  </div>
                ))}

                {/* Documentation link */}
                <a
                  href={selectedPlatform.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-primary hover:text-primary/90"
                >
                  <ExternalLink className="w-4 h-4" />
                  View {selectedPlatform.name} setup documentation
                </a>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
                <Button
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={testMutation.isPending}
                  className="border-border"
                >
                  {testMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Test Connection
                    </>
                  )}
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setConfigModalOpen(false)}
                    className="border-border"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveCredentials}
                    disabled={saveMutation.isPending}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {saveMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Save & Connect
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
