"use client";

import type { EditorProps } from "./registry";

export default function CodeBlockEditor({ props, onChange }: EditorProps) {
  const title = (props.title as string) || "";
  const language = (props.language as string) || "";
  const code = (props.code as string) || "";

  const update = (patch: Partial<typeof props>) => {
    onChange({ ...props, ...patch });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        <input
          type="text"
          value={title}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="Title (optional)"
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <input
          type="text"
          value={language}
          onChange={(e) => update({ language: e.target.value })}
          placeholder="Language"
          className="w-28 rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>
      <textarea
        value={code}
        onChange={(e) => update({ code: e.target.value })}
        placeholder="Code"
        rows={8}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50 resize-y"
      />
    </div>
  );
}
