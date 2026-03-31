/**
 * Shared OpenRouter Management API utilities.
 *
 * Centralises key provisioning, revocation, and usage queries so they're
 * consistent across the deployment create, update, and delete flows.
 */
import { env } from "./env.js";
import { logger } from "./logger.js";

const MANAGEMENT_BASE = "https://openrouter.ai/api/v1/keys";

// ── Types ──────────────────────────────────────────────────────────────

export interface ProvisionedKey {
  /** The actual API key string (only shown once at creation time) */
  key: string;
  /** Unique hash identifier - used for revocation, usage lookups, updates */
  hash: string;
  /** Key display name */
  name: string;
}

export interface KeyUsage {
  hash: string;
  name: string;
  disabled: boolean;
  limit: number | null;
  limitRemaining: number | null;
  usage: number;
  usageDaily: number;
  usageWeekly: number;
  usageMonthly: number;
  createdAt: string;
  expiresAt: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────

function getManagementKey(): string {
  const key = env.OPENROUTER_MANAGEMENT_KEY;
  if (!key) {
    throw new Error("OPENROUTER_MANAGEMENT_KEY is not configured");
  }
  return key;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getManagementKey()}`,
    "Content-Type": "application/json",
  };
}

// ── Provision ──────────────────────────────────────────────────────────

/**
 * Create a new OpenRouter tenant API key.
 *
 * @param userId    - Jarble user ID (for naming)
 * @param deploymentId - Jarble deployment ID (for naming)
 * @param limitDollars - Monthly spending cap in USD (default $5)
 * @returns The provisioned key string + hash (key ID)
 */
export async function provisionOpenRouterKey(params: {
  userId: string;
  deploymentId: string;
  limitDollars?: number;
}): Promise<ProvisionedKey> {
  const { userId, deploymentId, limitDollars = 5 } = params;
  const keyName = `jarble-${userId}-${deploymentId}`;

  const res = await fetch(MANAGEMENT_BASE, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      name: keyName,
      limit: limitDollars,
      limit_reset: "monthly",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error({ status: res.status, body, userId, deploymentId }, "OpenRouter key provisioning failed");
    throw new Error(`OpenRouter Management API error: ${res.status}`);
  }

  const json = (await res.json()) as {
    key?: string;
    data?: { key?: string; hash?: string; name?: string };
  };

  const key = json.key || json.data?.key;
  const hash = json.data?.hash;

  if (!key) {
    throw new Error("No key returned from OpenRouter Management API");
  }
  if (!hash) {
    logger.warn({ userId, deploymentId }, "OpenRouter did not return a hash - revocation will not be possible");
  }

  logger.info({ deploymentId, userId, hash }, "Provisioned OpenRouter tenant key");

  return {
    key,
    hash: hash || "",
    name: keyName,
  };
}

// ── Revoke (disable) ──────────────────────────────────────────────────

/**
 * Disable an OpenRouter API key by its hash.
 * OpenRouter doesn't have a DELETE endpoint - we PATCH `disabled: true`.
 *
 * @param hash - The key hash (returned during provisioning)
 * @returns true if successfully disabled, false if hash was empty/missing
 */
export async function revokeOpenRouterKey(hash: string): Promise<boolean> {
  if (!hash) {
    logger.warn("Cannot revoke OpenRouter key: no hash provided");
    return false;
  }

  try {
    const res = await fetch(`${MANAGEMENT_BASE}/${hash}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ disabled: true }),
    });

    if (!res.ok) {
      const body = await res.text();
      // 404 = key already deleted/doesn't exist - not an error worth throwing
      if (res.status === 404) {
        logger.info({ hash }, "OpenRouter key not found (already deleted?)");
        return true;
      }
      logger.error({ status: res.status, body, hash }, "Failed to revoke OpenRouter key");
      return false;
    }

    logger.info({ hash }, "Revoked (disabled) OpenRouter key");
    return true;
  } catch (err) {
    logger.error({ err, hash }, "Exception revoking OpenRouter key");
    return false;
  }
}

// ── Usage ──────────────────────────────────────────────────────────────

/**
 * Get usage data for an OpenRouter key by its hash.
 *
 * @param hash - The key hash
 * @returns Usage data or null if not found
 */
export async function getOpenRouterKeyUsage(hash: string): Promise<KeyUsage | null> {
  if (!hash) return null;

  try {
    const res = await fetch(`${MANAGEMENT_BASE}/${hash}`, {
      method: "GET",
      headers: authHeaders(),
    });

    if (!res.ok) {
      if (res.status === 404) return null;
      logger.error({ status: res.status, hash }, "Failed to fetch OpenRouter key usage");
      return null;
    }

    const json = (await res.json()) as {
      data?: {
        hash?: string;
        name?: string;
        disabled?: boolean;
        limit?: number | null;
        limit_remaining?: number | null;
        usage?: number;
        usage_daily?: number;
        usage_weekly?: number;
        usage_monthly?: number;
        created_at?: string;
        expires_at?: string | null;
      };
    };

    const d = json.data;
    if (!d) return null;

    return {
      hash: d.hash || hash,
      name: d.name || "",
      disabled: d.disabled ?? false,
      limit: d.limit ?? null,
      limitRemaining: d.limit_remaining ?? null,
      usage: d.usage ?? 0,
      usageDaily: d.usage_daily ?? 0,
      usageWeekly: d.usage_weekly ?? 0,
      usageMonthly: d.usage_monthly ?? 0,
      createdAt: d.created_at || "",
      expiresAt: d.expires_at ?? null,
    };
  } catch (err) {
    logger.error({ err, hash }, "Exception fetching OpenRouter key usage");
    return null;
  }
}

/**
 * Update an OpenRouter key's spending limit.
 *
 * @param hash - The key hash
 * @param limitDollars - New monthly limit in USD
 */
export async function updateOpenRouterKeyLimit(hash: string, limitDollars: number): Promise<boolean> {
  if (!hash) return false;

  try {
    const res = await fetch(`${MANAGEMENT_BASE}/${hash}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ limit: limitDollars }),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body, hash }, "Failed to update OpenRouter key limit");
      return false;
    }

    logger.info({ hash, limitDollars }, "Updated OpenRouter key limit");
    return true;
  } catch (err) {
    logger.error({ err, hash }, "Exception updating OpenRouter key limit");
    return false;
  }
}
