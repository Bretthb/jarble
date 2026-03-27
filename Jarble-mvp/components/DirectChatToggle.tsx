"use client";

/**
 * Tambo toggle - switches between orchestrated mode (Tambo in the middle)
 * and direct mode (raw streaming to bot).
 *
 * ON (default):  User ←→ Tambo ←→ Bot  (management + chat, rich components)
 * OFF:           User ←→ Bot           (direct streaming, no management tools)
 */

import { Sparkles } from "lucide-react";

interface TamboToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}

export default function TamboToggle({
  enabled,
  onChange,
  disabled,
}: TamboToggleProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        enabled
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border/60 bg-secondary/30 text-muted-foreground hover:text-foreground"
      } disabled:opacity-40 disabled:cursor-not-allowed`}
      title={enabled ? "Tambo ON - orchestrated mode" : "Tambo OFF - direct to bot"}
    >
      <Sparkles className="w-3.5 h-3.5" />
      Tambo {enabled ? "ON" : "OFF"}
    </button>
  );
}
