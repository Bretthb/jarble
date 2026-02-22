"use client";

import CanvasRenderer from "../CanvasRenderer";

export interface LayoutChild {
  component: string;
  props: Record<string, unknown>;
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
      {children.map((child, i) => (
        <CanvasRenderer
          key={`child-${i}`}
          block={{
            id: `child-${i}`,
            component: child.component,
            props: child.props,
          }}
        />
      ))}
    </div>
  );
}
