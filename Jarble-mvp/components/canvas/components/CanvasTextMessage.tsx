"use client";

import { memo } from "react";
import { motion } from "framer-motion";
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
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="p-4 space-y-3"
    >
      {userText && (
        <div className="text-xs text-muted-foreground/60 border-b border-border/30 pb-2">
          <span className="font-medium">You:</span> {userText}
        </div>
      )}
      <div className="text-sm leading-relaxed">
        <MarkdownMessage content={botText} />
      </div>
    </motion.div>
  );
}

export default memo(CanvasTextMessageInner);
