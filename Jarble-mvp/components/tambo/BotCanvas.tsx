"use client";

/**
 * BotCanvas - Tambo-registered wrapper for bot-rendered UI blocks.
 *
 * Receives the full block metadata from chatWithBot and delegates
 * to EditableCanvas (if editable) or CanvasRenderer (if read-only).
 * The bot controls what renders and whether it's editable - Tambo
 * just displays it.
 */

import CanvasRenderer from "@/components/canvas/CanvasRenderer";
import EditableCanvas from "@/components/canvas/EditableCanvas";
import type { UIBlock } from "@/components/canvas/CanvasRenderer";

interface BotCanvasProps {
  blockId: string;
  component: string;
  /** JSON-serialized component props (avoids Tambo's record-type restriction) */
  propsJson: string;
  editable?: boolean;
  fileId?: string;
  saveMethod?: "mcp" | "chat";
  deploymentId: string;
}

export default function BotCanvas({
  blockId,
  component,
  propsJson,
  editable,
  fileId,
  saveMethod,
  deploymentId,
}: BotCanvasProps) {
  let parsedProps: Record<string, unknown> = {};
  try {
    parsedProps = typeof propsJson === "string" ? JSON.parse(propsJson) : (propsJson as any) ?? {};
  } catch {
    // fallback to empty props if parsing fails
  }

  // Debug: log what BotCanvas receives from Tambo
  console.log("[BotCanvas] received:", { blockId, component, propsJson, parsedProps, editable, fileId, saveMethod, deploymentId });

  const block: UIBlock = {
    id: blockId,
    component,
    props: parsedProps,
    editable,
    fileId,
    saveMethod,
  };

  // Bot-rendered blocks are always editable - the bot doesn't reliably include
  // the editable flag when the request goes through callPodProxy (no history context).
  const isEditable = editable !== false;

  if (isEditable) {
    return (
      <EditableCanvas
        block={{ ...block, saveMethod: saveMethod || "mcp" }}
        deploymentId={deploymentId}
      />
    );
  }

  return <CanvasRenderer block={block} />;
}
