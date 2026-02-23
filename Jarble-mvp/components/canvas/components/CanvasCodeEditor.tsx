"use client";

import dynamic from "next/dynamic";

const Editor = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="h-[300px] animate-pulse rounded bg-muted" />
  ),
});

export interface CanvasCodeEditorProps {
  code: string;
  language?: string;
  title?: string;
  readOnly?: boolean;
  height?: number;
}

export default function CanvasCodeEditor({
  code,
  language = "javascript",
  title,
  readOnly = true,
  height = 300,
}: CanvasCodeEditorProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>
      )}
      <div
        className="overflow-hidden rounded-lg border border-border"
        style={{ height }}
      >
        <Editor
          height="100%"
          language={language}
          value={code}
          theme="vs-dark"
          options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
            wordWrap: "on",
            padding: { top: 8 },
          }}
        />
      </div>
    </div>
  );
}
