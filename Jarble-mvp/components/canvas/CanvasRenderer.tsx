"use client";

import { memo, createContext, useContext, Component, type ReactNode } from "react";
import { AlertTriangle, Wrench, X, RotateCcw } from "lucide-react";
import type { FixAttemptRecord } from "@/components/workspace/types";
import { FIX_ATTEMPT_LIMIT, FIX_ATTEMPT_WINDOW_MS } from "@/components/workspace/types";
import { CANVAS_COMPONENTS } from "./registry";
import { useComponentCatalog } from "@/components/ComponentCatalogProvider";
import CustomComponentRenderer from "./CustomComponentRenderer";
import { CanvasActionProvider, type CanvasAction } from "./CanvasActionContext";
import { autoFixProps } from "@/lib/autoFixProps";
import * as Sentry from "@sentry/nextjs";

const isDev = process.env.NODE_ENV === "development";

// Components that may be expensive to render — measure their render time
const EXPENSIVE_COMPONENTS = new Set(["sandbox", "code_editor", "map", "spreadsheet", "chart"]);

/** Check if fix attempts for a card have exceeded the rate limit. */
function isFixRateLimited(record: FixAttemptRecord | undefined): boolean {
  if (!record) return false;
  if (Date.now() - record.windowStart > FIX_ATTEMPT_WINDOW_MS) return false;
  return record.count >= FIX_ATTEMPT_LIMIT;
}

// ── Component Error Card ──────────────────────────────────────────────────────

function ComponentErrorCard({
  componentName,
  error,
  blockId,
  onAction,
  fixAttempt,
  onResetFixAttempts,
}: {
  componentName: string;
  error: string;
  blockId: string;
  onAction?: (action: CanvasAction) => void;
  fixAttempt?: FixAttemptRecord;
  onResetFixAttempts?: () => void;
}) {
  const rateLimited = isFixRateLimited(fixAttempt);

  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs space-y-3">
      <div className="flex items-start gap-2 text-red-400">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="font-medium">
            <code>{componentName}</code> failed to render
          </p>
          <p className="mt-1 text-red-400/80 break-words">{error}</p>
        </div>
      </div>
      {onAction && (
        <div className="flex items-center gap-2">
          {rateLimited ? (
            <button
              onClick={onResetFixAttempts}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-500/20 text-zinc-400 hover:bg-zinc-500/30 transition-colors text-xs font-medium"
            >
              <RotateCcw className="w-3 h-3" />
              Sandbox timed out — click to retry
            </button>
          ) : (
            <button
              onClick={() =>
                onAction({
                  blockId,
                  component: componentName,
                  action: "component_error",
                  payload: { error, component: componentName },
                })
              }
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors text-xs font-medium"
            >
              <Wrench className="w-3 h-3" />
              Fix Component
              {fixAttempt && fixAttempt.count > 0 && (
                <span className="text-amber-300/60 ml-1">({fixAttempt.count}/{FIX_ATTEMPT_LIMIT})</span>
              )}
            </button>
          )}
          <button
            onClick={() =>
              onAction({
                blockId,
                component: componentName,
                action: "component_abandon",
                payload: {},
              })
            }
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors text-xs font-medium"
          >
            <X className="w-3 h-3" />
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

// ── Error Boundary ────────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  componentName: string;
  blockId: string;
  onAction?: (action: CanvasAction) => void;
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

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[Jarble:Render] Error boundary caught error in ${this.props.componentName}: ${error.message}`);
    Sentry.captureException(error, {
      tags: { component: this.props.componentName },
      extra: { componentStack: errorInfo.componentStack },
    });
  }

  render() {
    if (this.state.error) {
      return (
        <ComponentErrorCard
          componentName={this.props.componentName}
          error={this.state.error.message}
          blockId={this.props.blockId}
          onAction={this.props.onAction}
        />
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
function CanvasRendererInner({
  block,
  onAction,
  fixAttempt,
  onRecordFixAttempt,
  onResetFixAttempts,
}: {
  block: UIBlock;
  onAction?: (action: CanvasAction) => void;
  fixAttempt?: FixAttemptRecord;
  onRecordFixAttempt?: () => void;
  onResetFixAttempts?: () => void;
}) {
  const depth = useContext(CanvasDepthContext);
  const { getCustomComponent } = useComponentCatalog();

  // Wrap onAction to record fix attempts on component_error actions
  const wrappedOnAction = onAction
    ? (action: CanvasAction) => {
        if (action.action === "component_error" && onRecordFixAttempt) {
          onRecordFixAttempt();
        }
        onAction(action);
      }
    : undefined;

  if (depth >= MAX_DEPTH) {
    return (
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300">
        Max nesting depth reached ({MAX_DEPTH})
      </div>
    );
  }

  // 0. Auto-fix props and normalize component name before validation
  const fixed = autoFixProps(block.component, block.props);

  if (fixed.repairs.length > 0) {
    // Dev logging
    if (isDev) {
      console.warn(
        `[CanvasRenderer] AutoFix applied ${fixed.repairs.length} repairs to ${fixed.component}:`,
        fixed.repairs,
      );
    }

    // Sentry breadcrumbs — track repair frequency for prompt tuning
    for (const repair of fixed.repairs) {
      Sentry.addBreadcrumb({
        category: "autofix",
        message: `${repair.rule} on ${fixed.component}.${repair.field}`,
        level: "info",
        data: {
          component: fixed.component,
          rule: repair.rule,
          field: repair.field,
          from: typeof repair.from === "object" ? JSON.stringify(repair.from).slice(0, 100) : String(repair.from),
          to: typeof repair.to === "object" ? JSON.stringify(repair.to).slice(0, 100) : String(repair.to),
        },
      });
    }

    // If 3+ repairs on a single component, capture a Sentry event for visibility
    if (fixed.repairs.length >= 3) {
      Sentry.captureMessage(
        `AutoFix: ${fixed.repairs.length} repairs on ${fixed.component}`,
        {
          level: "warning",
          tags: {
            component: fixed.component,
            repairCount: String(fixed.repairs.length),
          },
          extra: {
            repairs: fixed.repairs,
            originalComponent: block.component,
          },
        }
      );
    }
  }

  // 1. Try built-in registry (using normalized component name)
  const entry = CANVAS_COMPONENTS[fixed.component];

  if (entry) {
    const result = entry.propsSchema.safeParse(fixed.props);

    if (!result.success) {
      const errorMsg = result.error.issues.map((i) => i.message).join(", ");
      isDev && console.warn("[Jarble:Render] Zod validation FAILED for", fixed.component, ":", result.error.issues, "\n  Raw props:", fixed.props);
      return (
        <ComponentErrorCard
          componentName={fixed.component}
          error={`Invalid props: ${errorMsg}`}
          blockId={block.id}
          onAction={wrappedOnAction}
          fixAttempt={fixAttempt}
          onResetFixAttempts={onResetFixAttempts}
        />
      );
    }

    const Component = entry.component;
    const validatedProps = result.data as Record<string, unknown>;
    const isExpensive = EXPENSIVE_COMPONENTS.has(fixed.component);

    isDev && console.log("[Jarble:Render] Rendering", fixed.component, "— props keys:", Object.keys(validatedProps), "block:", block.id);

    // For expensive components, measure render time
    const renderStart = isExpensive ? Date.now() : 0;
    if (isDev && isExpensive) {
      // Use a microtask to measure after React renders
      requestAnimationFrame(() => {
        const elapsed = Date.now() - renderStart;
        if (elapsed > 100) {
          console.warn(`[Jarble:Render] Slow render: ${fixed.component} took ${elapsed}ms`);
        }
      });
    }

    return (
      <CanvasDepthContext.Provider value={depth + 1}>
        <CanvasErrorBoundary componentName={fixed.component} blockId={block.id} onAction={wrappedOnAction}>
          <CanvasActionProvider
            blockId={block.id}
            component={fixed.component}
            onAction={wrappedOnAction}
          >
            <div data-component={fixed.component} className="contents">
              <Component {...validatedProps} />
            </div>
          </CanvasActionProvider>
        </CanvasErrorBoundary>
      </CanvasDepthContext.Provider>
    );
  }

  // 2. Try custom component from catalog (using normalized name)
  const customDef = getCustomComponent(fixed.component);
  if (customDef) {
    isDev && console.log("[Jarble:Render] Rendering custom component:", fixed.component);
    return (
      <CanvasDepthContext.Provider value={depth + 1}>
        <CanvasErrorBoundary componentName={fixed.component} blockId={block.id} onAction={wrappedOnAction}>
          <CustomComponentRenderer definition={customDef} props={fixed.props} />
        </CanvasErrorBoundary>
      </CanvasDepthContext.Provider>
    );
  }

  // 3. Unknown component fallback
  isDev && console.warn(`[Jarble:Render] Unknown component: ${fixed.component}, showing fallback`);
  return (
    <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300">
      Unknown component: <code>{fixed.component}</code>
    </div>
  );
}

export default memo(CanvasRendererInner);
