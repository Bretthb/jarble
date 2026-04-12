"use client";

import TeamChatAvatar from "./TeamChatAvatar";

interface TeamChatDelegationNarrationProps {
  /** The coordinator who initiated the delegation. */
  fromRole: string;
  fromDeploymentId?: string;
  /** The specialist being delegated to. */
  toRole: string;
  toDeploymentId?: string;
  /** The task being delegated (truncated for display). */
  task?: string;
  /** Max characters of the task to display. */
  maxTaskChars?: number;
}

/**
 * Compact center-aligned system line showing who asked whom to do what.
 *
 * Renders between the coordinator's message and the specialist's response
 * in the group-chat Team Chat panel:
 *
 *   [Coordinator avatar]  asked  [Specialist avatar]  to: "truncated task..."
 *
 * No bubble, no background — just a small muted line that narrates the
 * delegation handoff. Uses `TeamChatAvatar` for visual consistency with
 * the message bubbles above and below.
 */
export default function TeamChatDelegationNarration({
  fromRole,
  fromDeploymentId,
  toRole,
  toDeploymentId,
  task,
  maxTaskChars = 80,
}: TeamChatDelegationNarrationProps) {
  const truncatedTask = task
    ? task.length > maxTaskChars
      ? task.slice(0, maxTaskChars).trimEnd() + "..."
      : task
    : null;

  return (
    <div className="flex items-center justify-center gap-1.5 py-1.5 px-2">
      <TeamChatAvatar deploymentId={fromDeploymentId} role={fromRole} size="sm" />
      <span className="text-[10px] text-muted-foreground">asked</span>
      <TeamChatAvatar deploymentId={toDeploymentId} role={toRole} size="sm" />
      {truncatedTask && (
        <span className="text-[10px] text-muted-foreground/70 truncate max-w-[200px]">
          to: &ldquo;{truncatedTask}&rdquo;
        </span>
      )}
    </div>
  );
}
