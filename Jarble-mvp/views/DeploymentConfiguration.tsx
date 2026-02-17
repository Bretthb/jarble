"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import {
  ChevronLeft,
  Save,
  Trash2,
  Power,
  PowerOff,
  Loader2,
  XCircle,
  Download,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { createElement } from "react";
import ProfileDropdown from "@/components/ProfileDropdown";
import CancellationGracePeriod from "@/components/CancellationGracePeriod";
import { getConfigTabs } from "./onboarding/wizardStepConfig";
import type { Tab, DeploymentFormData } from "./deployment-config/types";
import { GeneralTab } from "./deployment-config/GeneralTab";
import { ModelTab } from "./deployment-config/ModelTab";
import { PlatformsTab } from "./deployment-config/PlatformsTab";
import { SkillsTab } from "./deployment-config/SkillsTab";
import { AdvancedTab } from "./deployment-config/AdvancedTab";
import { LogsTab } from "./deployment-config/LogsTab";
import { useStatusStream } from "@/hooks/useStatusStream";

/** Decode a base64 string to a Blob and trigger a browser download. */
function base64ToBlob(b64: string, mime = "application/zip"): Blob {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DeploymentConfiguration() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { isAuthenticated } = useAuth0();

  const [activeTab, setActiveTab] = useState<Tab>("general");
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const [formData, setFormData] = useState<DeploymentFormData>({
    name: "",
    description: "",
    modelProvider: "",
    modelName: "",
    apiKey: "",
    systemPrompt: "",
    platforms: [],
    skills: [],
  });

  const deploymentQuery = trpc.deployment.getById.useQuery(
    { id },
    { enabled: !!id && isAuthenticated }
  );

  const updateMutation = trpc.deployment.update.useMutation({
    onSuccess: () => {
      toast.success("Configuration saved!");
      setHasChanges(false);
      deploymentQuery.refetch();
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Failed to save configuration");
    },
    onSettled: () => setIsSaving(false),
  });

  const deleteMutation = trpc.deployment.delete.useMutation({
    onSuccess: () => {
      toast.success("Deployment deleted!");
      router.push("/dashboard");
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Failed to delete deployment");
    },
  });

  const cancelMutation = trpc.deployment.cancel.useMutation({
    onSuccess: (data: { cancelAt: string }) => {
      const date = new Date(data.cancelAt).toLocaleDateString();
      toast.success(`Subscription cancelled — access until ${date}`);
      deploymentQuery.refetch();
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Failed to cancel subscription");
    },
  });

  const reactivateMutation = trpc.deployment.reactivate.useMutation({
    onSuccess: () => {
      toast.success("Subscription reactivated!");
      deploymentQuery.refetch();
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Failed to reactivate subscription");
    },
  });

  const exportMutation = trpc.deployment.exportConfigs.useMutation({
    onSuccess: (data: { filename: string; data: string }) => {
      const blob = base64ToBlob(data.data);
      downloadBlob(blob, data.filename);
      toast.success("Config files exported!");
    },
    onError: (err: { message?: string }) => {
      toast.error(err.message || "Failed to export configs");
    },
  });

  const deployment = deploymentQuery.data;
  const dep = deployment as any;
  const isCancelled = !!dep?.cancelledAt;
  const isPaid = deployment && !dep?.isFree;

  // Real-time status via SSE
  const { getStatus: getLiveStatus } = useStatusStream({
    enabled: !!id && isAuthenticated,
  });
  const displayStatus = getLiveStatus(id)?.status || deployment?.status;

  // Dynamic tabs based on the deployment's runtime
  const runtimeSlug = deployment?.runtime ?? null;
  const tabs = useMemo(() => getConfigTabs(runtimeSlug), [runtimeSlug]);

  // If active tab no longer exists in the new tab set (e.g. after runtime changes), reset to general
  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.id === activeTab)) {
      setActiveTab("general");
    }
  }, [tabs, activeTab]);

  useEffect(() => {
    if (deployment) {
      setFormData({
        name: deployment.name || "",
        description: deployment.description || "",
        modelProvider: (deployment as any).llmProvider || "",
        modelName: (deployment as any).llmModel || "",
        apiKey: "",
        systemPrompt: (deployment as any).systemPrompt || "",
        platforms: [],
        skills: [],
      });
    }
  }, [deployment]);

  const updateFormData = (key: string, value: string | number | string[]) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    setIsSaving(true);
    updateMutation.mutate({
      id,
      name: formData.name,
      description: formData.description,
      systemPrompt: formData.systemPrompt || undefined,
      llmProvider: formData.modelProvider ? formData.modelProvider as any : undefined,
      llmModel: formData.modelName || undefined,
      llmApiKey: formData.apiKey || undefined,
    });
  };

  const handleToggleStatus = () => {
    // TODO: Implement when API supports status toggle
    toast.info("Status toggle not yet implemented");
  };

  const handleCancel = () => {
    if (confirm("Cancel your subscription? Your deployment will remain active until the end of the current billing period.")) {
      cancelMutation.mutate({ id });
    }
  };

  const handleReactivate = () => {
    reactivateMutation.mutate({ id });
  };

  const handleExport = () => {
    exportMutation.mutate({ id });
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this deployment?")) {
      deleteMutation.mutate({ id });
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="p-8 bg-card border-border text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">Access Denied</h2>
          <p className="text-muted-foreground mb-4">Please log in to configure your deployment</p>
          <Button onClick={() => router.push("/login")}>Sign In</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/60 bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/dashboard")}
              className="text-muted-foreground hover:text-foreground h-8 px-2"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-base font-semibold">{formData.name || "Configuration"}</h1>
            {displayStatus && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                displayStatus === "running"
                  ? "bg-primary/10 text-primary"
                  : "bg-secondary text-muted-foreground"
              }`}>
                {displayStatus}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasChanges && (
              <span className="text-xs text-primary font-medium">Unsaved</span>
            )}
            <Button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              size="sm"
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium h-8"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5 mr-1.5" />
              )}
              Save
            </Button>
            <ProfileDropdown />
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex gap-8">
          {/* Sidebar Navigation */}
          <aside data-tour="config-sidebar" className="w-48 flex-shrink-0">
            <nav className="space-y-0.5 sticky top-20">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-3 mb-2">Settings</p>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  data-tab={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-sm transition-colors ${
                    activeTab === tab.id
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  }`}
                >
                  {createElement(tab.icon, { className: "w-4 h-4 shrink-0" })}
                  {tab.label}
                </button>
              ))}

              {/* Subscription section — paid deployments only */}
              {isPaid && (
                <div className="pt-4 mt-4 border-t border-border/40 space-y-0.5">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-3 mb-2">Subscription</p>
                  {isCancelled && dep.cancelAtPeriodEnd ? (
                    <div className="px-1">
                      <CancellationGracePeriod
                        cancelAtPeriodEnd={dep.cancelAtPeriodEnd}
                        onExport={handleExport}
                        onReactivate={handleReactivate}
                        isExporting={exportMutation.isPending}
                        isReactivating={reactivateMutation.isPending}
                      />
                    </div>
                  ) : (
                    <button
                      onClick={handleCancel}
                      disabled={cancelMutation.isPending}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
                    >
                      {cancelMutation.isPending ? (
                        <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                      ) : (
                        <XCircle className="w-4 h-4 shrink-0" />
                      )}
                      Cancel Subscription
                    </button>
                  )}
                </div>
              )}

              <div className="pt-4 mt-4 border-t border-border/40 space-y-0.5">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-3 mb-2">Actions</p>
                <button
                  onClick={handleToggleStatus}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                >
                  {displayStatus === "running" ? (
                    <>
                      <PowerOff className="w-4 h-4 shrink-0" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Power className="w-4 h-4 text-primary shrink-0" />
                      Activate
                    </>
                  )}
                </button>
                <button
                  onClick={handleExport}
                  disabled={exportMutation.isPending}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                >
                  {exportMutation.isPending ? (
                    <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 shrink-0" />
                  )}
                  Export Config
                </button>
                <button
                  onClick={handleDelete}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                >
                  <Trash2 className="w-4 h-4 shrink-0" />
                  Delete
                </button>
              </div>
            </nav>
          </aside>

          {/* Main Content */}
          <main className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {activeTab === "general" && (
                  <GeneralTab formData={formData} updateFormData={updateFormData} />
                )}
                {activeTab === "model" && (
                  <ModelTab formData={formData} updateFormData={updateFormData} />
                )}
                {activeTab === "platforms" && (
                  <PlatformsTab formData={formData} updateFormData={updateFormData} deploymentId={id} />
                )}
                {activeTab === "skills" && (
                  <SkillsTab formData={formData} updateFormData={updateFormData} />
                )}
                {activeTab === "logs" && (
                  <LogsTab deploymentId={id} deploymentStatus={displayStatus} />
                )}
                {activeTab === "advanced" && (
                  <AdvancedTab formData={formData} updateFormData={updateFormData} deployment={deployment} />
                )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </div>
  );
}
