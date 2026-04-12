"use client";

/**
 * FlowNodeConfigPanel -- right sidebar panel for configuring a flow node's
 * team role, delegation settings, context scope, and model override.
 *
 * Opens when a user clicks a node in the Bot Team Builder canvas.
 */

import { memo, useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  X,
  Star,
  Shield,
  MessageSquare,
  Cpu,
  ArrowRightLeft,
  FileText,
  BookOpen,
  ScrollText,
  Zap,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FlowNodeConfig {
  id: string;
  deploymentId?: string;
  label: string;
  role?: string;
  goal?: string;
  canDelegate?: boolean;
  contextScope?: "task" | "summary" | "full";
  modelOverride?: string;
  isEntryPoint?: boolean;
}

export interface FlowNodeConfigPanelProps {
  node: FlowNodeConfig;
  deploymentName?: string;
  deploymentRuntime?: string;
  deploymentStatus?: string;
  onUpdate: (nodeId: string, updates: Partial<FlowNodeConfig>) => void;
  onClose: () => void;
  onSetEntryPoint: (nodeId: string) => void;
}

// ── Context scope options ────────────────────────────────────────────────────

const CONTEXT_SCOPE_OPTIONS: Array<{
  value: "task" | "summary" | "full";
  label: string;
  description: string;
  icon: typeof FileText;
}> = [
  {
    value: "task",
    label: "Task only",
    description: "Agent only sees the specific delegated task. Best for focused work.",
    icon: FileText,
  },
  {
    value: "summary",
    label: "Task + Summary",
    description: "Agent sees the task plus a summary of conversation so far.",
    icon: BookOpen,
  },
  {
    value: "full",
    label: "Full conversation",
    description: "Agent sees the entire conversation history. Uses more tokens.",
    icon: ScrollText,
  },
];

// ── Available models ─────────────────────────────────────────────────────────

const AVAILABLE_MODELS = [
  { value: "__default__", label: "Use deployment default" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
  { value: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash" },
  { value: "deepseek/deepseek-chat-v3-0324", label: "DeepSeek V3" },
  { value: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick" },
];

// ── Status badge helper ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status?: string }) {
  const s = status ?? "unknown";
  const colorMap: Record<string, string> = {
    running: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    stopped: "bg-muted text-muted-foreground border-border",
    failed: "bg-red-500/20 text-red-400 border-red-500/30",
    deploying: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  };
  const dotMap: Record<string, string> = {
    running: "bg-emerald-400",
    stopped: "bg-muted-foreground",
    failed: "bg-red-400",
    deploying: "bg-amber-400",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${colorMap[s] ?? colorMap.stopped}`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${dotMap[s] ?? dotMap.stopped} ${s === "running" ? "animate-pulse" : ""}`}
      />
      {s.charAt(0).toUpperCase() + s.slice(1)}
    </span>
  );
}

// ── Runtime badge ────────────────────────────────────────────────────────────

function RuntimeBadge({ runtime }: { runtime?: string }) {
  if (!runtime) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-secondary/50 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      <Cpu className="h-3 w-3" />
      {runtime}
    </span>
  );
}

// ── Section wrapper ──────────────────────────────────────────────────────────

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: typeof Shield;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {title}
      </div>
      {children}
    </div>
  );
}

// ── Label helper ─────────────────────────────────────────────────────────────

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-[13px] font-medium text-foreground/90"
    >
      {children}
    </label>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

function FlowNodeConfigPanelInner({
  node,
  deploymentName,
  deploymentRuntime,
  deploymentStatus,
  onUpdate,
  onClose,
  onSetEntryPoint,
}: FlowNodeConfigPanelProps) {
  // Local state for debounced text inputs
  const [role, setRole] = useState(node.role ?? "");
  const [goal, setGoal] = useState(node.goal ?? "");

  // Sync when node changes externally
  useEffect(() => {
    setRole(node.role ?? "");
    setGoal(node.goal ?? "");
  }, [node.id, node.role, node.goal]);

  // Debounced update for text fields
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedUpdate = useCallback(
    (field: string, value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onUpdate(node.id, { [field]: value });
      }, 300);
    },
    [node.id, onUpdate]
  );

  const handleRoleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setRole(v);
      debouncedUpdate("role", v);
    },
    [debouncedUpdate]
  );

  const handleGoalChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const v = e.target.value;
      setGoal(v);
      debouncedUpdate("goal", v);
    },
    [debouncedUpdate]
  );

  const handleDelegateToggle = useCallback(
    (checked: boolean) => {
      onUpdate(node.id, { canDelegate: checked });
    },
    [node.id, onUpdate]
  );

  const handleContextScopeChange = useCallback(
    (value: string) => {
      onUpdate(node.id, { contextScope: value as FlowNodeConfig["contextScope"] });
    },
    [node.id, onUpdate]
  );

  const handleModelChange = useCallback(
    (value: string) => {
      onUpdate(node.id, {
        modelOverride: value === "__default__" ? undefined : value,
      });
    },
    [node.id, onUpdate]
  );

  const handleSetEntry = useCallback(() => {
    onSetEntryPoint(node.id);
  }, [node.id, onSetEntryPoint]);

  const selectedScope = CONTEXT_SCOPE_OPTIONS.find(
    (o) => o.value === (node.contextScope ?? "task")
  );

  return (
    <div className="h-full w-80 shrink-0 border-l border-border/60 bg-background/95 backdrop-blur-xl flex flex-col relative animate-in slide-in-from-right-4 duration-200">
      {/* Right accent line */}
      <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-primary/40 via-primary/20 to-transparent" />

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2 px-4 py-3.5 border-b border-border/40">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-foreground truncate">
            {deploymentName ?? node.label}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={deploymentStatus} />
            <RuntimeBadge runtime={deploymentRuntime} />
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-7 w-7 p-0 rounded-md hover:bg-secondary/80 transition-colors shrink-0 mt-0.5"
          aria-label="Close configuration panel"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* ── Scrollable body ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="space-y-5 px-4 py-4">
          {/* Role & Goal */}
          <Section title="Role & Goal" icon={MessageSquare}>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <FieldLabel htmlFor="node-role">Role</FieldLabel>
                <Input
                  id="node-role"
                  value={role}
                  onChange={handleRoleChange}
                  placeholder="e.g., CTO, Chart Specialist"
                  className="h-8 text-sm bg-secondary/30 border-border/40 focus-visible:border-primary/50"
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel htmlFor="node-goal">Goal</FieldLabel>
                <Textarea
                  id="node-goal"
                  value={goal}
                  onChange={handleGoalChange}
                  placeholder="What should this agent achieve in this team?"
                  rows={3}
                  className="min-h-[68px] text-sm bg-secondary/30 border-border/40 resize-none focus-visible:border-primary/50"
                />
              </div>
            </div>
          </Section>

          {/* Divider */}
          <div className="h-px bg-border/30" />

          {/* Delegation Settings */}
          <Section title="Delegation" icon={ArrowRightLeft}>
            <div className="space-y-3">
              {/* Can delegate toggle */}
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/30 bg-secondary/20 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-foreground/90">
                    Can delegate
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                    Allow this agent to send tasks to connected agents
                  </div>
                </div>
                <Switch
                  checked={node.canDelegate ?? true}
                  onCheckedChange={handleDelegateToggle}
                  aria-label="Toggle delegation"
                />
              </div>

              {/* Context passing */}
              <div className="space-y-1.5">
                <FieldLabel>Context passing</FieldLabel>
                <Select
                  value={node.contextScope ?? "task"}
                  onValueChange={handleContextScopeChange}
                >
                  <SelectTrigger className="w-full h-8 text-sm bg-secondary/30 border-border/40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTEXT_SCOPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <span className="flex items-center gap-1.5">
                          <opt.icon className="h-3.5 w-3.5 text-muted-foreground" />
                          {opt.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedScope && (
                  <p className="text-[11px] text-muted-foreground leading-snug pl-0.5">
                    {selectedScope.description}
                  </p>
                )}
              </div>
            </div>
          </Section>

          {/* Divider */}
          <div className="h-px bg-border/30" />

          {/* Model Override */}
          <Section title="Model Override" icon={Cpu}>
            <div className="space-y-1.5">
              <Select
                value={node.modelOverride ?? "__default__"}
                onValueChange={handleModelChange}
              >
                <SelectTrigger className="w-full h-8 text-sm bg-secondary/30 border-border/40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground leading-snug pl-0.5">
                Override the deployment's LLM model for this role.
              </p>
            </div>
          </Section>

          {/* Divider */}
          <div className="h-px bg-border/30" />

          {/* Entry Point */}
          <Section title="Entry Point" icon={Star}>
            {node.isEntryPoint ? (
              <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5">
                <Zap className="h-4 w-4 text-primary shrink-0" />
                <div>
                  <div className="text-[13px] font-semibold text-primary">
                    This is the entry point
                  </div>
                  <div className="text-[11px] text-primary/70 leading-tight mt-0.5">
                    Users send messages to this agent first.
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSetEntry}
                  className="w-full h-8 text-xs border-border/40 hover:border-primary/40 hover:bg-primary/5 transition-colors"
                >
                  <Star className="h-3.5 w-3.5 mr-1.5" />
                  Set as entry point
                </Button>
                <p className="text-[11px] text-muted-foreground leading-snug pl-0.5">
                  The entry point is the agent users talk to. Only one per flow.
                </p>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

export const FlowNodeConfigPanel = memo(FlowNodeConfigPanelInner);
export default FlowNodeConfigPanel;
