"use client";

import type { EditorProps } from "./registry";

export default function CardEditor({ props, onChange }: EditorProps) {
  const title = (props.title as string) || "";
  const subtitle = (props.subtitle as string) || "";
  const body = (props.body as string) || "";

  const update = (patch: Partial<typeof props>) => {
    onChange({ ...props, ...patch });
  };

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={title}
        onChange={(e) => update({ title: e.target.value })}
        placeholder="Title"
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary/50"
      />
      <input
        type="text"
        value={subtitle}
        onChange={(e) => update({ subtitle: e.target.value })}
        placeholder="Subtitle (optional)"
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
      />
      <textarea
        value={body}
        onChange={(e) => update({ body: e.target.value })}
        placeholder="Body text"
        rows={4}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-y"
      />
    </div>
  );
}
