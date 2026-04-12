"use client";

import TeamChatAvatar from "./TeamChatAvatar";
import { producerHue } from "@/lib/teamChatUtils";
import type { ChatSegment } from "@/lib/teamChatUtils";

type DelegationStatus = {
  toolName: string;
  targetRole: string;
  status: "running" | "completed" | "failed";
  elapsedMs?: number;
  uiBlockCount?: number;
  error?: string;
};

type SkipInfo = {
  reason: "no_tools_available" | "tool_call_not_emitted" | "mentioned_but_not_emitted";
  availableToolCount: number;
  availableTools: string[];
};

interface TeamChatMessageProps {
  /** The text segment to render. */
  segment: ChatSegment;
  /** Entry bot's role name (for coordinator identity). */
  entryRole?: string;
  /** Entry bot's deployment ID (for avatar color). */
  entryDeploymentId?: string;
  /** Deployment ID of the specialist who produced this segment (if known). */
  sourceDeploymentId?: string;
  /** Delegation status indicators to show below the bubble. */
  delegations?: DelegationStatus[];
  /** Skip indicator (Fix #6 — silent delegation failure surface). */
  skip?: SkipInfo;
}

/**
 * A single message bubble in the Team Chat group-chat UI.
 *
 * Renders 3 visual variants based on the segment's properties:
 *
 *   **entry** (sourceRole is null, not synthesis) — Coordinator's initial text.
 *     Left-aligned with coordinator avatar + "Coordinator" label.
 *
 *   **delegation** (sourceRole is set, not synthesis) — Specialist's response.
 *     Left-aligned with specialist avatar + role label. Indented `ml-6` to
 *     visually nest under the delegation narration above.
 *
 *   **synthesis** (isSynthesis is true) — Coordinator's wrap-up summary.
 *     Left-aligned with coordinator avatar. Preceded by a thin separator.
 *     Label: "Summary". Left border accent in coordinator hue.
 */
export default function TeamChatMessage({
  segment,
  entryRole = "Coordinator",
  entryDeploymentId,
  sourceDeploymentId,
  delegations,
  skip,
}: TeamChatMessageProps) {
  const { content, sourceRole, isSynthesis } = segment;

  if (!content && !delegations?.length && !skip) return null;

  // Determine the visual variant
  const isSpecialist = !!sourceRole && !isSynthesis;
  const displayRole = isSynthesis ? "Summary" : (sourceRole ?? entryRole);
  const displayDeploymentId = isSpecialist ? sourceDeploymentId : entryDeploymentId;
  const hue = producerHue(displayDeploymentId ?? displayRole);

  return (
    <div className={isSpecialist ? "ml-6" : ""}>
      {/* Synthesis separator */}
      {isSynthesis && (
        <div className="border-t border-border/40 my-2" />
      )}

      {/* Role label */}
      <div className="flex items-center gap-1.5 mb-1">
        <TeamChatAvatar
          deploymentId={displayDeploymentId}
          role={displayRole}
          size="sm"
        />
        <span className="text-[10px] font-medium text-muted-foreground">
          {displayRole}
        </span>
      </div>

      {/* Message bubble */}
      {content && (
        <div
          className={`
            inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm
            ${isSynthesis
              ? "bg-secondary/60 border-l-2"
              : isSpecialist
                ? "bg-secondary/80"
                : "bg-secondary"
            }
          `}
          style={isSynthesis ? { borderLeftColor: `hsl(${hue}, 50%, 45%)` } : undefined}
        >
          {content}
        </div>
      )}

      {/* Delegation status indicators */}
      {delegations && delegations.length > 0 && (
        <div className="mt-2 space-y-1">
          {delegations.map((d, di) => (
            <div key={di} className="flex items-center gap-2 text-[10px]">
              {d.status === "running" && (
                <span className="inline-flex items-center gap-1 text-blue-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  {d.targetRole} is working...
                  {d.elapsedMs != null && (
                    <span className="text-muted-foreground">
                      {Math.round(d.elapsedMs / 1000)}s
                    </span>
                  )}
                </span>
              )}
              {d.status === "completed" && (
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {d.targetRole} responded
                  {d.uiBlockCount ? ` (${d.uiBlockCount} component${d.uiBlockCount > 1 ? "s" : ""})` : ""}
                </span>
              )}
              {d.status === "failed" && (
                <span className="inline-flex items-center gap-1 text-red-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  {d.targetRole} failed{d.error ? `: ${d.error}` : ""}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delegation skipped indicator */}
      {skip && skip.reason === "mentioned_but_not_emitted" && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-amber-400/80">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400/80" />
          Delegation mentioned but not executed
          {skip.availableTools.length > 0 && (
            <span className="text-muted-foreground">
              (available: {skip.availableTools.join(", ")})
            </span>
          )}
        </div>
      )}
    </div>
  );
}
