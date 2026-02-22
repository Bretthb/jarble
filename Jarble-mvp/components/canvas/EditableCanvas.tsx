"use client";

import { useState, useCallback } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { Pencil, Save, X, Loader2 } from "lucide-react";
import { API_URL } from "@/lib/trpc";
import CanvasRenderer from "./CanvasRenderer";
import type { UIBlock } from "./CanvasRenderer";
import { EDITOR_COMPONENTS, FallbackJsonEditor } from "./editors/registry";

interface EditableCanvasProps {
  block: UIBlock;
  deploymentId: string;
  sendMessage?: (text: string) => Promise<void>;
}

export default function EditableCanvas({
  block,
  deploymentId,
  sendMessage,
}: EditableCanvasProps) {
  const { getAccessTokenSilently } = useAuth0();
  const [isEditing, setIsEditing] = useState(false);
  const [editedProps, setEditedProps] = useState<Record<string, unknown>>(block.props);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  const saveMethod = block.saveMethod || "chat";

  const handleEdit = useCallback(() => {
    setEditedProps({ ...block.props });
    setIsEditing(true);
    setError(null);
  }, [block.props]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditedProps(block.props);
    setError(null);
  }, [block.props]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);

    try {
      if (saveMethod === "chat" && sendMessage) {
        // Send as chat message — bot decides how to save
        const payload = JSON.stringify({
          component: block.component,
          props: editedProps,
        });
        await sendMessage(
          `[CANVAS_SAVE] fileId=${block.fileId || "untitled"}\n${payload}`
        );
      } else {
        // Default: MCP proxy — call bot's MCP server directly
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

      // Update the block's props in place (optimistic)
      block.props = editedProps;
      setIsEditing(false);
    } catch (err: any) {
      setError(err.message || "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }, [
    saveMethod,
    sendMessage,
    block,
    editedProps,
    getAccessTokenSilently,
    deploymentId,
  ]);

  // View mode
  if (!isEditing) {
    return (
      <div
        className="relative group"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <CanvasRenderer block={block} />
        {isHovered && (
          <button
            onClick={handleEdit}
            className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 border border-border/60 text-muted-foreground hover:text-foreground hover:bg-background transition-colors backdrop-blur-sm"
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
    <div className="rounded-xl border border-primary/30 bg-secondary/30 p-3 space-y-3">
      <Editor props={editedProps} onChange={setEditedProps} />

      {error && (
        <p className="text-xs text-red-400">{error}</p>
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
