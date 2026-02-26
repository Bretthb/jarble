"use client";

export interface CanvasAlertProps {
  title?: string;
  message: string;
  variant: "info" | "success" | "warning" | "error";
}

const VARIANT_STYLES: Record<CanvasAlertProps["variant"], string> = {
  info: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  error: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
};

const VARIANT_ICONS: Record<CanvasAlertProps["variant"], string> = {
  info: "\u2139\uFE0F",
  success: "\u2705",
  warning: "\u26A0\uFE0F",
  error: "\u274C",
};

export default function CanvasAlert({ title, message, variant }: CanvasAlertProps) {
  const style = VARIANT_STYLES[variant] || VARIANT_STYLES.info;

  return (
    <div className={`rounded-xl border p-4 ${style}`}>
      <div className="flex items-start gap-2.5">
        <span className="text-base shrink-0">{VARIANT_ICONS[variant]}</span>
        <div className="space-y-1">
          {title && <p className="text-sm font-semibold">{title}</p>}
          <p className="text-sm opacity-90 leading-relaxed">{message}</p>
        </div>
      </div>
    </div>
  );
}
