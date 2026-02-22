"use client";

import type { EditorProps } from "./registry";

const VARIANTS = ["info", "success", "warning", "error"] as const;

export default function AlertEditor({ props, onChange }: EditorProps) {
  const title = (props.title as string) || "";
  const message = (props.message as string) || "";
  const variant = (props.variant as string) || "info";

  const update = (patch: Partial<typeof props>) => {
    onChange({ ...props, ...patch });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {VARIANTS.map((v) => (
          <button
            key={v}
            onClick={() => update({ variant: v })}
            className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
              variant === v
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/60 bg-secondary/50 text-muted-foreground hover:bg-secondary"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={title}
        onChange={(e) => update({ title: e.target.value })}
        placeholder="Title (optional)"
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
      />
      <textarea
        value={message}
        onChange={(e) => update({ message: e.target.value })}
        placeholder="Message"
        rows={3}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-y"
      />
    </div>
  );
}
