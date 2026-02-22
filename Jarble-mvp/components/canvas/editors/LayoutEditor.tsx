"use client";

import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { EDITOR_COMPONENTS, type EditorProps } from "./registry";
import FallbackJsonEditor from "./FallbackJsonEditor";

interface LayoutChild {
  component: string;
  props: Record<string, unknown>;
}

const COMPONENT_TYPES = [
  "card",
  "data_table",
  "key_value",
  "stat_grid",
  "alert",
  "code_block",
  "progress",
];

export default function LayoutEditor({ props, onChange, disabled }: EditorProps) {
  const title = (props.title as string) || "";
  const children = (props.children as LayoutChild[]) || [];
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);

  const update = (patch: Partial<typeof props>) => {
    onChange({ ...props, ...patch });
  };

  const updateChild = (idx: number, childProps: Record<string, unknown>) => {
    const next = children.map((c, i) =>
      i === idx ? { ...c, props: childProps } : c
    );
    update({ children: next });
  };

  const removeChild = (idx: number) => {
    update({ children: children.filter((_, i) => i !== idx) });
    setConfirmRemove(null);
    // Adjust collapsed state
    setCollapsed((prev) => {
      const next: Record<number, boolean> = {};
      for (const [k, v] of Object.entries(prev)) {
        const ki = Number(k);
        if (ki < idx) next[ki] = v;
        else if (ki > idx) next[ki - 1] = v;
      }
      return next;
    });
  };

  const addChild = (component: string) => {
    update({ children: [...children, { component, props: {} }] });
  };

  const toggleCollapse = (idx: number) => {
    setCollapsed((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <fieldset disabled={disabled} className="space-y-2">
      <input
        type="text"
        value={title}
        onChange={(e) => update({ title: e.target.value })}
        placeholder="Layout title (optional)"
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
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
              <div className="flex items-center">
                <button
                  onClick={() => toggleCollapse(i)}
                  className="flex-1 flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  <span className="font-mono text-primary/70">{child.component}</span>
                  <span className="text-muted-foreground/60">#{i + 1}</span>
                </button>

                {confirmRemove === i ? (
                  <div className="flex items-center gap-1 px-2">
                    <button
                      onClick={() => removeChild(i)}
                      className="px-2 py-0.5 text-[10px] font-medium rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmRemove(null)}
                      className="px-2 py-0.5 text-[10px] font-medium rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmRemove(i)}
                    className="p-1.5 mr-1 text-muted-foreground/50 hover:text-red-400 transition-colors"
                    title="Remove component"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {!isCollapsed && (
                <div className="px-3 pb-3">
                  <ChildEditor
                    props={child.props}
                    onChange={(newProps) => updateChild(i, newProps)}
                    disabled={disabled}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add component picker */}
      <div className="relative group/add">
        <button
          type="button"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border border-border/60 bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors peer disabled:opacity-40"
        >
          <Plus className="w-3 h-3" />
          Add component
        </button>
        <div className="hidden group-focus-within/add:block absolute bottom-full left-0 mb-1 z-10 rounded-md border border-border bg-background shadow-lg p-1 min-w-[140px]">
          {COMPONENT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => addChild(type)}
              className="w-full text-left px-3 py-1.5 text-xs font-mono rounded hover:bg-secondary transition-colors"
            >
              {type}
            </button>
          ))}
        </div>
      </div>
    </fieldset>
  );
}
