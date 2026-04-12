"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Info, X, AlertOctagon } from "lucide-react";

// Paths where the banner must not render — legal, auth, marketing pages
// where users should see only the core content (mirrors ConsentModal).
const HIDDEN_PATH_PREFIXES = ["/login", "/register", "/legal", "/terms", "/privacy", "/about", "/pricing"];
const EXACT_HIDDEN_PATHS = ["/"];

const DISMISS_KEY_PREFIX = "jarble-announcement-dismissed-";

function isHidden(pathname: string | null): boolean {
  if (!pathname) return false;
  if (EXACT_HIDDEN_PATHS.includes(pathname)) return true;
  return HIDDEN_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const SEVERITY_STYLES: Record<string, { container: string; Icon: typeof Info }> = {
  info: {
    container: "bg-muted/80 border-border text-foreground",
    Icon: Info,
  },
  warning: {
    container:
      "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:bg-amber-400/10 dark:border-amber-400/30 dark:text-amber-300",
    Icon: AlertTriangle,
  },
  critical: {
    container: "bg-destructive/10 border-destructive/30 text-destructive",
    Icon: AlertOctagon,
  },
};

export function AnnouncementBanner() {
  const pathname = usePathname();
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  const { data } = trpc.user.getActiveAnnouncement.useQuery(undefined, {
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!data?.id) return;
    try {
      const stored = window.localStorage.getItem(`${DISMISS_KEY_PREFIX}${data.id}`);
      if (stored === "1") setDismissedId(data.id);
    } catch {
      // localStorage may throw in private mode — safe to ignore, banner stays visible.
    }
  }, [data?.id]);

  if (!data) return null;
  if (isHidden(pathname)) return null;
  if (dismissedId === data.id) return null;

  const style = SEVERITY_STYLES[data.severity] ?? SEVERITY_STYLES.info;
  const { Icon } = style;

  const handleDismiss = () => {
    if (!data.dismissible) return;
    try {
      window.localStorage.setItem(`${DISMISS_KEY_PREFIX}${data.id}`, "1");
    } catch {
      // fall through; in-session dismissal still works
    }
    setDismissedId(data.id);
  };

  return (
    <div
      role={data.severity === "critical" ? "alert" : "status"}
      className={`relative border-b ${style.container}`}
    >
      <div className="max-w-4xl mx-auto px-4 py-2.5 flex items-center justify-center gap-3 text-sm font-medium">
        <Icon className="w-4 h-4 shrink-0" />
        <span className="text-center">{data.message}</span>
      </div>
      {data.dismissible && (
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss announcement"
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-foreground/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
