import { describe, it, expect } from "vitest";
import { calculateMonthlyPriceCents } from "./pricing.js";

// Pricing constants (from source):
//   CPU:     $10.00 / 1.0 vCPU  = 1000 cents/vCPU
//   RAM:     $2.50  / 1 GB      = 250  cents/GB  (input is MB, so /1024)
//   Storage: $0.08  / 1 GB      = 8    cents/GB  (input already in GB despite name)

describe("calculateMonthlyPriceCents", () => {
  it("calculates correctly for 1 vCPU, 1GB RAM, 20GB storage", () => {
    // CPU: 1 * 1000 = 1000
    // RAM: 1024/1024 * 250 = 250
    // Storage: 20 * 8 = 160
    // Total: 1410
    expect(calculateMonthlyPriceCents("1", 1024, 20)).toBe(1410);
  });

  it("calculates correctly for 2 vCPU, 2GB RAM, 30GB storage", () => {
    // CPU: 2 * 1000 = 2000
    // RAM: 2048/1024 * 250 = 500
    // Storage: 30 * 8 = 240
    // Total: 2740
    expect(calculateMonthlyPriceCents("2", 2048, 30)).toBe(2740);
  });

  it("handles fractional CPU like '0.5'", () => {
    // CPU: 0.5 * 1000 = 500
    // RAM: 512/1024 * 250 = 125
    // Storage: 10 * 8 = 80
    // Total: 705
    expect(calculateMonthlyPriceCents("0.5", 512, 10)).toBe(705);
  });

  it("handles zero values", () => {
    expect(calculateMonthlyPriceCents("0", 0, 0)).toBe(0);
  });

  it("handles non-numeric CPU string (NaN fallback to 0)", () => {
    // parseFloat("abc") => NaN, || 0 => 0
    // RAM: 1024/1024 * 250 = 250
    // Storage: 10 * 8 = 80
    expect(calculateMonthlyPriceCents("abc", 1024, 10)).toBe(330);
  });

  it("handles empty CPU string (NaN fallback to 0)", () => {
    expect(calculateMonthlyPriceCents("", 1024, 10)).toBe(330);
  });

  it("rounds result to nearest integer", () => {
    // CPU: 0.3 * 1000 = 300
    // RAM: 100/1024 * 250 ≈ 24.4140625
    // Storage: 1 * 8 = 8
    // Total ≈ 332.4140625 → 332
    expect(calculateMonthlyPriceCents("0.3", 100, 1)).toBe(332);
  });

  it("handles large values", () => {
    // CPU: 64 * 1000 = 64000
    // RAM: 524288/1024 * 250 = 128000
    // Storage: 2000 * 8 = 16000
    // Total: 208000
    expect(calculateMonthlyPriceCents("64", 524288, 2000)).toBe(208000);
  });

  it("handles CPU string with decimal point and trailing zero", () => {
    // "2.0" → parseFloat = 2.0
    expect(calculateMonthlyPriceCents("2.0", 0, 0)).toBe(2000);
  });

  it("returns only CPU cost when RAM and storage are zero", () => {
    expect(calculateMonthlyPriceCents("1", 0, 0)).toBe(1000);
  });
});
