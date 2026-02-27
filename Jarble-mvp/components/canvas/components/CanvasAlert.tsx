"use client";

import React from "react";
import { motion } from "framer-motion";

export interface CanvasAlertProps {
  title?: string;
  message: string;
  variant: "info" | "success" | "warning" | "error";
}

const VARIANT_STYLES: Record<CanvasAlertProps["variant"], { container: string; accent: string; iconBg: string }> = {
  info: {
    container: "text-blue-700 dark:text-blue-300",
    accent: "bg-blue-500",
    iconBg: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  },
  success: {
    container: "text-emerald-700 dark:text-emerald-300",
    accent: "bg-emerald-500",
    iconBg: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  warning: {
    container: "text-amber-700 dark:text-amber-300",
    accent: "bg-amber-500",
    iconBg: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  error: {
    container: "text-red-700 dark:text-red-300",
    accent: "bg-red-500",
    iconBg: "bg-red-500/15 text-red-600 dark:text-red-400",
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

export default function CanvasAlert({ title, message, variant }: CanvasAlertProps) {
  const styles = VARIANT_STYLES[variant] || VARIANT_STYLES.info;
  const Icon = VARIANT_ICONS[variant] || VARIANT_ICONS.info;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={`relative overflow-hidden rounded-xl border border-border/40 bg-card/60 backdrop-blur-sm shadow-sm ${styles.container}`}
    >
      {/* Left accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${styles.accent}`} />

      <div className="flex items-start gap-3 p-4 pl-5">
        <span className={`inline-flex items-center justify-center h-7 w-7 rounded-full shrink-0 ${styles.iconBg}`}>
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
