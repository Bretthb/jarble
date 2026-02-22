"use client";

export interface CanvasAlertProps {
  title?: string;
  message: string;
  variant: "info" | "success" | "warning" | "error";
}

const VARIANT_STYLES: Record<CanvasAlertProps["variant"], string> = {
  info: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  success: "border-green-500/30 bg-green-500/10 text-green-300",
  warning: "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
  error: "border-red-500/30 bg-red-500/10 text-red-300",
};

const VARIANT_ICONS: Record<CanvasAlertProps["variant"], string> = {
  info: "ℹ️",
  success: "✅",
  warning: "⚠️",
  error: "❌",
};

export default function CanvasAlert({ title, message, variant }: CanvasAlertProps) {
  const style = VARIANT_STYLES[variant] || VARIANT_STYLES.info;

  return (
    <div className={`rounded-xl border p-4 ${style}`}>
      <div className="flex items-start gap-2.5">
        <span className="text-base shrink-0">{VARIANT_ICONS[variant]}</span>
        <div className="space-y-0.5">
          {title && <p className="text-sm font-semibold">{title}</p>}
          <p className="text-sm opacity-90">{message}</p>
        </div>
      </div>
    </div>
  );
}
