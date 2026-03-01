"use client";

import { memo } from "react";
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
    <div className="space-y-3">
      {userText && (
        <div className="text-xs text-muted-foreground/60 border-b border-border/30 pb-2">
          <span className="font-medium">You:</span> {userText}
        </div>
      )}
      <div className="text-sm leading-relaxed">
        <MarkdownMessage content={botText} />
      </div>
    </div>
  );
}

export default memo(CanvasTextMessageInner);
