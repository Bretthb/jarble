"use client";

import { producerHue, roleInitial } from "@/lib/teamChatUtils";

interface TeamChatAvatarProps {
  /** Deployment ID — used for stable hue-based color. */
  deploymentId?: string;
  /** Role label (e.g., "Coordinator", "Analyst") — first letter used as initial. */
  role?: string | null;
  /** Size variant. */
  size?: "sm" | "md";
  /** Optional className override. */
  className?: string;
}

/**
 * Hue-colored circle avatar for the Team Chat group-chat UI.
 *
 * Each bot gets a stable color derived from its deployment ID (via
 * `producerHue`) and displays the first letter of its role as the initial.
 * This makes it easy to scan a conversation and visually identify which
 * bot is speaking without reading the role label.
 *
 * Sizes:
 *   sm (default) — 24x24, text-[10px]  — used inline in messages
 *   md           — 32x32, text-xs       — used in narration / headers
 */
export default function TeamChatAvatar({
  deploymentId,
  role,
  size = "sm",
  className = "",
}: TeamChatAvatarProps) {
  const hue = producerHue(deploymentId ?? role ?? "default");
  const initial = roleInitial(role);

  const sizeClasses = size === "md" ? "w-8 h-8 text-xs" : "w-6 h-6 text-[10px]";

  return (
    <div
      className={`${sizeClasses} rounded-full flex items-center justify-center font-semibold shrink-0 select-none ${className}`}
      style={{
        backgroundColor: `hsl(${hue}, 45%, 25%)`,
        color: `hsl(${hue}, 70%, 75%)`,
        border: `1.5px solid hsl(${hue}, 50%, 40%)`,
      }}
      title={role || undefined}
    >
      {initial}
    </div>
  );
}
