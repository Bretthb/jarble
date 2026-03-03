"use client";

/**
 * Shared sandbox control bar and stopped-state UI.
 */

import { memo, type ReactNode } from "react";

/** Play icon SVG. */
function PlayIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 2L10 6L3 10V2Z" fill="currentColor" />
    </svg>
  );
}

/** Stop icon SVG. */
function StopIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor" />
    </svg>
  );
}

interface SandboxControlBarProps {
  stopped: boolean;
  onToggle: () => void;
}

/** Minimal control bar with stop/restart button. */
export const SandboxControlBar = memo(function SandboxControlBar({
  stopped,
  onToggle,
}: SandboxControlBarProps) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", flexShrink: 0, marginBottom: 4 }}>
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/50"
      >
        {stopped ? (
          <>
            <PlayIcon />
            Restart
          </>
        ) : (
          <>
            <StopIcon />
            Stop
          </>
        )}
      </button>
    </div>
  );
});

/** Stopped state placeholder. */
export const SandboxStoppedOverlay = memo(function SandboxStoppedOverlay() {
  return (
    <div
      style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0 }}
      className="rounded-lg bg-muted/30 text-muted-foreground text-sm"
    >
      Sandbox stopped — click Restart to resume
    </div>
  );
});

interface SandboxShellProps {
  stopped: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * Shared sandbox shell — control bar + content area.
 * Wraps the iframe (or stopped overlay) with consistent layout.
 */
export const SandboxShell = memo(function SandboxShell({
  stopped,
  onToggle,
  children,
}: SandboxShellProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 0 }}>
      <SandboxControlBar stopped={stopped} onToggle={onToggle} />
      {stopped ? <SandboxStoppedOverlay /> : children}
    </div>
  );
});
