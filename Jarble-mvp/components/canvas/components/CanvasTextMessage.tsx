"use client";

import { memo } from "react";
import { FadeIn } from "../FadeIn";
import MarkdownMessage from "@/components/MarkdownMessage";

interface CanvasTextMessageProps {
  botText: string;
  userText?: string;
}

/**
 * Simple markdown card for text-only bot responses.
 * Shows user's original message (smaller, dimmed) above the bot response.
 */
function CanvasTextMessageInner({ botText, userText }: CanvasTextMessageProps) {
  return (
    <FadeIn className="p-4 space-y-3">
      {userText && (
        <div className="text-xs text-muted-foreground-subtle border-b border-border/30 pb-2">
          <span className="font-medium">You:</span> {userText}
        </div>
      )}
      <div className="text-sm leading-relaxed">
        <MarkdownMessage content={botText} />
      </div>
    </FadeIn>
  );
}

export default memo(CanvasTextMessageInner);
