"use client";

import { memo, useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useCanvasAction } from "../CanvasActionContext";
import { FadeIn } from "../FadeIn";

interface ActionDef {
  id: string;
  label: string;
}

export interface CanvasConfirmationProps {
  title: string;
  description: string;
  severity: "info" | "warning" | "danger";
  actions: ActionDef[];
  confirmationId: string;
  timeout?: number;
  status?: "pending" | "approved" | "rejected" | "expired";
  selectedActionId?: string;
  metadata?: Record<string, unknown>;
}

const SEVERITY_CONFIG = {
  info: {
    border: "border-blue-500/40",
    bg: "bg-blue-500/5",
    headerBg: "bg-blue-500/10",
    icon: (
      <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
      </svg>
    ),
    buttonPrimary: "bg-blue-600 hover:bg-blue-700 text-white",
    pulse: "bg-blue-400",
    text: "text-blue-400",
  },
  warning: {
    border: "border-amber-500/40",
    bg: "bg-amber-500/5",
    headerBg: "bg-amber-500/10",
    icon: (
      <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
    ),
    buttonPrimary: "bg-amber-600 hover:bg-amber-700 text-white",
    pulse: "bg-amber-400",
    text: "text-amber-400",
  },
  danger: {
    border: "border-red-500/40",
    bg: "bg-red-500/5",
    headerBg: "bg-red-500/10",
    icon: (
      <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
    buttonPrimary: "bg-red-600 hover:bg-red-700 text-white",
    pulse: "bg-red-400",
    text: "text-red-400",
  },
} as const;

function CanvasConfirmationInner({
  title,
  description,
  severity = "info",
  actions,
  confirmationId,
  timeout,
  status: initialStatus,
  selectedActionId: initialSelectedId,
}: CanvasConfirmationProps) {
  let dispatch: ReturnType<typeof useCanvasAction>["dispatch"] | null = null;
  try {
    const ctx = useCanvasAction();
    dispatch = ctx.dispatch;
  } catch {
    // Not inside CanvasActionProvider -- interactivity disabled
  }
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "expired">(initialStatus || "pending");
  const [selectedActionId, setSelectedActionId] = useState<string | null>(initialSelectedId || null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(timeout ?? null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.info;
  const isPending = status === "pending";

  // Sync from prop updates (e.g., when parent updates card props after response)
  useEffect(() => {
    if (initialStatus && initialStatus !== "pending") {
      setStatus(initialStatus);
    }
    if (initialSelectedId) {
      setSelectedActionId(initialSelectedId);
    }
  }, [initialStatus, initialSelectedId]);

  // Countdown timer
  useEffect(() => {
    if (!timeout || !isPending) return;

    timerRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev === null || prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          setStatus("expired");
          dispatch?.({
            action: "confirmation_response",
            payload: { confirmationId, actionId: null, status: "expired" },
          });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timeout, isPending, confirmationId, dispatch]);

  const handleAction = useCallback(
    (actionId: string) => {
      if (!isPending) return;
      setSelectedActionId(actionId);
      // Determine status from action - first action is treated as "approve", others as "reject"
      const isApprove = actions.length > 0 && actions[0].id === actionId;
      const newStatus = isApprove ? "approved" : "rejected";
      setStatus(newStatus);
      if (timerRef.current) clearInterval(timerRef.current);
      dispatch?.({
        action: "confirmation_response",
        payload: { confirmationId, actionId, status: newStatus },
      });
    },
    [isPending, actions, confirmationId, dispatch]
  );

  // Status badge for resolved states
  const statusBadge = !isPending && (
    <div className="flex items-center gap-1.5 text-xs font-medium mt-2">
      {status === "approved" && (
        <span className="inline-flex items-center gap-1 text-emerald-400">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          Approved
        </span>
      )}
      {status === "rejected" && (
        <span className="inline-flex items-center gap-1 text-red-400">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          Rejected
        </span>
      )}
      {status === "expired" && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Expired
        </span>
      )}
    </div>
  );

  return (
    <FadeIn
      className={`p-3 h-full rounded-lg border ${config.border} ${config.bg}`}
      role="alertdialog"
      aria-label={title}
    >
      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-2 -mx-3 -mt-3 mb-3 rounded-t-lg ${config.headerBg}`}>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {config.icon}
          <h3 className="text-sm font-semibold text-foreground truncate">{title}</h3>
        </div>
        {isPending && (
          <span className="relative flex h-2 w-2 shrink-0">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.pulse} opacity-75`} />
            <span className={`relative inline-flex rounded-full h-2 w-2 ${config.pulse}`} />
          </span>
        )}
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground leading-relaxed mb-3">{description}</p>

      {/* Timer */}
      <AnimatePresence>
        {isPending && timeRemaining !== null && timeRemaining > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Expires in {timeRemaining}s
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {actions.map((action, idx) => {
          const isSelected = selectedActionId === action.id;
          const isFirst = idx === 0;
          const buttonStyle = isPending
            ? isFirst
              ? config.buttonPrimary
              : "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border"
            : isSelected
              ? `${isFirst ? config.buttonPrimary : "bg-secondary text-secondary-foreground border border-border"} ring-2 ring-offset-1 ring-offset-background ${isFirst ? "ring-blue-500/30" : "ring-border"}`
              : "opacity-40 bg-secondary text-secondary-foreground border border-border cursor-default";

          return (
            <button
              key={action.id}
              onClick={() => handleAction(action.id)}
              disabled={!isPending}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium transition-all disabled:cursor-not-allowed ${buttonStyle}`}
            >
              {action.label}
            </button>
          );
        })}
      </div>

      {/* Status badge */}
      {statusBadge}
    </FadeIn>
  );
}

export default memo(CanvasConfirmationInner);
