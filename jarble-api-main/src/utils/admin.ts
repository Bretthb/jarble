/**
 * Shared admin user utilities.
 *
 * Admin user IDs are read from the `ADMIN_USER_IDS` environment variable,
 * which should contain a comma-separated list of Auth0 user IDs, e.g.:
 *
 *   ADMIN_USER_IDS=auth0|abc123,auth0|def456
 *
 * If the env var is unset or empty, a warning is logged at import time
 * and all admin checks will fail (no one has admin access).
 *
 * Note: ADMIN_USER_IDS is also validated in env.ts (Zod schema) for
 * documentation and startup-time visibility.
 */

function parseAdminUserIds(raw: string | undefined): Set<string> {
  if (!raw || raw.trim() === "") {
    return new Set();
  }
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return new Set(ids);
}

const adminUserIds = parseAdminUserIds(process.env.ADMIN_USER_IDS);

if (adminUserIds.size === 0) {
  console.warn(
    "[admin] WARNING: ADMIN_USER_IDS env var is empty or unset. " +
      "No users will have admin access to marketplace moderation. " +
      "Set ADMIN_USER_IDS to a comma-separated list of Auth0 user IDs."
  );
}

/** Returns the set of admin user IDs (used for testing). */
export function getAdminUserIds(): Set<string> {
  return adminUserIds;
}

/**
 * Check whether the given userId is an admin.
 */
export function isAdmin(userId: string): boolean {
  return adminUserIds.has(userId);
}
