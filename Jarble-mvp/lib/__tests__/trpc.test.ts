import { describe, it, expect, vi } from "vitest";
import { API_URL, trpc } from "@/lib/trpc";
import { setTokenGetter, getToken, vanillaClient } from "@/lib/trpc-vanilla";

describe("trpc", () => {
  describe("API_URL", () => {
    it("is a string", () => {
      expect(typeof API_URL).toBe("string");
    });

    it("is a valid URL", () => {
      expect(API_URL).toMatch(/^https?:\/\//);
    });

    it("defaults to localhost:3001 when env not set", () => {
      // In test env, NEXT_PUBLIC_API_URL is typically not set
      // so it falls back to localhost:3001
      expect(API_URL).toBe("http://localhost:3001");
    });
  });

  describe("trpc client", () => {
    it("exports a trpc object", () => {
      expect(trpc).toBeDefined();
    });

    it("is callable (createTRPCReact returns a proxy)", () => {
      expect(trpc).toBeTruthy();
    });
  });
});

describe("trpc-vanilla", () => {
  describe("setTokenGetter + getToken", () => {
    it("sets and retrieves token via getter", async () => {
      const mockGetter = vi.fn().mockResolvedValue("test-token-123");
      setTokenGetter(mockGetter);
      const token = await getToken();
      expect(token).toBe("test-token-123");
      expect(mockGetter).toHaveBeenCalled();
    });

    it("returns null when token getter throws", async () => {
      setTokenGetter(() => Promise.reject(new Error("Auth expired")));
      const token = await getToken();
      expect(token).toBeNull();
    });
  });

  describe("vanillaClient", () => {
    it("exports a vanillaClient object", () => {
      expect(vanillaClient).toBeDefined();
    });

    it("is a tRPC client", () => {
      expect(vanillaClient).toBeTruthy();
    });
  });
});
