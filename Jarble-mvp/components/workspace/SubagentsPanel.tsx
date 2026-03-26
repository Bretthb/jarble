"use client";

/**
 * SubagentsPanel -- slide-out sidebar for creating, editing, and managing
 * subagents on a deployment. Each subagent becomes an `agent_{slug}` tool
 * the bot can invoke.
 */

import { memo, useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  X,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Bot,
  GitFork,
  ChevronLeft,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────

interface Subagent {
  id: string;
  deploymentId: string;
  name: string;
  slug: string;
  description: string | null;
  systemPrompt: string;
  model: string | null;
  triggerType: string;
  triggerConfig: string | null;
  tools: string | null;
  enabled: boolean;
  sortOrder: number;
  isPublic: boolean;
  forkedFromId: string | null;
  forkCount: number;
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface SubagentsPanelProps {
  deploymentId: string;
  onClose: () => void;
}

type FormData = {
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  triggerType: "manual" | "auto" | "conditional";
  enabled: boolean;
};

const INITIAL_FORM: FormData = {
  name: "",
  description: "",
  systemPrompt: "",
  model: "",
  triggerType: "manual",
  enabled: true,
};

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  auto: "Auto",
  conditional: "Conditional",
};

const TRIGGER_DESCRIPTIONS: Record<string, string> = {
  manual: "Invoked explicitly by the main agent",
  auto: "Runs automatically when relevant",
  conditional: "Triggered by a condition expression",
};

// ── Helper: derive slug preview from name ──────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 50);
}

// ── Main Component ───────────────────────────────────────────────────────

function SubagentsPanelInner({ deploymentId, onClose }: SubagentsPanelProps) {
  const [view, setView] = useState<"list" | "form">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Subagent | null>(null);

  const utils = trpc.useUtils();

  const listQuery = trpc.subagents.list.useQuery({ deploymentId });
  const createMutation = trpc.subagents.create.useMutation({
    onSuccess: () => {
      utils.subagents.list.invalidate({ deploymentId });
      resetForm();
    },
  });
  const updateMutation = trpc.subagents.update.useMutation({
    onSuccess: () => {
      utils.subagents.list.invalidate({ deploymentId });
      resetForm();
    },
  });
  const deleteMutation = trpc.subagents.delete.useMutation({
    onSuccess: () => {
      utils.subagents.list.invalidate({ deploymentId });
      setDeleteTarget(null);
    },
  });

  const subagents: Subagent[] = (listQuery.data as Subagent[] | undefined) ?? [];
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const saveError = createMutation.error || updateMutation.error;

  // ── Form helpers ──────────────────────────────────────────────────────

  const resetForm = useCallback(() => {
    setForm(INITIAL_FORM);
    setEditingId(null);
    setView("list");
  }, []);

  const openNewForm = useCallback(() => {
    setForm(INITIAL_FORM);
    setEditingId(null);
    setView("form");
  }, []);

  const openEditForm = useCallback((subagent: Subagent) => {
    setForm({
      name: subagent.name,
      description: subagent.description ?? "",
      systemPrompt: subagent.systemPrompt,
      model: subagent.model ?? "",
      triggerType: subagent.triggerType as FormData["triggerType"],
      enabled: subagent.enabled,
    });
    setEditingId(subagent.id);
    setView("form");
  }, []);

  const handleSave = useCallback(() => {
    if (!form.name.trim() || !form.systemPrompt.trim()) return;

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      systemPrompt: form.systemPrompt,
      model: form.model.trim() || undefined,
      triggerType: form.triggerType,
      enabled: form.enabled,
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload });
    } else {
      createMutation.mutate({ deploymentId, ...payload });
    }
  }, [form, editingId, deploymentId, createMutation, updateMutation]);

  const handleToggleEnabled = useCallback(
    (subagent: Subagent) => {
      updateMutation.mutate(
        { id: subagent.id, enabled: !subagent.enabled },
        {
          onSuccess: () => {
            utils.subagents.list.invalidate({ deploymentId });
          },
        }
      );
    },
    [updateMutation, utils, deploymentId]
  );

  const updateField = useCallback(
    <K extends keyof FormData>(key: K, value: FormData[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  // ── Slug preview ──────────────────────────────────────────────────────

  const slugPreview = form.name.trim() ? `agent_${slugify(form.name)}` : "";

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="w-80 border-l border-border/60 bg-background flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {view === "form" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={resetForm}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
          )}
          <Bot className="w-4 h-4 text-violet-500" />
          <span className="text-sm font-medium">
            {view === "form"
              ? editingId
                ? "Edit Subagent"
                : "New Subagent"
              : "Subagents"}
          </span>
          {view === "list" && subagents.length > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {subagents.length}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={onClose}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {view === "list" ? (
        <>
          {/* New subagent button */}
          <div className="px-3 py-2 border-b border-border/60">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={openNewForm}
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              New Subagent
            </Button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {listQuery.isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : subagents.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <Bot className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">
                  No subagents yet.
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Create a subagent to give your bot
                  <br />
                  specialized capabilities.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {subagents.map((sa) => (
                  <SubagentListItem
                    key={sa.id}
                    subagent={sa}
                    onEdit={() => openEditForm(sa)}
                    onDelete={() => setDeleteTarget(sa)}
                    onToggleEnabled={() => handleToggleEnabled(sa)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        /* ── Form View ── */
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-3 space-y-4">
            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Name
              </label>
              <Input
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="e.g. Research Assistant"
                className="h-8 text-sm"
                maxLength={100}
                autoFocus
              />
              {slugPreview && (
                <p className="text-[10px] text-muted-foreground/70 font-mono">
                  Tool name: {slugPreview}
                </p>
              )}
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Description
              </label>
              <Input
                value={form.description}
                onChange={(e) => updateField("description", e.target.value)}
                placeholder="Brief description of what this subagent does"
                className="h-8 text-sm"
              />
            </div>

            {/* System Prompt */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                System Prompt
              </label>
              <Textarea
                value={form.systemPrompt}
                onChange={(e) => updateField("systemPrompt", e.target.value)}
                placeholder="You are a specialized assistant that..."
                className="min-h-[160px] text-sm resize-y"
              />
            </div>

            {/* Model (optional) */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Model{" "}
                <span className="text-muted-foreground/50">(optional)</span>
              </label>
              <Input
                value={form.model}
                onChange={(e) => updateField("model", e.target.value)}
                placeholder="Default model"
                className="h-8 text-sm"
                maxLength={100}
              />
              <p className="text-[10px] text-muted-foreground/70">
                Leave blank to use the deployment&apos;s default model
              </p>
            </div>

            {/* Trigger Type */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Trigger
              </label>
              <Select
                value={form.triggerType}
                onValueChange={(v) =>
                  updateField("triggerType", v as FormData["triggerType"])
                }
              >
                <SelectTrigger className="h-8 text-sm w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["manual", "auto", "conditional"] as const).map((t) => (
                    <SelectItem key={t} value={t}>
                      {TRIGGER_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground/70">
                {TRIGGER_DESCRIPTIONS[form.triggerType]}
              </p>
            </div>

            {/* Enabled */}
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">
                Enabled
              </label>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => updateField("enabled", v)}
              />
            </div>

            {/* Error */}
            {saveError && (
              <div className="text-xs text-destructive bg-destructive/10 rounded-md px-2.5 py-2">
                {saveError.message}
              </div>
            )}

            {/* Save button */}
            <Button
              className="w-full"
              size="sm"
              onClick={handleSave}
              disabled={
                isSaving || !form.name.trim() || !form.systemPrompt.trim()
              }
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              ) : (
                <Save className="w-3.5 h-3.5 mr-1.5" />
              )}
              {editingId ? "Save Changes" : "Create Subagent"}
            </Button>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Subagent</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <strong>{deleteTarget?.name}</strong>? This action cannot be
              undone. The bot will no longer be able to invoke{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                agent_{deleteTarget?.slug}
              </code>
              .
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  deleteMutation.mutate({ id: deleteTarget.id });
                }
              }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              ) : (
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Subagent List Item ──────────────────────────────────────────────────

function SubagentListItem({
  subagent,
  onEdit,
  onDelete,
  onToggleEnabled,
}: {
  subagent: Subagent;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
}) {
  return (
    <div
      className={cn(
        "px-3 py-2.5 group hover:bg-muted/40 transition-colors",
        !subagent.enabled && "opacity-50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium truncate">
              {subagent.name}
            </span>
            {subagent.forkCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <GitFork className="w-2.5 h-2.5" />
                {subagent.forkCount}
              </span>
            )}
          </div>
          <p className="text-[10px] font-mono text-muted-foreground/70 mt-0.5">
            agent_{subagent.slug}
          </p>
          {subagent.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {subagent.description}
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-1.5">
            <Badge
              variant="secondary"
              className="text-[10px] px-1.5 py-0"
            >
              {TRIGGER_LABELS[subagent.triggerType] ?? subagent.triggerType}
            </Badge>
            {subagent.model && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0"
              >
                {subagent.model}
              </Badge>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <Switch
            checked={subagent.enabled}
            onCheckedChange={onToggleEnabled}
            className="scale-75"
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={onEdit}
            title="Edit subagent"
          >
            <Pencil className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-destructive/70 hover:text-destructive"
            onClick={onDelete}
            title="Delete subagent"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default memo(SubagentsPanelInner);
