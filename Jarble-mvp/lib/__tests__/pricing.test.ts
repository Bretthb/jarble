import { describe, it, expect } from "vitest";
import { calculateMonthlyPriceCents, formatPriceCents } from "../pricing";

describe("pricing", () => {
  // ── calculateMonthlyPriceCents ───────────────────────────────────────────

  describe("calculateMonthlyPriceCents", () => {
    it("calculates correct price for standard config (2.0 vCPU, 2048 MB, 30 GB)", () => {
      // CPU: 2.0 * 1000 = 2000
      // RAM: (2048 / 1024) * 250 = 500
      // Storage: 30 * 8 = 240
      // Total: 2740
      const result = calculateMonthlyPriceCents("2.0", 2048, 30);
      expect(result).toBe(2740);
    });

    it("handles fractional CPU (e.g. 0.5)", () => {
      // CPU: 0.5 * 1000 = 500
      // RAM: (1024 / 1024) * 250 = 250
      // Storage: 10 * 8 = 80
      // Total: 830
      const result = calculateMonthlyPriceCents("0.5", 1024, 10);
      expect(result).toBe(830);
    });

    it("handles zero CPU", () => {
      // CPU: 0 * 1000 = 0
      // RAM: (512 / 1024) * 250 = 125
      // Storage: 5 * 8 = 40
      // Total: 165
      const result = calculateMonthlyPriceCents("0", 512, 5);
      expect(result).toBe(165);
    });

    it("handles string CPU input (parseFloat)", () => {
      // parseFloat("1.5") = 1.5
      // CPU: 1.5 * 1000 = 1500
      // RAM: (2048 / 1024) * 250 = 500
      // Storage: 20 * 8 = 160
      // Total: 2160
      const result = calculateMonthlyPriceCents("1.5", 2048, 20);
      expect(result).toBe(2160);
    });

    it("returns 0 for all-zero inputs", () => {
      const result = calculateMonthlyPriceCents("0", 0, 0);
      expect(result).toBe(0);
    });
  });

  // ── formatPriceCents ─────────────────────────────────────────────────────

  describe("formatPriceCents", () => {
    it("formats 2500 as $25.00", () => {
      expect(formatPriceCents(2500)).toBe("$25.00");
    });

    it("formats 99 as $0.99", () => {
      expect(formatPriceCents(99)).toBe("$0.99");
    });

    it("formats 0 as $0.00", () => {
      expect(formatPriceCents(0)).toBe("$0.00");
    });

    it("formats 10050 as $100.50", () => {
      expect(formatPriceCents(10050)).toBe("$100.50");
    });
  });
});
