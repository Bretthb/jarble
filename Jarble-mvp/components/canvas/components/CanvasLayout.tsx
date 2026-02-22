"use client";

import CanvasRenderer from "../CanvasRenderer";

export interface LayoutChild {
  component: string;
  /** Props as JSON string (for Tambo schema compat) or raw object (from bot) */
  propsJson?: string;
  props?: Record<string, unknown>;
}

export interface CanvasLayoutProps {
  title?: string;
  children: LayoutChild[];
}

export default function CanvasLayout({ title, children }: CanvasLayoutProps) {
  if (!Array.isArray(children) || children.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {title && (
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      )}
      {children.map((child, i) => {
        // Support both propsJson (from Tambo) and props (from bot direct)
        let resolvedProps: Record<string, unknown> = {};
        if (child.props) {
          resolvedProps = child.props;
        } else if (child.propsJson) {
          try { resolvedProps = JSON.parse(child.propsJson); } catch { /* empty */ }
        }
        return (
          <CanvasRenderer
            key={`child-${i}`}
            block={{
              id: `child-${i}`,
              component: child.component,
              props: resolvedProps,
            }}
          />
        );
      })}
    </div>
  );
}
