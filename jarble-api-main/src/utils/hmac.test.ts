/**
 * Unit tests for HMAC-SHA256 signing and verification utilities.
 *
 * Tests generateSigningSecret, signRequest, verifySignature, and round-trip flows.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  generateSigningSecret,
  signRequest,
  verifySignature,
  MAX_TIMESTAMP_DRIFT_MS,
} from "./hmac.js";

describe("generateSigningSecret", () => {
  it("returns a 64-character hex string (32 bytes)", () => {
    const secret = generateSigningSecret();
    expect(secret).toHaveLength(64);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns unique values on each call", () => {
    const a = generateSigningSecret();
    const b = generateSigningSecret();
    const c = generateSigningSecret();
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });
});

describe("signRequest", () => {
  it("produces a signature in sha256=<hex> format", () => {
    const secret = generateSigningSecret();
    const sig = signRequest(secret, Date.now(), '{"test":true}');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("is deterministic for the same inputs", () => {
    const secret = "a".repeat(64);
    const timestamp = 1700000000000;
    const body = '{"action":"test"}';

    const sig1 = signRequest(secret, timestamp, body);
    const sig2 = signRequest(secret, timestamp, body);
    expect(sig1).toBe(sig2);
  });

  it("produces different signatures for different bodies", () => {
    const secret = generateSigningSecret();
    const ts = Date.now();

    const sig1 = signRequest(secret, ts, '{"a":1}');
    const sig2 = signRequest(secret, ts, '{"a":2}');
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different timestamps", () => {
    const secret = generateSigningSecret();
    const body = '{"test":true}';

    const sig1 = signRequest(secret, 1000, body);
    const sig2 = signRequest(secret, 2000, body);
    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different secrets", () => {
    const ts = Date.now();
    const body = '{"test":true}';

    const sig1 = signRequest("a".repeat(64), ts, body);
    const sig2 = signRequest("b".repeat(64), ts, body);
    expect(sig1).not.toBe(sig2);
  });
});

describe("verifySignature", () => {
  const secret = generateSigningSecret();

  it("accepts a valid signature with a current timestamp", () => {
    const ts = Date.now();
    const body = '{"hello":"world"}';
    const sig = signRequest(secret, ts, body);

    const result = verifySignature(secret, sig, ts, body);
    expect(result).toEqual({ valid: true });
  });

  it("rejects a tampered body", () => {
    const ts = Date.now();
    const body = '{"original":true}';
    const sig = signRequest(secret, ts, body);

    const result = verifySignature(secret, sig, ts, '{"tampered":true}');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Invalid signature");
    }
  });

  it("rejects a tampered signature", () => {
    const ts = Date.now();
    const body = '{"test":true}';
    const sig = signRequest(secret, ts, body);

    // Tamper with the hex portion — flip the last character
    const tampered = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");

    const result = verifySignature(secret, tampered, ts, body);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Invalid signature");
    }
  });

  it("rejects an expired timestamp (more than 5 minutes old)", () => {
    const ts = Date.now() - MAX_TIMESTAMP_DRIFT_MS - 1000; // 6 minutes ago
    const body = '{"test":true}';
    const sig = signRequest(secret, ts, body);

    const result = verifySignature(secret, sig, ts, body);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("Timestamp too old");
    }
  });

  it("accepts a future timestamp within the 5-minute window", () => {
    const ts = Date.now() + (MAX_TIMESTAMP_DRIFT_MS - 10_000); // ~4 min in the future
    const body = '{"test":true}';
    const sig = signRequest(secret, ts, body);

    const result = verifySignature(secret, sig, ts, body);
    expect(result).toEqual({ valid: true });
  });

  it("rejects a future timestamp beyond the 5-minute window", () => {
    const ts = Date.now() + MAX_TIMESTAMP_DRIFT_MS + 1000; // 6 min in the future
    const body = '{"test":true}';
    const sig = signRequest(secret, ts, body);

    const result = verifySignature(secret, sig, ts, body);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("Timestamp too old");
    }
  });

  it("handles different-length signatures gracefully (constant-time safety)", () => {
    const ts = Date.now();
    const body = '{"test":true}';

    // Too short
    const resultShort = verifySignature(secret, "sha256=abc", ts, body);
    expect(resultShort.valid).toBe(false);
    if (!resultShort.valid) {
      expect(resultShort.error).toBe("Invalid signature");
    }

    // Too long
    const resultLong = verifySignature(
      secret,
      "sha256=" + "a".repeat(128),
      ts,
      body,
    );
    expect(resultLong.valid).toBe(false);
    if (!resultLong.valid) {
      expect(resultLong.error).toBe("Invalid signature");
    }

    // Empty string
    const resultEmpty = verifySignature(secret, "", ts, body);
    expect(resultEmpty.valid).toBe(false);
  });

  it("rejects a signature signed with a different secret", () => {
    const otherSecret = generateSigningSecret();
    const ts = Date.now();
    const body = '{"test":true}';
    const sig = signRequest(otherSecret, ts, body);

    const result = verifySignature(secret, sig, ts, body);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Invalid signature");
    }
  });
});

describe("round-trip sign then verify", () => {
  it("succeeds with the same secret, timestamp, and body", () => {
    const secret = generateSigningSecret();
    const ts = Date.now();
    const body = JSON.stringify({ action: "install", packageId: "pkg-123" });

    const sig = signRequest(secret, ts, body);
    const result = verifySignature(secret, sig, ts, body);
    expect(result).toEqual({ valid: true });
  });

  it("works with an empty body", () => {
    const secret = generateSigningSecret();
    const ts = Date.now();
    const body = "";

    const sig = signRequest(secret, ts, body);
    const result = verifySignature(secret, sig, ts, body);
    expect(result).toEqual({ valid: true });
  });

  it("works with a large body", () => {
    const secret = generateSigningSecret();
    const ts = Date.now();
    const body = JSON.stringify({ data: "x".repeat(100_000) });

    const sig = signRequest(secret, ts, body);
    const result = verifySignature(secret, sig, ts, body);
    expect(result).toEqual({ valid: true });
  });

  it("works with unicode body content", () => {
    const secret = generateSigningSecret();
    const ts = Date.now();
    const body = JSON.stringify({ message: "Gest\u00e3o de tarefas \u2014 \ud83c\udf1f" });

    const sig = signRequest(secret, ts, body);
    const result = verifySignature(secret, sig, ts, body);
    expect(result).toEqual({ valid: true });
  });
});
