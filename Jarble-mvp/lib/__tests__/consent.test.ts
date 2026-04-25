/**
 * Unit tests for `lib/consent.ts`.
 *
 * The consent gate is the platform's TOS-acceptance enforcement: a
 * truthy `needsConsent(profile)` blocks the app behind the
 * <ConsentModal /> on every authed page. A regression that returned
 * `false` for a not-yet-accepted profile would silently let users
 * continue without acceptance — a compliance issue.
 *
 * The contract is small (one constant + one function) but
 * load-bearing; this test pins both.
 */

import { describe, it, expect } from "vitest";
import { CURRENT_TOS_VERSION, needsConsent } from "../consent";

describe("CURRENT_TOS_VERSION", () => {
  it("is the literal '1.0' constant — bumping requires a coordinated server enum update", () => {
    // The value must match the `tosVersion` zod enum in
    // jarble-api-main/src/trpc/routers/user.ts::acceptTerms. A bump
    // here without a server bump means every existing user gets
    // rejected on their next acceptTerms call. Pinning the literal
    // forces both files to be touched together.
    expect(CURRENT_TOS_VERSION).toBe("1.0");
  });
});

describe("needsConsent", () => {
  // ── Pre-auth states (no profile yet) ────────────────────────────────────

  it("returns false for null profile (user not yet authenticated → modal stays hidden)", () => {
    expect(needsConsent(null)).toBe(false);
  });

  it("returns false for undefined profile (loading state → modal stays hidden)", () => {
    expect(needsConsent(undefined)).toBe(false);
  });

  // ── Not-yet-accepted states ─────────────────────────────────────────────

  it("returns true when tosAcceptedAt is null (existing user pre-JAR-64 backfill)", () => {
    // Per JAR-64: existing users are NOT backfilled. A null value
    // means "has never accepted" and the gate must fire.
    expect(needsConsent({ tosAcceptedAt: null })).toBe(true);
  });

  it("returns true when tosAcceptedAt is undefined (missing field)", () => {
    expect(needsConsent({ tosAcceptedAt: undefined })).toBe(true);
  });

  it("returns true when tosAcceptedAt key is absent entirely", () => {
    // Defensive: a partial profile shape that omits the field
    // should still trigger the gate (treated as "never accepted").
    expect(needsConsent({})).toBe(true);
  });

  // ── Accepted states ─────────────────────────────────────────────────────

  it("returns false when tosAcceptedAt is a Date instance", () => {
    expect(needsConsent({ tosAcceptedAt: new Date() })).toBe(false);
  });

  it("returns false when tosAcceptedAt is an ISO string (server JSON shape)", () => {
    // Auth0 / tRPC serialization can hand the field over as a
    // string. The == null check still treats this as "accepted".
    expect(needsConsent({ tosAcceptedAt: "2026-04-25T00:00:00Z" })).toBe(false);
  });

  it("returns false even for an old date — only acceptance presence matters, not version recency", () => {
    // Re-acceptance after a CURRENT_TOS_VERSION bump is enforced
    // server-side via the zod enum, NOT here. A stale acceptance
    // date still counts as "consented to whatever was current then".
    expect(needsConsent({ tosAcceptedAt: new Date(0) })).toBe(false);
    expect(needsConsent({ tosAcceptedAt: "2024-01-01T00:00:00Z" })).toBe(false);
  });
});
