"use client";

import { useState } from "react";
import type { EditorProps } from "./registry";

export default function FallbackJsonEditor({ props, onChange }: EditorProps) {
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

  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">Edit JSON props</label>
      <textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        rows={10}
        className={`w-full rounded-md border px-3 py-2 text-xs font-mono bg-background focus:outline-none focus:ring-1 resize-y ${
          isValid
            ? "border-border focus:ring-primary/50"
            : "border-red-500 focus:ring-red-500/50"
        }`}
      />
      {!isValid && (
        <p className="text-xs text-red-400">Invalid JSON</p>
      )}
    </div>
  );
}
