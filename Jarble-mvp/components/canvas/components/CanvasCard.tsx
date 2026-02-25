"use client";

export interface CanvasCardProps {
  title?: string;
  subtitle?: string;
  body?: string;
}

export default function CanvasCard({ title, subtitle, body }: CanvasCardProps) {
  return (
    <div className="p-3 h-full space-y-1.5">
      {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      {body && <p className="text-sm text-foreground/90 whitespace-pre-wrap">{body}</p>}
    </div>
  );
}
