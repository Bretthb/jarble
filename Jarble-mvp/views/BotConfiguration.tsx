"use client";

import { useState, useEffect } from "react";
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
} from "lucide-react";
import { TABS } from "./bot-config/types";
import type { Tab, BotFormData } from "./bot-config/types";
import { GeneralTab } from "./bot-config/GeneralTab";
import { ModelTab } from "./bot-config/ModelTab";
import { PlatformsTab } from "./bot-config/PlatformsTab";
import { SkillsTab } from "./bot-config/SkillsTab";
import { AdvancedTab } from "./bot-config/AdvancedTab";

export default function BotConfiguration() {
  const { botId } = useParams() as { botId: string };
  const router = useRouter();
  const { isAuthenticated } = useAuth0();

  const [activeTab, setActiveTab] = useState<Tab>("general");
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const [formData, setFormData] = useState<BotFormData>({
    name: "",
    description: "",
    modelProvider: "",
    modelName: "",
    apiKey: "",
    systemPrompt: "",
    temperature: 0.7,
    maxTokens: 2048,
    platforms: [],
    skills: [],
  });

  const botQuery = trpc.bot.getById.useQuery(
    { id: botId },
    { enabled: !!botId && isAuthenticated }
  );

  const updateMutation = trpc.bot.update.useMutation({
    onSuccess: () => {
      toast.success("Configuration saved!");
      setHasChanges(false);
      botQuery.refetch();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to save configuration");
    },
    onSettled: () => setIsSaving(false),
  });

  const deleteMutation = trpc.bot.delete.useMutation({
    onSuccess: () => {
      toast.success("Bot deleted!");
      router.push("/dashboard");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to delete bot");
    },
  });

  const bot = botQuery.data;

  useEffect(() => {
    if (bot) {
      setFormData({
        name: bot.name || "",
        description: bot.description || "",
        modelProvider: "",
        modelName: "",
        apiKey: "",
        systemPrompt: "",
        temperature: 0.7,
        maxTokens: 2048,
        platforms: [],
        skills: [],
      });
    }
  }, [bot]);

  const updateFormData = (key: string, value: string | number | string[]) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    setIsSaving(true);
    updateMutation.mutate({
      id: botId,
      name: formData.name,
      description: formData.description,
    });
  };

  const handleToggleStatus = () => {
    // TODO: Implement when API supports status toggle
    toast.info("Status toggle not yet implemented");
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this bot?")) {
      deleteMutation.mutate({ id: botId });
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="p-8 bg-card border-border text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">Access Denied</h2>
          <p className="text-muted-foreground mb-4">Please log in to configure your bot</p>
          <Button onClick={() => router.push("/login")}>Sign In</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/dashboard")}
              className="text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back to Dashboard
            </Button>
            <div className="h-6 w-px bg-secondary/80" />
            <div>
              <h1 className="text-xl font-bold">{formData.name || "Bot Configuration"}</h1>
              <p className="text-sm text-muted-foreground">Bot ID: {botId}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {hasChanges && (
              <span className="text-xs text-primary bg-primary/10 px-2 py-1 rounded">
                Unsaved changes
              </span>
            )}
            <Button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save Changes
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex gap-8">
          {/* Sidebar Navigation */}
          <aside data-tour="config-sidebar" className="w-56 flex-shrink-0">
            <nav className="space-y-1 sticky top-24">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  data-tab={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all ${
                    activeTab === tab.id
                      ? "bg-primary/10 text-primary border border-primary/30"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}

              <div className="pt-6 mt-6 border-t border-border space-y-2">
                <button
                  onClick={handleToggleStatus}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
                >
                  {bot?.status === "running" ? (
                    <>
                      <PowerOff className="w-4 h-4" />
                      Pause Bot
                    </>
                  ) : (
                    <>
                      <Power className="w-4 h-4 text-green-600" />
                      Activate Bot
                    </>
                  )}
                </button>
                <button
                  onClick={handleDelete}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Bot
                </button>
              </div>
            </nav>
          </aside>

          {/* Main Content */}
          <main className="flex-1 min-w-0">
            <Card className="bg-card border-border p-6">
              {activeTab === "general" && (
                <GeneralTab formData={formData} updateFormData={updateFormData} />
              )}
              {activeTab === "model" && (
                <ModelTab formData={formData} updateFormData={updateFormData} />
              )}
              {activeTab === "platforms" && (
                <PlatformsTab formData={formData} updateFormData={updateFormData} />
              )}
              {activeTab === "skills" && (
                <SkillsTab formData={formData} updateFormData={updateFormData} />
              )}
              {activeTab === "advanced" && (
                <AdvancedTab formData={formData} updateFormData={updateFormData} bot={bot} />
              )}
            </Card>
          </main>
        </div>
      </div>
    </div>
  );
}
