"use client";

import React, { memo } from "react";
import { motion } from "framer-motion";

export interface CanvasAlertProps {
  title?: string;
  message: string;
  variant: "info" | "success" | "warning" | "error";
}

const VARIANT_STYLES: Record<
  CanvasAlertProps["variant"],
  { text: string; gradient: string; iconBg: string; bgTint: string; iconShadow: string }
> = {
  info: {
    text: "text-blue-700 dark:text-blue-300",
    gradient: "from-blue-400 to-blue-600",
    iconBg: "bg-blue-100 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400",
    bgTint: "bg-gradient-to-br from-blue-50/40 to-transparent dark:from-blue-950/15 dark:to-transparent",
    iconShadow: "shadow-blue-500/20 dark:shadow-blue-400/10",
  },
  success: {
    text: "text-emerald-700 dark:text-emerald-300",
    gradient: "from-emerald-400 to-emerald-600",
    iconBg: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    bgTint: "bg-gradient-to-br from-emerald-50/40 to-transparent dark:from-emerald-950/15 dark:to-transparent",
    iconShadow: "shadow-emerald-500/20 dark:shadow-emerald-400/10",
  },
  warning: {
    text: "text-amber-700 dark:text-amber-300",
    gradient: "from-amber-400 to-amber-600",
    iconBg: "bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400",
    bgTint: "bg-gradient-to-br from-amber-50/40 to-transparent dark:from-amber-950/15 dark:to-transparent",
    iconShadow: "shadow-amber-500/20 dark:shadow-amber-400/10",
  },
  error: {
    text: "text-red-700 dark:text-red-300",
    gradient: "from-red-400 to-red-600",
    iconBg: "bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400",
    bgTint: "bg-gradient-to-br from-red-50/40 to-transparent dark:from-red-950/15 dark:to-transparent",
    iconShadow: "shadow-red-500/20 dark:shadow-red-400/10",
  },
};

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="5" r="0.75" fill="currentColor" />
    </svg>
  );
}

function SuccessIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 8l1.75 1.75L10.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5L14.5 13.5H1.5L8 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const VARIANT_ICONS: Record<CanvasAlertProps["variant"], () => React.ReactNode> = {
  info: InfoIcon,
  success: SuccessIcon,
  warning: WarningIcon,
  error: ErrorIcon,
};

function CanvasAlertInner({ title, message, variant }: CanvasAlertProps) {
  const styles = VARIANT_STYLES[variant] || VARIANT_STYLES.info;
  const Icon = VARIANT_ICONS[variant] || VARIANT_ICONS.info;

  return (
    <motion.div
      role="alert"
      aria-live="polite"
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={[
        "relative overflow-hidden rounded-xl",
        "border border-border/40",
        "shadow-sm hover:shadow-md dark:shadow-md dark:shadow-black/15",
        "dark:bg-white/[0.03] dark:backdrop-blur-sm",
        "transition-shadow duration-300",
        styles.text,
        styles.bgTint,
      ].join(" ")}
    >
      {/* Gradient left accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl bg-gradient-to-b ${styles.gradient}`} />

      <div className="flex items-start gap-3 p-4 pl-5">
        {/* Icon circle with shadow */}
        <span
          className={[
            "inline-flex items-center justify-center h-7 w-7 rounded-full shrink-0",
            "shadow-sm",
            styles.iconBg,
            styles.iconShadow,
          ].join(" ")}
        >
          <Icon />
        </span>
        <div className="space-y-1 min-w-0">
          {title && <p className="text-sm font-semibold leading-tight">{title}</p>}
          <p className="text-sm opacity-90 leading-relaxed">{message}</p>
        </div>
      </div>
    </motion.div>
  );
}

export default memo(CanvasAlertInner);
