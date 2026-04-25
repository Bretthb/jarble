/**
 * Unit tests for `lib/clientVault.ts`.
 *
 * The client vault is the platform's E2E-encrypted user-secret path:
 * user-only credentials are encrypted in the browser before being
 * sent to the server, which stores an opaque blob it CANNOT decrypt.
 * Only the user's browser (with the correct userId + deploymentId)
 * can recover the plaintext.
 *
 * The contract is tiny but security-load-bearing:
 *
 *   1. **Round-trip recovers the original plaintext** — the most
 *      basic test, but also the only one that proves the
 *      "user-encrypted, server-stored, user-decrypted" pipeline
 *      actually works.
 *
 *   2. **Cross-user isolation** — `clientDecrypt` with the wrong
 *      userId or deploymentId returns null, NOT a thrown exception
 *      and NOT silently-wrong plaintext. A regression that returned
 *      a different user's secret would be a critical security bug.
 *
 *   3. **Malformed input rejection** — invalid base64, truncated
 *      ciphertext, junk strings all return null without throwing.
 *      Important because `encrypted` arrives untrusted from the DB
 *      (it could have been mangled by a half-rolled migration).
 *
 * jsdom v28 exposes Web Crypto natively (`crypto.subtle` lands on
 * `globalThis.crypto`), so these tests run unmodified in the
 * existing test environment.
 */

import { describe, it, expect } from "vitest";
import { clientEncrypt, clientDecrypt } from "../clientVault";

const USER = "auth0|user-123";
const DEPLOYMENT = "dep-abc-456";

// ── Round-trip ──────────────────────────────────────────────────────────────

describe("clientEncrypt + clientDecrypt round-trip", () => {
  it("encrypt → decrypt recovers the original plaintext", async () => {
    const plaintext = "sk-secret-api-key-12345";
    const encrypted = await clientEncrypt(plaintext, USER, DEPLOYMENT);
    const decrypted = await clientDecrypt(encrypted, USER, DEPLOYMENT);
    expect(decrypted).toBe(plaintext);
  });

  it("works for unicode + emoji + control chars (UTF-8 round-trip)", async () => {
    const plaintext = "héllo 🌍 — control\tchar\n​ and lookalikes";
    const encrypted = await clientEncrypt(plaintext, USER, DEPLOYMENT);
    expect(await clientDecrypt(encrypted, USER, DEPLOYMENT)).toBe(plaintext);
  });

  it("works for an empty string", async () => {
    const encrypted = await clientEncrypt("", USER, DEPLOYMENT);
    expect(await clientDecrypt(encrypted, USER, DEPLOYMENT)).toBe("");
  });

  it("works for very long plaintext (100 KB)", async () => {
    const plaintext = "x".repeat(100_000);
    const encrypted = await clientEncrypt(plaintext, USER, DEPLOYMENT);
    expect(await clientDecrypt(encrypted, USER, DEPLOYMENT)).toBe(plaintext);
  });

  it("ciphertext is non-deterministic — same plaintext encrypted twice produces different output", () => {
    // AES-GCM with a random IV per call → ciphertext varies. This is
    // important: a deterministic ciphertext would let an attacker tell
    // whether two stored blobs are equal without decrypting either.
    return Promise.all([
      clientEncrypt("same-plaintext", USER, DEPLOYMENT),
      clientEncrypt("same-plaintext", USER, DEPLOYMENT),
    ]).then(([a, b]) => {
      expect(a).not.toBe(b);
    });
  });

  it("ciphertext is base64 (printable ASCII only) so it survives JSON round-trips", async () => {
    const encrypted = await clientEncrypt("anything", USER, DEPLOYMENT);
    // Base64 alphabet: A-Z a-z 0-9 + / =
    expect(encrypted).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

// ── Cross-user / cross-deployment isolation ────────────────────────────────

describe("clientDecrypt — isolation", () => {
  const PLAINTEXT = "sk-mine-only";

  it("returns null when userId differs (different account → no leak)", async () => {
    const encrypted = await clientEncrypt(PLAINTEXT, USER, DEPLOYMENT);
    const cross = await clientDecrypt(encrypted, "auth0|other-user", DEPLOYMENT);
    expect(cross).toBeNull();
  });

  it("returns null when deploymentId differs (same user, different deployment)", async () => {
    const encrypted = await clientEncrypt(PLAINTEXT, USER, DEPLOYMENT);
    const cross = await clientDecrypt(encrypted, USER, "dep-someone-elses");
    expect(cross).toBeNull();
  });

  it("returns null when both userId AND deploymentId differ", async () => {
    const encrypted = await clientEncrypt(PLAINTEXT, USER, DEPLOYMENT);
    const cross = await clientDecrypt(encrypted, "auth0|other", "dep-other");
    expect(cross).toBeNull();
  });

  it("does NOT throw on cross-user decrypt — the failure is a graceful null", async () => {
    const encrypted = await clientEncrypt(PLAINTEXT, USER, DEPLOYMENT);
    // No try/catch — the test would fail if clientDecrypt threw.
    await expect(clientDecrypt(encrypted, "wrong-user", DEPLOYMENT)).resolves.toBeNull();
  });
});

// ── Malformed input ─────────────────────────────────────────────────────────

describe("clientDecrypt — malformed input", () => {
  it("returns null for non-base64 garbage (decode throws → caught)", async () => {
    expect(await clientDecrypt("not-base64!!!", USER, DEPLOYMENT)).toBeNull();
  });

  it("returns null for empty string (no IV, no ciphertext)", async () => {
    expect(await clientDecrypt("", USER, DEPLOYMENT)).toBeNull();
  });

  it("returns null when the ciphertext was truncated (auth tag verification fails)", async () => {
    const encrypted = await clientEncrypt("real plaintext", USER, DEPLOYMENT);
    // Lop off the last 8 chars → AES-GCM auth tag check fails.
    const truncated = encrypted.slice(0, -8);
    expect(await clientDecrypt(truncated, USER, DEPLOYMENT)).toBeNull();
  });

  it("returns null when one byte of ciphertext is flipped (auth tag detects tampering)", async () => {
    const encrypted = await clientEncrypt("real plaintext", USER, DEPLOYMENT);
    // Flip the LAST char of the base64 string → auth tag fails verification.
    const lastChar = encrypted[encrypted.length - 1];
    const flipped = encrypted.slice(0, -1) + (lastChar === "A" ? "B" : "A");
    expect(await clientDecrypt(flipped, USER, DEPLOYMENT)).toBeNull();
  });

  it("returns null for input with only an IV but no ciphertext (12-byte buffer)", async () => {
    // 12 random bytes → 16 base64 chars (padded). Decrypting should
    // fail because there's no ciphertext + auth tag.
    const ivOnly = "AAAAAAAAAAAAAAAA"; // 12 bytes of zero, base64
    expect(await clientDecrypt(ivOnly, USER, DEPLOYMENT)).toBeNull();
  });
});
