"use client";

/**
 * CustomComponentRenderer — Resolves a custom component template and
 * renders the resulting built-in primitives via CanvasRenderer.
 */

import { resolveCustomComponent, type ComponentDefinition } from "@/lib/component-catalog";
import CanvasRenderer from "./CanvasRenderer";

interface CustomComponentRendererProps {
  definition: ComponentDefinition;
  props: Record<string, unknown>;
}

export default function CustomComponentRenderer({
  definition,
  props,
}: CustomComponentRendererProps) {
  if (!definition?.layout) {
    console.warn("[Jarble:Custom] Missing layout for custom component:", definition?.name);
    return (
      <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300">
        Custom component missing definition
      </div>
    );
  }

  const resolvedBlocks = resolveCustomComponent(definition, props);
  console.log("[Jarble:Custom] Resolved", definition.name, "→", resolvedBlocks.length, "blocks:", resolvedBlocks.map(b => b.component).join(", "));

  return (
    <div className="space-y-3">
      {resolvedBlocks.map((block, i) => (
        <CanvasRenderer
          key={`custom-${definition.name}-${i}`}
          block={{
            id: `custom-${definition.name}-${i}`,
            component: block.component,
            props: block.props,
          }}
        />
      ))}
    </div>
  );
}
