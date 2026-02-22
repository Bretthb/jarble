"use client";

import { createContext, useContext } from "react";
import { CANVAS_COMPONENTS } from "./registry";
import { useComponentCatalog } from "@/components/ComponentCatalogProvider";
import CustomComponentRenderer from "./CustomComponentRenderer";

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
 * validating props with Zod, and rendering. Falls back to custom component
 * resolution from the catalog, then to an error card.
 */
export default function CanvasRenderer({ block }: { block: UIBlock }) {
  const depth = useContext(CanvasDepthContext);
  const { getCustomComponent } = useComponentCatalog();

  if (depth >= MAX_DEPTH) {
    return (
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300">
        Max nesting depth reached ({MAX_DEPTH})
      </div>
    );
  }

  // 1. Try built-in registry
  const entry = CANVAS_COMPONENTS[block.component];

  if (entry) {
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

  // 2. Try custom component from catalog
  const customDef = getCustomComponent(block.component);
  if (customDef) {
    return (
      <CanvasDepthContext.Provider value={depth + 1}>
        <CustomComponentRenderer definition={customDef} props={block.props} />
      </CanvasDepthContext.Provider>
    );
  }

  // 3. Unknown component fallback
  return (
    <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300">
      Unknown component: <code>{block.component}</code>
    </div>
  );
}
