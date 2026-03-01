"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, XCircle, Info, AlertTriangle } from "lucide-react";

export interface CanvasResultProps {
  status: "success" | "error" | "info" | "warning";
  title: string;
  subtitle?: string;
  extra?: string;
}

const statusConfig = {
  success: {
    icon: CheckCircle2,
    colorClass: "text-emerald-500",
  },
  error: {
    icon: XCircle,
    colorClass: "text-red-500",
  },
  info: {
    icon: Info,
    colorClass: "text-blue-500",
  },
  warning: {
    icon: AlertTriangle,
    colorClass: "text-amber-500",
  },
} as const;

function CanvasResultInner({
  status,
  title,
  subtitle,
}: CanvasResultProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="p-4 h-full"
    >
      <div className="flex flex-col items-center justify-center gap-3 py-6">
        <Icon className={`w-12 h-12 ${config.colorClass}`} />
        <h3 className="text-lg font-semibold text-foreground text-center">
          {title}
        </h3>
        {subtitle && (
          <p className="text-sm text-muted-foreground text-center max-w-md">
            {subtitle}
          </p>
        )}
      </div>
    </motion.div>
  );
}

export default memo(CanvasResultInner);
