/**
 * Managed-credit status classification.
 *
 * Pure helpers kept in their own module so they can be imported without
 * pulling in the env-loading side of openrouter.ts. The TRPC router and
 * the chat preflight both wrap the async fetch + classify, but tests and
 * any future UI-side consumer can depend on this file alone.
 */

export type CreditLevel = "ok" | "warning" | "exhausted";

export interface KeyUsageSnapshot {
  disabled: boolean;
  limit: number | null;
  limitRemaining: number | null;
  usage: number;
}

export interface CreditStatus {
  level: CreditLevel;
  usage: number;
  limit: number | null;
  remaining: number | null;
  /** 0-100, or null when there's no limit set */
  percentUsed: number | null;
  disabled: boolean;
}

export const CREDIT_WARNING_THRESHOLD = 0.8; // 80%
export const CREDIT_EXHAUSTED_THRESHOLD = 1.0; // 100%

export function classifyCreditUsage(usage: KeyUsageSnapshot | null): CreditStatus | null {
  if (!usage) return null;

  const limit = usage.limit;
  const used = usage.usage ?? 0;
  const remaining = usage.limitRemaining;
  const disabled = usage.disabled;

  // No limit configured → unlimited managed key (treat as ok)
  if (limit == null || limit <= 0) {
    return {
      level: "ok",
      usage: used,
      limit: null,
      remaining: null,
      percentUsed: null,
      disabled,
    };
  }

  const pct = Math.min(1, used / limit);
  let level: CreditLevel = "ok";
  if (disabled || pct >= CREDIT_EXHAUSTED_THRESHOLD || (remaining != null && remaining <= 0)) {
    level = "exhausted";
  } else if (pct >= CREDIT_WARNING_THRESHOLD) {
    level = "warning";
  }

  return {
    level,
    usage: used,
    limit,
    remaining: remaining ?? Math.max(0, limit - used),
    percentUsed: Math.round(pct * 100),
    disabled,
  };
}
