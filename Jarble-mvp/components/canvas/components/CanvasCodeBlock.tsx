"use client";

export interface CanvasCodeBlockProps {
  code: string;
  language?: string;
  title?: string;
}

export default function CanvasCodeBlock({ code, language, title }: CanvasCodeBlockProps) {
  return (
    <div className="h-full overflow-hidden">
      {(title || language) && (
        <div className="px-3 py-2 flex items-center justify-between bg-secondary/30">
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
