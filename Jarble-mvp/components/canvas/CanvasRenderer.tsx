"use client";

import { createContext, useContext } from "react";
import { CANVAS_COMPONENTS } from "./registry";

export interface UIBlock {
  id: string;
  component: string;
  props: Record<string, unknown>;
  editable?: boolean;
  fileId?: string;
  saveMethod?: "mcp" | "chat";
}

// Depth guard: prevent infinite recursion in nested layouts
const MAX_DEPTH = 5;
const CanvasDepthContext = createContext(0);

/**
 * Safely renders a bot UI block by looking up the component in the registry,
 * validating props with Zod, and rendering. Falls back to an error card.
 */
export default function CanvasRenderer({ block }: { block: UIBlock }) {
  const depth = useContext(CanvasDepthContext);

  if (depth >= MAX_DEPTH) {
    return (
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300">
        Max nesting depth reached ({MAX_DEPTH})
      </div>
    );
  }

  const entry = CANVAS_COMPONENTS[block.component];

  if (!entry) {
    return (
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300">
        Unknown component: <code>{block.component}</code>
      </div>
    );
  }

  const result = entry.propsSchema.safeParse(block.props);

  if (!result.success) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
        Invalid props for <code>{block.component}</code>:{" "}
        {result.error.issues.map((i) => i.message).join(", ")}
      </div>
    );
  }

  const Component = entry.component;
  const validatedProps = result.data as Record<string, unknown>;

  return (
    <CanvasDepthContext.Provider value={depth + 1}>
      <Component {...validatedProps} />
    </CanvasDepthContext.Provider>
  );
}
