/**
 * Shared utilities for Team Chat visual identity.
 *
 * Extracted from TeamChatCanvasCard.tsx so both the canvas card attribution
 * and the new group-chat message avatars use the same stable color mapping.
 */

/**
 * Hash a string to a stable HSL hue (0-360) so the same bot always gets
 * the same color across messages, sessions, and components. Spreads across
 * the full hue circle, skipping muddy red-orange around 0.
 */
export function producerHue(producerId: string): number {
  let hash = 0;
  for (let i = 0; i < producerId.length; i++) {
    hash = (hash * 31 + producerId.charCodeAt(i)) | 0;
  }
  return ((Math.abs(hash) % 320) + 20) % 360;
}

/**
 * Get the first letter of a role for avatar initials.
 * Falls back to "B" (Bot) if role is empty/undefined.
 */
export function roleInitial(role?: string | null): string {
  if (!role) return "B";
  const trimmed = role.trim();
  return trimmed.charAt(0).toUpperCase() || "B";
}

/**
 * Parse `**RoleName:** response text` prefixes from a monolithic assistant
 * message and split into per-specialist segments. This enables the group-chat
 * visual redesign (Phase 1) without any server changes — the client splits
 * the existing concatenated text at render time.
 *
 * Returns an array of segments. If no role prefixes are found, returns a
 * single segment with the full text and no role attribution.
 *
 * The `---` separator before `**Summary:**` is also detected and split as
 * a separate synthesis segment.
 */
export interface ChatSegment {
  /** The text content of this segment (role prefix stripped) */
  content: string;
  /** The role name extracted from the `**RoleName:**` prefix, or null for the entry bot's initial text */
  sourceRole: string | null;
  /** Whether this segment is the synthesis summary */
  isSynthesis: boolean;
}

export function splitAssistantMessage(text: string): ChatSegment[] {
  if (!text || !text.trim()) return [];

  const segments: ChatSegment[] = [];

  // Split on the synthesis separator first (---\n**Summary:**)
  const synthesisSplit = text.split(/\n---\n\*\*Summary:\*\*\s*/);
  const mainText = synthesisSplit[0];
  const synthesisText = synthesisSplit.length > 1 ? synthesisSplit.slice(1).join("\n") : null;

  // Split the main text on **RoleName:** patterns
  // This regex matches the pattern the server emits: **Analyst:** response text
  const rolePattern = /\*\*([^*]+):\*\*\s*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const mainSegments: { role: string | null; start: number; end?: number }[] = [];

  while ((match = rolePattern.exec(mainText)) !== null) {
    // Text before this role prefix is either the entry bot's text or trailing content from a prior segment
    if (match.index > lastIndex) {
      const beforeText = mainText.slice(lastIndex, match.index).trim();
      if (beforeText && mainSegments.length === 0) {
        // Entry bot's initial text (before any specialist response)
        mainSegments.push({ role: null, start: lastIndex, end: match.index });
      } else if (mainSegments.length > 0) {
        // Update the previous segment's end
        mainSegments[mainSegments.length - 1].end = match.index;
      }
    }
    mainSegments.push({ role: match[1], start: match.index + match[0].length });
    lastIndex = match.index + match[0].length;
  }

  // Close the last segment
  if (mainSegments.length > 0) {
    mainSegments[mainSegments.length - 1].end = mainText.length;
  }

  // If no role prefixes found, return the whole thing as one segment
  if (mainSegments.length === 0) {
    segments.push({ content: mainText.trim(), sourceRole: null, isSynthesis: false });
  } else {
    for (const seg of mainSegments) {
      const content = mainText.slice(seg.start, seg.end).trim();
      if (content) {
        segments.push({ content, sourceRole: seg.role, isSynthesis: false });
      }
    }
  }

  // Add synthesis segment if present
  if (synthesisText) {
    segments.push({ content: synthesisText.trim(), sourceRole: null, isSynthesis: true });
  }

  return segments;
}
