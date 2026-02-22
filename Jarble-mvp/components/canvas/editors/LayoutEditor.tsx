"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { EDITOR_COMPONENTS, type EditorProps } from "./registry";
import FallbackJsonEditor from "./FallbackJsonEditor";

interface LayoutChild {
  component: string;
  props: Record<string, unknown>;
}

export default function LayoutEditor({ props, onChange }: EditorProps) {
  const title = (props.title as string) || "";
  const children = (props.children as LayoutChild[]) || [];
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});

  const update = (patch: Partial<typeof props>) => {
    onChange({ ...props, ...patch });
  };

  const updateChild = (idx: number, childProps: Record<string, unknown>) => {
    const next = children.map((c, i) =>
      i === idx ? { ...c, props: childProps } : c
    );
    update({ children: next });
  };

  const toggleCollapse = (idx: number) => {
    setCollapsed((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={title}
        onChange={(e) => update({ title: e.target.value })}
        placeholder="Layout title (optional)"
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary/50"
      />

      <div className="space-y-2">
        {children.map((child, i) => {
          const ChildEditor = EDITOR_COMPONENTS[child.component] || FallbackJsonEditor;
          const isCollapsed = collapsed[i];

          return (
            <div
              key={i}
              className="rounded-lg border border-border/60 bg-background/50 overflow-hidden"
            >
              <button
                onClick={() => toggleCollapse(i)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
                <span className="font-mono text-primary/70">{child.component}</span>
                <span className="text-muted-foreground/60">#{i + 1}</span>
              </button>

              {!isCollapsed && (
                <div className="px-3 pb-3">
                  <ChildEditor
                    props={child.props}
                    onChange={(newProps) => updateChild(i, newProps)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
