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

/** Minimal control button — absolutely positioned bottom-right over sandbox content. */
export const SandboxControlBar = memo(function SandboxControlBar({
  stopped,
  onToggle,
}: SandboxControlBarProps) {
  return (
    <button
      onClick={onToggle}
      className="absolute bottom-2 right-2 z-30 flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors bg-background/80 backdrop-blur-sm border border-border/40 text-muted-foreground hover:text-foreground hover:bg-background shadow-sm"
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
    <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 0 }}>
      {stopped ? <SandboxStoppedOverlay /> : children}
      <SandboxControlBar stopped={stopped} onToggle={onToggle} />
    </div>
  );
});
