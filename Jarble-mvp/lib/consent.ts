/**
 * Single source of truth for the current Terms of Service + Privacy
 * Policy version. Bumping this value forces every existing user to
 * re-accept on their next login via the returning-user consent modal.
 *
 * Must stay in sync with the `tosVersion` zod enum in
 * `jarble-api-main/src/trpc/routers/user.ts::acceptTerms` — the server
 * will reject any client that claims acceptance of a version it does
 * not recognise. Bumping this requires deploying the API at the same
 * time so the enum accepts the new value.
 */
export const CURRENT_TOS_VERSION = "1.0" as const;

export type TosVersion = typeof CURRENT_TOS_VERSION;

/**
 * Returns true when the given user profile has a null or missing
 * `tosAcceptedAt`, meaning the consent gate must block them.
 */
export function needsConsent(
  profile: { tosAcceptedAt?: Date | string | null } | null | undefined,
): boolean {
  if (!profile) return false;
  return profile.tosAcceptedAt == null;
}
