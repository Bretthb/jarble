/**
 * Reasoning Tag Tracker
 *
 * Tracks `<think>` / `<reasoning>` tags in streaming LLM text and splits
 * content into reasoning vs. visible text. Extracted from tamboAgent.ts
 * as a pure mechanical split — behavior is unchanged.
 */

// ── Reasoning Tag Tracker ────────────────────────────────────────────────────
//
// Tracks `<think>` / `<reasoning>` tags in the streaming text and splits
// content into reasoning vs. visible text. The LLM streams text incrementally,
// so we process only the new delta on each call.

interface ReasoningState {
  /** Whether we are currently inside a reasoning block */
  inReasoning: boolean;
  /** How much of the accumulated text we have already processed */
  processedLength: number;
  /** Whether we have emitted REASONING_START for the current block */
  started: boolean;
}

export function createReasoningTracker() {
  const state: ReasoningState = {
    inReasoning: false,
    processedLength: 0,
    started: false,
  };

  /**
   * Reset tracker state. JAR-63: called when the chat transport falls
   * back (HTTP → WS → exec) so partial state from an aborted stream
   * does not corrupt the next attempt's offset tracking.
   */
  function reset(): void {
    state.inReasoning = false;
    state.processedLength = 0;
    state.started = false;
  }

  /**
   * Process accumulated text and emit reasoning / text events as appropriate.
   *
   * `fullText` is the full accumulated bot text so far.
   * Returns the text delta that should be sent as TEXT_MESSAGE_CONTENT
   * (with reasoning sections stripped out). May be empty if the new text
   * is entirely reasoning content.
   *
   * `onReasoningStart` / `onReasoningContent` / `onReasoningEnd` are callbacks
   * for emitting the corresponding SSE events.
   */
  function process(
    fullText: string,
    callbacks: {
      onReasoningStart: () => void;
      onReasoningContent: (delta: string) => void;
      onReasoningEnd: () => void;
    },
  ): string {
    const newText = fullText.slice(state.processedLength);
    if (!newText) return "";

    let visibleDelta = "";
    let remaining = newText;

    while (remaining.length > 0) {
      if (!state.inReasoning) {
        // Look for opening tag
        const openMatch = remaining.match(/<(think|reasoning)>/i);
        if (openMatch && openMatch.index !== undefined) {
          // Emit text before the tag as visible
          visibleDelta += remaining.slice(0, openMatch.index);
          state.inReasoning = true;
          state.started = false;
          remaining = remaining.slice(openMatch.index + openMatch[0].length);

          // Check if the opening tag might be at the very end (incomplete)
          // No - we matched it, so it's complete
          callbacks.onReasoningStart();
          state.started = true;
        } else {
          // Check if there's a potential partial opening tag at the end
          // e.g., the text ends with "<thi" which might become "<think>"
          const partialTagIdx = findPartialOpenTag(remaining);
          if (partialTagIdx !== -1) {
            // Emit everything before the potential partial tag
            visibleDelta += remaining.slice(0, partialTagIdx);
            // Don't advance processedLength past the partial tag - we'll
            // re-process it on the next delta when more text arrives.
            state.processedLength += newText.length - remaining.length + partialTagIdx;
            return visibleDelta;
          }
          // No tag found - all visible text
          visibleDelta += remaining;
          remaining = "";
        }
      } else {
        // Inside reasoning - look for closing tag
        const closeMatch = remaining.match(/<\/(think|reasoning)>/i);
        if (closeMatch && closeMatch.index !== undefined) {
          // Emit reasoning content before the closing tag
          const reasoningChunk = remaining.slice(0, closeMatch.index);
          if (reasoningChunk) {
            callbacks.onReasoningContent(reasoningChunk);
          }
          callbacks.onReasoningEnd();
          state.inReasoning = false;
          state.started = false;
          remaining = remaining.slice(closeMatch.index + closeMatch[0].length);
        } else {
          // Check for partial closing tag at the end
          const partialCloseIdx = findPartialCloseTag(remaining);
          if (partialCloseIdx !== -1) {
            // Emit reasoning content up to the partial tag
            const reasoningChunk = remaining.slice(0, partialCloseIdx);
            if (reasoningChunk) {
              callbacks.onReasoningContent(reasoningChunk);
            }
            state.processedLength += newText.length - remaining.length + partialCloseIdx;
            return visibleDelta;
          }
          // No closing tag - entire remaining text is reasoning
          if (remaining) {
            callbacks.onReasoningContent(remaining);
          }
          remaining = "";
        }
      }
    }

    state.processedLength = fullText.length;
    return visibleDelta;
  }

  return { process, reset, state };
}

/**
 * Check if the end of `text` contains a partial opening reasoning tag.
 * Returns the index where the partial tag starts, or -1 if none found.
 */
function findPartialOpenTag(text: string): number {
  const candidates = ["<think>", "<reasoning>", "<Think>", "<Thinking>", "<THINK>", "<REASONING>"];
  for (const tag of candidates) {
    // Check suffixes of text against prefixes of tag
    for (let len = 1; len < tag.length; len++) {
      const suffix = text.slice(-len);
      const prefix = tag.slice(0, len);
      if (suffix.toLowerCase() === prefix.toLowerCase() && text.length >= len) {
        return text.length - len;
      }
    }
  }
  return -1;
}

/**
 * Check if the end of `text` contains a partial closing reasoning tag.
 * Returns the index where the partial tag starts, or -1 if none found.
 */
function findPartialCloseTag(text: string): number {
  const candidates = ["</think>", "</reasoning>", "</Think>", "</Thinking>", "</THINK>", "</REASONING>"];
  for (const tag of candidates) {
    for (let len = 1; len < tag.length; len++) {
      const suffix = text.slice(-len);
      const prefix = tag.slice(0, len);
      if (suffix.toLowerCase() === prefix.toLowerCase() && text.length >= len) {
        return text.length - len;
      }
    }
  }
  return -1;
}

/**
 * Strip reasoning tags from finalized text (for non-streaming paths).
 * Removes `<think>...</think>` and `<reasoning>...</reasoning>` blocks entirely.
 */
export function stripReasoningTags(text: string): string {
  return text
    // Well-formed pairs: <think>...</think> or <reasoning>...</reasoning>
    .replace(/<(think|reasoning)>[\s\S]*?<\/\1>/gi, "")
    // Malformed/partial tags: <think without closing >, bare </think>, etc.
    // Catches cases where the model starts <think but switches context mid-token.
    .replace(/<\/?(?:think|reasoning)\b[^>]*>?/gi, "")
    // ```jarble_delegate``` fenced blocks are dispatch instructions from the
    // bot (parsed into real delegation calls upstream). They must never survive
    // into persisted chat history — otherwise the raw JSON leaks into future
    // renders of the conversation.
    .replace(/```jarble_delegate\s*\n[\s\S]*?```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract reasoning content from finalized text (for non-streaming paths).
 * Returns an array of reasoning block contents.
 */
export function extractReasoningBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /<(think|reasoning)>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match[2].trim()) {
      blocks.push(match[2].trim());
    }
  }
  return blocks;
}
