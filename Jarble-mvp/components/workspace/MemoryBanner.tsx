"use client";

/**
 * MemoryBanner - Disclosure banner shown at the top of the chat panel.
 *
 * When memory scope is "global" (default), shows an unmissable banner
 * informing users that the bot remembers information across all conversations.
 * When "session", shows a subtler indicator. When "off", shows nothing.
 */

import { memo } from "react";
import { Brain, ShieldCheck, ShieldOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface MemoryBannerProps {
  memoryScope: "global" | "session" | "off" | string;
}

function MemoryBannerInner({ memoryScope }: MemoryBannerProps) {
  if (memoryScope === "off") return null;

  if (memoryScope === "session") {
    return (
      <div className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[11px] shrink-0">
        <ShieldCheck className="w-3 h-3 shrink-0" />
        <span>Memory is scoped to this conversation only.</span>
      </div>
    );
  }

  // Default: global scope - unmissable disclosure
  return (
    <div className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-700 dark:text-amber-400 text-[11px] shrink-0">
      <Brain className="w-3 h-3 shrink-0" />
      <span>
        This bot remembers information across all your conversations and platforms.
        {" "}Change this in the config panel.
      </span>
    </div>
  );
}

export default memo(MemoryBannerInner);
