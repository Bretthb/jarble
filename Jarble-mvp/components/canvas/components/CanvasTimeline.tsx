"use client";

interface TimelineEvent {
  label: string;
  description?: string;
  timestamp?: string;
  icon?: string;
  status?: "completed" | "active" | "pending";
}

export interface CanvasTimelineProps {
  title?: string;
  events: TimelineEvent[];
}

const STATUS_STYLES: Record<string, { dot: string; line: string }> = {
  completed: { dot: "bg-green-500 border-green-500/30", line: "bg-green-500/30" },
  active: { dot: "bg-primary border-primary/30 ring-2 ring-primary/20", line: "bg-border" },
  pending: { dot: "bg-muted-foreground/30 border-border", line: "bg-border" },
};

export default function CanvasTimeline({ title, events }: CanvasTimelineProps) {
  if (!Array.isArray(events) || events.length === 0) return null;

  return (
    <div className="p-3 h-full">
      {title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
      <div className="space-y-0">
        {events.map((event, i) => {
          const status = event.status || "pending";
          const styles = STATUS_STYLES[status] || STATUS_STYLES.pending;
          const isLast = i === events.length - 1;

          return (
            <div key={`${event.label}-${i}`} className="flex gap-3">
              <div className="flex flex-col items-center">
                {event.icon ? (
                  <span className="text-base shrink-0">{event.icon}</span>
                ) : (
                  <div className={`w-2.5 h-2.5 rounded-full border shrink-0 mt-1.5 ${styles.dot}`} />
                )}
                {!isLast && <div className={`w-px flex-1 min-h-[24px] ${styles.line}`} />}
              </div>
              <div className={`pb-4 ${isLast ? "pb-0" : ""}`}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{event.label}</span>
                  {event.timestamp && (
                    <span className="text-[10px] text-muted-foreground">{event.timestamp}</span>
                  )}
                </div>
                {event.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
