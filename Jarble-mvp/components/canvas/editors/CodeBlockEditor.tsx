"use client";

import type { EditorProps } from "./registry";

const LANGUAGES = [
  "javascript",
  "typescript",
  "python",
  "bash",
  "json",
  "html",
  "css",
  "go",
  "rust",
  "sql",
];

export default function CodeBlockEditor({ props, onChange, disabled }: EditorProps) {
  const title = (props.title as string) || "";
  const language = (props.language as string) || "";
  const code = (props.code as string) || "";

  const update = (patch: Partial<typeof props>) => {
    onChange({ ...props, ...patch });
  };

  const isCustomLanguage = language && !LANGUAGES.includes(language);

  return (
    <fieldset disabled={disabled} className="space-y-2">
      <div className="flex gap-1.5">
        <input
          type="text"
          value={title}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="Title (optional)"
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
        />
        <select
          value={isCustomLanguage ? "__other__" : language}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "__other__") {
              update({ language: "" });
            } else {
              update({ language: val });
            }
          }}
          className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
        >
          <option value="">Language...</option>
          {LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>
              {lang}
            </option>
          ))}
          <option value="__other__">Other</option>
        </select>
        {(isCustomLanguage || language === "") && (
          <input
            type="text"
            value={isCustomLanguage ? language : ""}
            onChange={(e) => update({ language: e.target.value })}
            placeholder="Custom"
            className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
          />
        )}
      </div>
      <textarea
        value={code}
        onChange={(e) => update({ code: e.target.value })}
        placeholder="Code"
        rows={8}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50 resize-y disabled:opacity-50"
      />
    </fieldset>
  );
}
