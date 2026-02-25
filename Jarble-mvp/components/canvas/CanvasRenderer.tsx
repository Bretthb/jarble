"use client";

import { createContext, useContext, Component, type ReactNode } from "react";
import { CANVAS_COMPONENTS } from "./registry";
import { useComponentCatalog } from "@/components/ComponentCatalogProvider";
import CustomComponentRenderer from "./CustomComponentRenderer";
import { CanvasActionProvider, type CanvasAction } from "./CanvasActionContext";

// Components that may be expensive to render — measure their render time
const EXPENSIVE_COMPONENTS = new Set(["sandbox", "code_editor", "map", "stock", "heatmap", "treemap", "sankey"]);

// ── Error Boundary ────────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  componentName: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class CanvasErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[Jarble:Render] Error boundary caught error in ${this.props.componentName}: ${error.message}`);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
          <code>{this.props.componentName}</code> failed to render:{" "}
          {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

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
export default function CanvasRenderer({
  block,
  onAction,
}: {
  block: UIBlock;
  onAction?: (action: CanvasAction) => void;
}) {
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
      console.warn("[Jarble:Render] Zod validation FAILED for", block.component, ":", result.error.issues, "\n  Raw props:", block.props);
      return (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
          Invalid props for <code>{block.component}</code>:{" "}
          {result.error.issues.map((i) => i.message).join(", ")}
        </div>
      );
    }

    const Component = entry.component;
    const validatedProps = result.data as Record<string, unknown>;
    const isExpensive = EXPENSIVE_COMPONENTS.has(block.component);

    console.log("[Jarble:Render] Rendering", block.component, "— props keys:", Object.keys(validatedProps), "block:", block.id);

    // For expensive components, measure render time
    const renderStart = isExpensive ? Date.now() : 0;
    if (isExpensive) {
      // Use a microtask to measure after React renders
      requestAnimationFrame(() => {
        const elapsed = Date.now() - renderStart;
        if (elapsed > 100) {
          console.warn(`[Jarble:Render] Slow render: ${block.component} took ${elapsed}ms`);
        }
      });
    }

    return (
      <CanvasDepthContext.Provider value={depth + 1}>
        <CanvasErrorBoundary componentName={block.component}>
          <CanvasActionProvider
            blockId={block.id}
            component={block.component}
            onAction={onAction}
          >
            <Component {...validatedProps} />
          </CanvasActionProvider>
        </CanvasErrorBoundary>
      </CanvasDepthContext.Provider>
    );
  }

  // 2. Try custom component from catalog
  const customDef = getCustomComponent(block.component);
  if (customDef) {
    console.log("[Jarble:Render] Rendering custom component:", block.component);
    return (
      <CanvasDepthContext.Provider value={depth + 1}>
        <CanvasErrorBoundary componentName={block.component}>
          <CustomComponentRenderer definition={customDef} props={block.props} />
        </CanvasErrorBoundary>
      </CanvasDepthContext.Provider>
    );
  }

  // 3. Unknown component fallback
  console.warn(`[Jarble:Render] Unknown component: ${block.component}, showing fallback`);
  return (
    <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300">
      Unknown component: <code>{block.component}</code>
    </div>
  );
}
