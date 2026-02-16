/**
 * Shared StatusBadge component — displays deployment status with colored indicator
 * Used by Dashboard.tsx and Deployments.tsx
 */

// Map API status values to display config
export const STATUS_CONFIG: Record<string, { bg: string; border: string; text: string; label: string }> = {
  running: { bg: "bg-primary/10", border: "border-primary/30", text: "text-primary", label: "Running" },
  creating: { bg: "bg-primary/10", border: "border-primary/30", text: "text-primary", label: "Starting" },
  stopped: { bg: "bg-orange-500/10", border: "border-orange-500/30", text: "text-orange-500", label: "Stopped" },
  pending: { bg: "bg-secondary", border: "border-border", text: "text-muted-foreground", label: "Pending" },
  failed: { bg: "bg-secondary", border: "border-border", text: "text-muted-foreground", label: "Failed" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || { bg: "bg-muted-foreground/20", border: "border-muted-foreground/50", text: "text-muted-foreground", label: status };

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border ${config.bg} ${config.border}`}
    >
      <div
        className={`w-2 h-2 rounded-full ${config.text.replace("text-", "bg-")} ${status === "running" ? "animate-pulse" : ""}`}
      />
      <span className={`text-xs font-semibold ${config.text}`}>{config.label}</span>
    </div>
  );
}
