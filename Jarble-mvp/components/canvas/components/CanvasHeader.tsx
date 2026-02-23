"use client";

export interface CanvasHeaderProps {
  title: string;
  subtitle?: string;
  level?: 1 | 2 | 3;
  divider?: boolean;
}

const LEVEL_STYLES: Record<number, string> = {
  1: "text-lg font-bold",
  2: "text-base font-semibold",
  3: "text-sm font-semibold",
};

export default function CanvasHeader({ title, subtitle, level = 2, divider = false }: CanvasHeaderProps) {
  const headingStyle = LEVEL_STYLES[level] || LEVEL_STYLES[2];

  return (
    <div className={divider ? "pb-2 border-b border-border" : ""}>
      <h3 className={`${headingStyle} text-foreground`}>{title}</h3>
      {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
  );
}
