"use client";

import { useState } from "react";
import { Braces } from "lucide-react";
import type { EditorProps } from "./registry";

export default function FallbackJsonEditor({ props, onChange, disabled }: EditorProps) {
  const [text, setText] = useState(JSON.stringify(props, null, 2));
  const [isValid, setIsValid] = useState(true);

  const handleChange = (value: string) => {
    setText(value);
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null) {
        setIsValid(true);
        onChange(parsed);
      } else {
        setIsValid(false);
      }
    } catch {
      setIsValid(false);
    }
  };

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(text);
      const formatted = JSON.stringify(parsed, null, 2);
      setText(formatted);
      if (typeof parsed === "object" && parsed !== null) {
        setIsValid(true);
        onChange(parsed);
      }
    } catch {
      // Can't format invalid JSON — no-op
    }
  };

  // Try to extract the component type from props context
  const componentType = (props as any).__component as string | undefined;

  return (
    <fieldset disabled={disabled} className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">
          {componentType ? (
            <>
              Edit <span className="font-mono text-primary/70">{componentType}</span> props
            </>
          ) : (
            "Edit JSON props"
          )}
        </label>
        <button
          type="button"
          onClick={handleFormat}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-muted-foreground hover:text-foreground border border-border/60 bg-secondary/30 hover:bg-secondary transition-colors disabled:opacity-40"
          title="Format JSON"
        >
          <Braces className="w-3 h-3" />
          Format
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        rows={10}
        className={`w-full rounded-md border px-3 py-2 text-xs font-mono bg-background focus:outline-none focus:ring-1 resize-y disabled:opacity-50 ${
          isValid
            ? "border-border focus:ring-primary/50"
            : "border-red-500 focus:ring-red-500/50"
        }`}
      />
      {!isValid && (
        <p className="text-xs text-red-400">Invalid JSON</p>
      )}
    </fieldset>
  );
}
