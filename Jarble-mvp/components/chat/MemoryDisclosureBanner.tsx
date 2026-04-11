"use client";

/**
 * MemoryDisclosureBanner
 *
 * Unmissable disclosure banner shown above the chat panel for every deployment
 * so the user knows how long-term memory is scoped BEFORE they share anything
 * personal. Required by docs/audits/memory-scoping-decision.md (Option B):
 * Jarble cannot reach into the closed OpenClaw runtime to perfectly partition
 * memory per conversation, so we surface the current mode honestly instead.
 *
 * Modes:
 *   "global"  — memory shared across every chat with this bot, on every platform.
 *   "session" — best-effort per-conversation isolation. We scope our own MCP
 *               memory tools, and the bot's system prompt tells it not to
 *               recall cross-session, but the underlying OpenClaw runtime
 *               still runs a single memory pool per pod.
 *   "off"     — long-term memory tools disabled entirely.
 *
 * The banner is intentionally persistent (not dismissable) in global mode
 * because that is the mode with the strongest privacy implication. In session
 * and off modes it is a smaller info row.
 */

import { useState } from "react";
import { AlertTriangle, Info, BrainCircuit, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type MemoryScope = "global" | "session" | "off";

/**
 * Aggregate a set of per-deployment memory scopes into a single team-level
 * scope for the team chat disclosure banner. The rule is **loudest scope
 * wins**: a team is only as private as its leakiest member.
 *
 *   - if any deployment is "global"  → team scope is "global"
 *   - else if any is "session"        → team scope is "session"
 *   - else if any is "off"            → team scope is "off"
 *   - empty / all unknown             → "global" (privacy-safe default)
 *
 * Used by the team chat panel in views/Deployments.tsx to pick the banner
 * variant rendered above the Bot Teams chat. Exported so it can be unit-
 * tested in isolation.
 */
export function aggregateTeamMemoryScope(
  scopes: ReadonlyArray<MemoryScope | null | undefined>,
): MemoryScope {
  let sawSession = false;
  let sawOff = false;
  for (const s of scopes) {
    if (s === "global") return "global";
    if (s === "session") sawSession = true;
    else if (s === "off") sawOff = true;
  }
  if (sawSession) return "session";
  if (sawOff) return "off";
  return "global";
}

interface MemoryDisclosureBannerProps {
  scope: MemoryScope | null | undefined;
  className?: string;
}

export function MemoryDisclosureBanner({ scope, className }: MemoryDisclosureBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const effective: MemoryScope = scope === "session" || scope === "off" ? scope : "global";

  if (effective === "off") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-2 text-xs",
          "border-b border-border/40 bg-muted/30 text-muted-foreground",
          className,
        )}
      >
        <BrainCircuit className="h-3.5 w-3.5 shrink-0" />
        <span>Long-term memory is off for this bot. It will not remember anything after this chat ends.</span>
      </div>
    );
  }

  if (effective === "session") {
    return (
      <div
        className={cn(
          "flex items-start gap-2 px-4 py-2 text-xs",
          "border-b border-border/40 bg-muted/30 text-muted-foreground",
          className,
        )}
      >
        <BrainCircuit className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <div className="flex-1">
          <span>
            Memory is scoped to this chat (best-effort). Jarble's memory tools are partitioned per conversation,
            but the bot runtime may retain its own memory separately, so full isolation is not guaranteed. For
            the strongest guarantee, set memory to Off.
          </span>
        </div>
      </div>
    );
  }

  // Global mode — the loudest disclosure.
  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "border-b-2 border-amber-500/60 bg-amber-500/10",
        className,
      )}
      data-testid="memory-disclosure-banner"
    >
      <div className="flex items-start gap-2 px-4 py-2.5 text-xs">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-amber-700 dark:text-amber-300">
            This bot remembers things across every chat.
          </p>
          <p className="mt-0.5 text-amber-700/90 dark:text-amber-200/90 leading-snug">
            Anything you tell it here may be recalled in other conversations with the same bot, on any
            platform (web, Discord, WhatsApp, Slack, Telegram). Avoid sharing anything you do not want
            surfaced elsewhere.
          </p>
          {expanded && (
            <div className="mt-2 space-y-1.5 text-amber-700/90 dark:text-amber-200/90 leading-snug">
              <p>
                <strong>Why:</strong> the bot runtime keeps a single long-term memory pool per deployment.
                Conversations are independent in the UI, but the underlying agent can recall facts from any
                prior chat.
              </p>
              <p>
                <strong>How to change this:</strong> open the Configuration panel and set Long-term memory
                to <em>Per-session</em> (isolates memory to each chat, best-effort) or <em>Off</em> (disables
                memory tools entirely).
              </p>
              <p>
                <strong>Scope:</strong> memory only persists for chats with this same bot by this same user
                account. Other users of the same bot cannot see your memories.
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            "shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5",
            "text-amber-700/90 dark:text-amber-200/90",
            "hover:bg-amber-500/10 transition-colors",
          )}
          aria-expanded={expanded}
          aria-label={expanded ? "Show less about memory scope" : "Show more about memory scope"}
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" /> Less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" /> More
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * Compact inline version for places where a full banner is too loud
 * (e.g., footer/tooltips). Not currently used but exported so ConfigPanel
 * or future surfaces can reuse the same copy.
 */
export function MemoryDisclosureInline({ scope }: { scope: MemoryScope | null | undefined }) {
  const effective: MemoryScope = scope === "session" || scope === "off" ? scope : "global";
  const Icon = effective === "global" ? AlertTriangle : Info;
  const color =
    effective === "global"
      ? "text-amber-600 dark:text-amber-400"
      : "text-muted-foreground";
  const text =
    effective === "global"
      ? "Memory: shared across all chats with this bot"
      : effective === "session"
      ? "Memory: scoped to this chat"
      : "Memory: off";
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px]", color)}>
      <Icon className="h-3 w-3" />
      {text}
    </span>
  );
}
