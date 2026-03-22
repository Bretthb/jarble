import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the env module before importing encryption functions
vi.mock("./env.js", () => ({
  env: {
    API_KEY_ENCRYPTION_KEY: undefined as string | undefined,
  },
}));

import { encryptApiKey, decryptApiKey } from "./encryption.js";
import { env } from "./env.js";
import crypto from "crypto";

const mockedEnv = vi.mocked(env);

// A valid 32-byte key as 64 hex chars
const VALID_KEY = crypto.randomBytes(32).toString("hex");

beforeEach(() => {
  mockedEnv.API_KEY_ENCRYPTION_KEY = undefined;
});

// ── encryptApiKey ─────────────────────────────────────────────────────────────

describe("encryptApiKey", () => {
  it("returns plain: prefix when no encryption key is set", () => {
    const result = encryptApiKey("sk-test-123");
    expect(result).toBe("plain:sk-test-123");
  });

  it("returns enc: prefix when encryption key is set", () => {
    mockedEnv.API_KEY_ENCRYPTION_KEY = VALID_KEY;
    const result = encryptApiKey("sk-test-123");
    expect(result).toMatch(/^enc:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it("produces different ciphertext each call (random IV)", () => {
    mockedEnv.API_KEY_ENCRYPTION_KEY = VALID_KEY;
    const a = encryptApiKey("same-key");
    const b = encryptApiKey("same-key");
    expect(a).not.toBe(b);
  });

  it("handles empty string plaintext", () => {
    mockedEnv.API_KEY_ENCRYPTION_KEY = VALID_KEY;
    const result = encryptApiKey("");
    expect(result).toMatch(/^enc:/);
  });

  it("encrypts special characters and unicode", () => {
    mockedEnv.API_KEY_ENCRYPTION_KEY = VALID_KEY;
    const result = encryptApiKey("sk-tëst-🔑-日本語");
    expect(result).toMatch(/^enc:/);
  });

  it("encrypts very long keys", () => {
    mockedEnv.API_KEY_ENCRYPTION_KEY = VALID_KEY;
    const longKey = "x".repeat(10_000);
    const result = encryptApiKey(longKey);
    expect(result).toMatch(/^enc:/);
  });
});

// ── decryptApiKey ─────────────────────────────────────────────────────────────

describe("decryptApiKey", () => {
  it("strips plain: prefix", () => {
    const result = decryptApiKey("plain:sk-test-123");
    expect(result).toBe("sk-test-123");
  });

  it("handles plain: with empty value after prefix", () => {
    const result = decryptApiKey("plain:");
    expect(result).toBe("");
  });

  it("passes through legacy plaintext (no prefix)", () => {
    const result = decryptApiKey("sk-legacy-no-prefix");
    expect(result).toBe("sk-legacy-no-prefix");
  });

  it("round-trips encrypt then decrypt", () => {
    mockedEnv.API_KEY_ENCRYPTION_KEY = VALID_KEY;
    const original = "sk-ant-api03-test-key-12345";
    const encrypted = encryptApiKey(original);
    const decrypted = decryptApiKey(encrypted);
    expect(decrypted).toBe(original);
  });

  it("round-trips unicode and special characters", () => {
    mockedEnv.API_KEY_ENCRYPTION_KEY = VALID_KEY;
    const original = "sk-tëst-🔑-日本語-café";
    const encrypted = encryptApiKey(original);
    const decrypted = decryptApiKey(encrypted);
    expect(decrypted).toBe(original);
  });

  it("round-trips very long keys", () => {
    mockedEnv.API_KEY_ENCRYPTION_KEY = VALID_KEY;
    const original = "A".repeat(10_000);
    const encrypted = encryptApiKey(original);
    const decrypted = decryptApiKey(encrypted);
    expect(decrypted).toBe(original);
  });

  it("round-trips empty string", () => {
    mockedEnv.API_KEY_ENCRYPTION_KEY = VALID_KEY;
    const encrypted = encryptApiKey("");
    const decrypted = decryptApiKey(encrypted);
    expect(decrypted).toBe("");
  });

  it("throws when decrypting enc: format without encryption key", () => {
    mockedEnv.API_KEY_ENCRYPTION_KEY = VALID_KEY;
    const encrypted = encryptApiKey("sk-test");
    mockedEnv.API_KEY_ENCRYPTION_KEY = undefined;
    expect(() => decryptApiKey(encrypted)).toThrow(
      "Cannot decrypt API key: API_KEY_ENCRYPTION_KEY is not set"
    );
  });

  it("throws on malformed enc: string (too few parts)", () => {
    mockedEnv.API_KEY_ENCRYPTION_KEY = VALID_KEY;
    expect(() => decryptApiKey("enc:onlyonepart")).toThrow(
      "Malformed encrypted API key"
    );
  });

  it("throws on malformed enc: string (too many parts)", () => {
    mockedEnv.API_KEY_ENCRYPTION_KEY = VALID_KEY;
    expect(() => decryptApiKey("enc:a:b:c:d")).toThrow(
      "Malformed encrypted API key"
    );
  });

  it("throws on tampered ciphertext", () => {
    mockedEnv.API_KEY_ENCRYPTION_KEY = VALID_KEY;
    const encrypted = encryptApiKey("sk-test");
    // Tamper with the ciphertext (last segment)
    const parts = encrypted.split(":");
    parts[3] = "ff".repeat(parts[3].length / 2);
    const tampered = parts.join(":");
    expect(() => decryptApiKey(tampered)).toThrow();
  });

  it("throws on tampered auth tag", () => {
    mockedEnv.API_KEY_ENCRYPTION_KEY = VALID_KEY;
    const encrypted = encryptApiKey("sk-test");
    // Tamper with the auth tag (second segment after enc:)
    const parts = encrypted.split(":");
    parts[2] = "00".repeat(16);
    const tampered = parts.join(":");
    expect(() => decryptApiKey(tampered)).toThrow();
  });

  it("throws when decrypting with a different key", () => {
    mockedEnv.API_KEY_ENCRYPTION_KEY = VALID_KEY;
    const encrypted = encryptApiKey("sk-test");
    // Switch to a different key
    mockedEnv.API_KEY_ENCRYPTION_KEY = crypto
      .randomBytes(32)
      .toString("hex");
    expect(() => decryptApiKey(encrypted)).toThrow();
  });
});
