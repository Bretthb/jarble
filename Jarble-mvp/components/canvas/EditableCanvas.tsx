"use client";

import { useState, useCallback, useEffect } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { Pencil, Save, X, Loader2, Check, AlertCircle } from "lucide-react";
import { API_URL } from "@/lib/trpc";
import CanvasRenderer from "./CanvasRenderer";
import type { UIBlock } from "./CanvasRenderer";
import type { CanvasAction } from "./CanvasActionContext";
import { EDITOR_COMPONENTS, FallbackJsonEditor } from "./editors/registry";

/**
 * Extract raw file content from component props based on the component type.
 * Used when saving edits back to the original file on the pod.
 */
function extractFileContent(component: string, props: Record<string, unknown>): string {
  switch (component) {
    case "code_block":
      return typeof props.code === "string" ? props.code : JSON.stringify(props, null, 2);
    case "card":
      return typeof props.body === "string" ? props.body : JSON.stringify(props, null, 2);
    case "key_value":
      return JSON.stringify(props.items ?? props, null, 2);
    case "data_table":
      return JSON.stringify({ columns: props.columns, rows: props.rows }, null, 2);
    default:
      return JSON.stringify(props, null, 2);
  }
}

interface EditableCanvasProps {
  block: UIBlock;
  deploymentId: string;
  sendMessage?: (text: string) => Promise<void>;
  onAction?: (action: CanvasAction) => void;
}

export default function EditableCanvas({
  block,
  deploymentId,
  sendMessage,
  onAction,
}: EditableCanvasProps) {
  const { getAccessTokenSilently } = useAuth0();
  const [isEditing, setIsEditing] = useState(false);
  const [editedProps, setEditedProps] = useState<Record<string, unknown>>(block.props);
  const [displayProps, setDisplayProps] = useState<Record<string, unknown>>(block.props);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  const [hasSavedLocally, setHasSavedLocally] = useState(false);

  const saveMethod = block.saveMethod || "chat";

  // Sync displayProps when block.props changes externally,
  // but not if the user just saved local edits (those take precedence)
  useEffect(() => {
    if (!isEditing && !hasSavedLocally) {
      setDisplayProps(block.props);
    }
  }, [block.props, isEditing, hasSavedLocally]);

  const handleEdit = useCallback(() => {
    setEditedProps({ ...displayProps });
    setIsEditing(true);
    setError(null);
  }, [displayProps]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditedProps(displayProps);
    setError(null);
  }, [displayProps]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);

    try {
      const isFilePath = block.fileId?.startsWith("/data/");

      if (isFilePath) {
        // Write back to the original file on the pod via write_file MCP tool
        const content = extractFileContent(block.component, editedProps);
        const token = await getAccessTokenSilently();
        const res = await fetch(
          `${API_URL}/api/deployments/${deploymentId}/mcp/invoke`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              tool: "write_file",
              args: { path: block.fileId, content },
            }),
          }
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Save failed" }));
          throw new Error(err.error || "Save failed");
        }

        const data = await res.json();
        if (data.result && !data.result.success) {
          throw new Error(data.result.message || "Write failed");
        }
      } else if (saveMethod === "chat" && sendMessage) {
        const payload = JSON.stringify({
          component: block.component,
          props: editedProps,
        });
        await sendMessage(
          `[CANVAS_SAVE] fileId=${block.fileId || "untitled"}\n${payload}`
        );
      } else {
        // Fallback: save as canvas component data
        const token = await getAccessTokenSilently();
        const res = await fetch(
          `${API_URL}/api/deployments/${deploymentId}/mcp/invoke`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              tool: "save_canvas_file",
              args: {
                fileId: block.fileId || "untitled",
                component: block.component,
                props: editedProps,
              },
            }),
          }
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Save failed" }));
          throw new Error(err.error || "Save failed");
        }
      }

      // Update local display state on confirmed success (no direct mutation)
      setDisplayProps(editedProps);
      setHasSavedLocally(true);
      setIsEditing(false);
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    } catch (err: any) {
      setError(err.message || "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }, [
    saveMethod,
    sendMessage,
    block.component,
    block.fileId,
    editedProps,
    getAccessTokenSilently,
    deploymentId,
  ]);

  // Build a display block with local state instead of original props
  const displayBlock = { ...block, props: displayProps };

  // View mode
  if (!isEditing) {
    return (
      <div className="relative group">
        <CanvasRenderer block={displayBlock} onAction={onAction} />

        {/* Saved indicator */}
        <div
          className={`absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-medium transition-all duration-300 pointer-events-none ${
            showSaved ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
          }`}
        >
          <Check className="w-3 h-3" />
          Saved
        </div>

        {/* Edit button */}
        {!showSaved && (
          <button
            onClick={handleEdit}
            className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 border border-border/60 text-muted-foreground hover:text-foreground hover:bg-background hover:scale-110 opacity-0 group-hover:opacity-100 transition-all duration-200 backdrop-blur-sm"
            title="Edit"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  }

  // Edit mode — pick the right editor
  const Editor = EDITOR_COMPONENTS[block.component] || FallbackJsonEditor;

  return (
    <div className="rounded-xl border border-primary/30 bg-secondary/30 p-3 space-y-3 transition-all duration-200">
      <Editor props={editedProps} onChange={setEditedProps} disabled={isSaving} />

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      <div className="flex items-center gap-2 justify-end">
        <button
          onClick={handleCancel}
          disabled={isSaving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border/60 bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-40"
        >
          <X className="w-3.5 h-3.5" />
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
        >
          {isSaving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          Save
        </button>
      </div>
    </div>
  );
}
