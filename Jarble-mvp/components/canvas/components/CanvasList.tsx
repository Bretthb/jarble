"use client";

interface ListItem {
  text: string;
  description?: string;
  icon?: string;
  badge?: string;
  badgeVariant?: string;
}

export interface CanvasListProps {
  title?: string;
  items: ListItem[];
  ordered?: boolean;
}

const BADGE_STYLES: Record<string, string> = {
  default: "bg-primary/15 text-primary border-primary/30",
  success: "bg-green-500/15 text-green-400 border-green-500/30",
  warning: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  destructive: "bg-red-500/15 text-red-400 border-red-500/30",
  info: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

export default function CanvasList({ title, items, ordered = false }: CanvasListProps) {
  if (!Array.isArray(items) || items.length === 0) return null;

  const Tag = ordered ? "ol" : "ul";

  return (
    <div className="p-3 h-full">
      {title && <h3 className="text-sm font-semibold text-foreground mb-2">{title}</h3>}
      <Tag className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2.5 py-1.5">
            {item.icon ? (
              <span className="text-base shrink-0 mt-0.5">{item.icon}</span>
            ) : ordered ? (
              <span className="text-xs text-muted-foreground font-medium shrink-0 mt-0.5 w-5 text-right">{i + 1}.</span>
            ) : (
              <span className="text-muted-foreground shrink-0 mt-2 w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-foreground">{item.text}</span>
                {item.badge && (
                  <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${BADGE_STYLES[item.badgeVariant || "default"] || BADGE_STYLES.default}`}>
                    {item.badge}
                  </span>
                )}
              </div>
              {item.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
              )}
            </div>
          </li>
        ))}
      </Tag>
    </div>
  );
}
