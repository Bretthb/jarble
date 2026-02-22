"use client";

export interface CanvasCodeBlockProps {
  code: string;
  language?: string;
  title?: string;
}

export default function CanvasCodeBlock({ code, language, title }: CanvasCodeBlockProps) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {(title || language) && (
        <div className="px-4 py-2 border-b border-border flex items-center justify-between">
          {title && <span className="text-xs font-medium text-foreground">{title}</span>}
          {language && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{language}</span>}
        </div>
      )}
      <pre className="p-4 overflow-x-auto text-xs leading-relaxed text-foreground/90 bg-secondary/20">
        <code>{code}</code>
      </pre>
    </div>
  );
}
