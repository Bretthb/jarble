"use client";

import { memo, useState } from "react";
import { AlertTriangle, RefreshCw, Play, Stethoscope, CheckCircle2, AlertCircle, XCircle, MinusCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DiagnosticCheck, DiagnosticResult } from "@/hooks/useDiagnose";

export interface ClassifiedChatError {
  code: string;
  message: string;
  suggestion: string;
  canRetry: boolean;
  canStart: boolean;
  canDiagnose: boolean;
}

interface ChatErrorCardProps {
  error: ClassifiedChatError;
  onRetry?: () => void;
  onStartBot?: () => void;
  onDiagnose?: () => void;
  diagnosis: DiagnosticResult | null;
  isDiagnosing: boolean;
}

const STATUS_ICONS: Record<DiagnosticCheck["status"], typeof CheckCircle2> = {
  ok: CheckCircle2,
  warning: AlertCircle,
  error: XCircle,
  skipped: MinusCircle,
};

const STATUS_COLORS: Record<DiagnosticCheck["status"], string> = {
  ok: "text-emerald-400",
  warning: "text-amber-400",
  error: "text-red-400",
  skipped: "text-muted-foreground-subtle",
};

function ChatErrorCardInner({
  error,
  onRetry,
  onStartBot,
  onDiagnose,
  diagnosis,
  isDiagnosing,
}: ChatErrorCardProps) {
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);

  const showDiagnosis = diagnosis && diagnosisOpen;

  return (
    <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-3">
      {/* Error header */}
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-red-400">{error.message}</p>
          <p className="text-xs text-muted-foreground mt-1">{error.suggestion}</p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        {error.canRetry && onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="h-7 text-xs gap-1.5">
            <RefreshCw className="w-3 h-3" />
            Retry
          </Button>
        )}
        {error.canDiagnose && onDiagnose && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onDiagnose();
              setDiagnosisOpen(true);
            }}
            disabled={isDiagnosing}
            className="h-7 text-xs gap-1.5"
          >
            <Stethoscope className={cn("w-3 h-3", isDiagnosing && "animate-pulse")} />
            {isDiagnosing ? "Diagnosing..." : "Diagnose"}
          </Button>
        )}
        {error.canStart && onStartBot && (
          <Button variant="default" size="sm" onClick={onStartBot} className="h-7 text-xs gap-1.5">
            <Play className="w-3 h-3" />
            Start Bot
          </Button>
        )}
      </div>

      {/* Diagnosis results (collapsible) */}
      {diagnosis && (
        <div className="border-t border-border/40 pt-2 mt-2">
          <button
            onClick={() => setDiagnosisOpen((v) => !v)}
            aria-expanded={diagnosisOpen}
            aria-controls="diagnosis-results"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            {diagnosisOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            <span>
              Diagnosis Results
              <span className={cn(
                "ml-1.5 font-medium",
                diagnosis.overallHealth === "healthy" && "text-emerald-400",
                diagnosis.overallHealth === "degraded" && "text-amber-400",
                diagnosis.overallHealth === "unhealthy" && "text-red-400",
              )}>
                ({diagnosis.overallHealth})
              </span>
            </span>
          </button>

          {showDiagnosis && (
            <div id="diagnosis-results" role="region" className="mt-2 space-y-1.5">
              {diagnosis.checks.map((check) => {
                const Icon = STATUS_ICONS[check.status];
                return (
                  <div key={check.name} className="flex items-start gap-2 text-xs">
                    <Icon className={cn("w-3.5 h-3.5 shrink-0 mt-0.5", STATUS_COLORS[check.status])} />
                    <div className="min-w-0">
                      <span className="text-muted-foreground">{check.name}:</span>{" "}
                      <span className="text-foreground/80">{check.detail}</span>
                      {check.suggestion && (
                        <p className="text-muted-foreground-subtle mt-0.5">{check.suggestion}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(ChatErrorCardInner);
