"use client";

export interface CanvasProgressProps {
  label?: string;
  value: number;
  variant?: "default" | "success" | "warning" | "error";
}

const BAR_COLORS: Record<string, string> = {
  default: "bg-primary",
  success: "bg-green-500",
  warning: "bg-yellow-500",
  error: "bg-red-500",
};

export default function CanvasProgress({ label, value, variant = "default" }: CanvasProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        {label && <span className="text-xs text-muted-foreground">{label}</span>}
        <span className="text-xs font-medium text-foreground">{clamped}%</span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${BAR_COLORS[variant] || BAR_COLORS.default}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
