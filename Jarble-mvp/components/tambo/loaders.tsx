"use client";

import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";
import StatusCard from "./StatusCard";
import PlatformSetup from "./PlatformSetup";
import SystemPromptEditor from "./SystemPromptEditor";
import LLMConfigCard from "./LLMConfigCard";
import SkillsPanel from "./SkillsPanel";
import LogViewer from "./LogViewer";
import ConfirmAction from "./ConfirmAction";
import CanvasRenderer from "@/components/canvas/CanvasRenderer";

function LoadingSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-5 flex items-center justify-center h-24">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
      {message}
    </div>
  );
}

// ─── Status Loader ──────────────────────────────────────────────────────────

export function StatusLoader({ deploymentId }: { deploymentId: string }) {
  const query = trpc.deployment.getById.useQuery({ id: deploymentId });
  const credsQuery = trpc.platformCredentials.getByDeployment.useQuery({ deploymentId });

  if (query.isLoading || credsQuery.isLoading) return <LoadingSkeleton />;
  if (!query.data) return <ErrorCard message="Deployment not found" />;

  const dep = query.data as any;
  const connectedPlatforms = (credsQuery.data || []).map((c: any) => c.platformId);

  return (
    <StatusCard
      name={dep.name}
      status={dep.status}
      runtime={dep.runtime}
      llmProvider={dep.llmProvider || "none"}
      llmModel={dep.llmModel || "none"}
      platforms={connectedPlatforms}
    />
  );
}

// ─── Platforms Loader ───────────────────────────────────────────────────────

const ALL_PLATFORMS = ["telegram", "discord", "slack", "whatsapp"] as const;

export function PlatformsLoader({ deploymentId }: { deploymentId: string }) {
  const credsQuery = trpc.platformCredentials.getByDeployment.useQuery({ deploymentId });

  if (credsQuery.isLoading) return <LoadingSkeleton />;

  const connected = (credsQuery.data || []).map((c: any) => c.platformId);

  return (
    <div className="space-y-3">
      {ALL_PLATFORMS.map((p) => (
        <PlatformSetup
          key={p}
          deploymentId={deploymentId}
          platform={p}
          isConnected={connected.includes(p)}
        />
      ))}
    </div>
  );
}

// ─── System Prompt Loader ───────────────────────────────────────────────────

export function SystemPromptLoader({ deploymentId }: { deploymentId: string }) {
  const query = trpc.deployment.getById.useQuery({ id: deploymentId });

  if (query.isLoading) return <LoadingSkeleton />;
  if (!query.data) return <ErrorCard message="Deployment not found" />;

  const dep = query.data as any;

  return (
    <SystemPromptEditor
      deploymentId={deploymentId}
      currentPrompt={dep.systemPrompt || ""}
    />
  );
}

// ─── LLM Config Loader ─────────────────────────────────────────────────────

export function LLMConfigLoader({ deploymentId }: { deploymentId: string }) {
  const query = trpc.deployment.getById.useQuery({ id: deploymentId });

  if (query.isLoading) return <LoadingSkeleton />;
  if (!query.data) return <ErrorCard message="Deployment not found" />;

  const dep = query.data as any;

  return (
    <LLMConfigCard
      deploymentId={deploymentId}
      currentProvider={dep.llmProvider || "openrouter"}
      currentModel={dep.llmModel || "openrouter/auto"}
    />
  );
}

// ─── Skills Loader ──────────────────────────────────────────────────────────

export function SkillsLoader({ deploymentId }: { deploymentId: string }) {
  const catalogQuery = trpc.skills.listCatalog.useQuery({});
  const installedQuery = trpc.skills.listForDeployment.useQuery({ deploymentId });

  if (catalogQuery.isLoading || installedQuery.isLoading) return <LoadingSkeleton />;

  const catalog = (catalogQuery.data || []) as Array<{ id: string; name: string; description: string | null }>;
  const installedIds = new Set(
    (installedQuery.data || []).map((entry: any) => entry.skill?.id).filter(Boolean)
  );

  const skills = catalog.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    installed: installedIds.has(s.id),
  }));

  return <SkillsPanel deploymentId={deploymentId} availableSkills={skills} />;
}

// ─── Log Viewer Loader ──────────────────────────────────────────────────────

export function LogsLoader({ deploymentId }: { deploymentId: string }) {
  return <LogViewer deploymentId={deploymentId} />;
}

// ─── Confirm Action Loader ──────────────────────────────────────────────────

export function ConfirmActionLoader({
  deploymentId,
  args,
}: {
  deploymentId: string;
  args: { action?: string };
}) {
  const query = trpc.deployment.getById.useQuery({ id: deploymentId });

  if (query.isLoading) return <LoadingSkeleton />;
  if (!query.data) return <ErrorCard message="Deployment not found" />;

  const dep = query.data as any;
  const action = (args.action || "restart") as "restart" | "stop" | "start" | "delete";

  return (
    <ConfirmAction
      action={action}
      deploymentName={dep.name}
      deploymentId={deploymentId}
    />
  );
}

// ─── Tool name → Component mapping ──────────────────────────────────────────

export const TOOL_COMPONENTS: Record<
  string,
  React.FC<{ deploymentId: string; args: any }>
> = {
  show_status: ({ deploymentId }) => <StatusLoader deploymentId={deploymentId} />,
  show_platforms: ({ deploymentId }) => <PlatformsLoader deploymentId={deploymentId} />,
  show_system_prompt: ({ deploymentId }) => <SystemPromptLoader deploymentId={deploymentId} />,
  show_llm_config: ({ deploymentId }) => <LLMConfigLoader deploymentId={deploymentId} />,
  show_skills: ({ deploymentId }) => <SkillsLoader deploymentId={deploymentId} />,
  show_logs: ({ deploymentId }) => <LogsLoader deploymentId={deploymentId} />,
  confirm_action: ({ deploymentId, args }) => (
    <ConfirmActionLoader deploymentId={deploymentId} args={args} />
  ),
  canvas_block: ({ args }) => {
    const component = args?.component as string;
    const props = (args?.props as Record<string, unknown>) || {};
    if (!component) return <ErrorCard message="Missing component in canvas_block" />;
    return (
      <CanvasRenderer
        block={{ id: `cb-${Date.now()}`, component, props }}
      />
    );
  },
};
