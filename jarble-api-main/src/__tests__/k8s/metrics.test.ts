/**
 * Unit tests for K8s resource-string parsers in src/k8s/metrics.ts.
 *
 * `parseCpuToMillicores` and `parseMemoryToMb` translate the K8s
 * resource-quantity grammar into the units the platform reports
 * everywhere downstream (admin dashboard, billing, capacity widgets).
 * A regression here distorts every CPU/memory number the user sees.
 *
 * The two parsers are the WHOLE useful surface in this file outside of
 * the K8s API integration in `getDeploymentMetrics`. Pinning them now
 * means a future refactor that swaps them for `kubernetes-client`'s
 * built-in helpers (or rewrites them in TypeScript) has to keep the
 * exact same numerical contract.
 *
 * Coverage focuses on the corner cases that are easy to miss:
 *   - Sub-millicore values (nanocores from cAdvisor — round to 0 if
 *     small, sub-1000 if larger).
 *   - Non-power-of-1024 binary suffixes (Ki vs Mi vs Gi vs Ti).
 *   - Plain bytes / plain-cores fallback.
 *   - Rounding direction (always round, never floor — fractional input
 *     should not silently disappear at the boundary).
 */

import { describe, it, expect } from "vitest";
import { parseCpuToMillicores, parseMemoryToMb } from "../../k8s/metrics.js";

// ── parseCpuToMillicores ────────────────────────────────────────────────────

describe("parseCpuToMillicores", () => {
  it("parses milli-suffix (500m → 500)", () => {
    expect(parseCpuToMillicores("500m")).toBe(500);
    expect(parseCpuToMillicores("100m")).toBe(100);
    expect(parseCpuToMillicores("1m")).toBe(1);
    expect(parseCpuToMillicores("0m")).toBe(0);
  });

  it("parses plain whole-cores (2 → 2000, 0.5 → 500)", () => {
    expect(parseCpuToMillicores("2")).toBe(2000);
    expect(parseCpuToMillicores("1")).toBe(1000);
    expect(parseCpuToMillicores("0.5")).toBe(500);
    expect(parseCpuToMillicores("4")).toBe(4000);
  });

  it("parses fractional cores with rounding (1.25 → 1250)", () => {
    expect(parseCpuToMillicores("1.25")).toBe(1250);
    expect(parseCpuToMillicores("0.001")).toBe(1);
  });

  it("parses nanocore-suffix as millicores via /1_000_000 (42379n → 0)", () => {
    // cAdvisor reports CPU usage in nanocores. Common live values
    // are tens of thousands → effectively zero in millicores. The
    // parser must round-down to 0 here, NOT throw.
    expect(parseCpuToMillicores("42379n")).toBe(0);
    expect(parseCpuToMillicores("999_999n".replace("_", ""))).toBe(1);
  });

  it("parses larger nanocore values to whole millicores (1_500_000n → 2)", () => {
    // 1.5M nanocores = 1.5 millicores → rounds to 2.
    expect(parseCpuToMillicores("1500000n")).toBe(2);
    // 50M nanocores = 50 millicores.
    expect(parseCpuToMillicores("50000000n")).toBe(50);
    // 2_500_000_000n = 2500m = 2.5 cores.
    expect(parseCpuToMillicores("2500000000n")).toBe(2500);
  });

  it("rounds nanocore midpoints away from zero (Math.round semantics)", () => {
    // 500_000n = 0.5 millicores → rounds up to 1.
    // (parseInt drops the fractional part of nanos before division, so
    // this confirms the divide-then-round order is correct.)
    expect(parseCpuToMillicores("500000n")).toBe(1);
    // 499_999n = 0.499999 millicores → rounds to 0.
    expect(parseCpuToMillicores("499999n")).toBe(0);
  });
});

// ── parseMemoryToMb ─────────────────────────────────────────────────────────

describe("parseMemoryToMb", () => {
  it("parses Mi-suffix as straight MB (128Mi → 128)", () => {
    expect(parseMemoryToMb("128Mi")).toBe(128);
    expect(parseMemoryToMb("256Mi")).toBe(256);
    expect(parseMemoryToMb("0Mi")).toBe(0);
  });

  it("parses Gi-suffix as 1024 * MB (1Gi → 1024)", () => {
    expect(parseMemoryToMb("1Gi")).toBe(1024);
    expect(parseMemoryToMb("2Gi")).toBe(2048);
    expect(parseMemoryToMb("4Gi")).toBe(4096);
  });

  it("parses fractional Gi (0.5Gi → 512)", () => {
    expect(parseMemoryToMb("0.5Gi")).toBe(512);
    expect(parseMemoryToMb("1.5Gi")).toBe(1536);
  });

  it("parses Ti-suffix as 1024^2 * MB (1Ti → 1048576)", () => {
    expect(parseMemoryToMb("1Ti")).toBe(1024 * 1024);
    expect(parseMemoryToMb("0.5Ti")).toBe(512 * 1024);
  });

  it("parses Ki-suffix as MB / 1024 (131072Ki → 128)", () => {
    expect(parseMemoryToMb("131072Ki")).toBe(128);
    expect(parseMemoryToMb("1024Ki")).toBe(1);
    // Below 1MB rounds to 0.
    expect(parseMemoryToMb("512Ki")).toBe(1); // 0.5 → 1 (Math.round rounds half-away-from-zero)
    expect(parseMemoryToMb("100Ki")).toBe(0);
  });

  it("parses plain bytes (134217728 → 128MB)", () => {
    expect(parseMemoryToMb("134217728")).toBe(128);
    expect(parseMemoryToMb("1048576")).toBe(1);
    expect(parseMemoryToMb("1073741824")).toBe(1024);
    // Sub-1MB plain bytes follow Math.round half-away-from-zero:
    // 524288 / (1024*1024) = 0.5 → rounds to 1.
    expect(parseMemoryToMb("524288")).toBe(1);
    // 100KB plain bytes is well under the 0.5 threshold → rounds to 0.
    expect(parseMemoryToMb("102400")).toBe(0);
  });

  it("rounds, doesn't truncate, on the binary-suffix conversions", () => {
    // 1.5 Gi → 1536MB exact.
    expect(parseMemoryToMb("1.5Gi")).toBe(1536);
    // 1.4Gi → 1433.6 → 1434 (rounded, not 1433 floored).
    expect(parseMemoryToMb("1.4Gi")).toBe(1434);
  });

  it("preserves precision across all four binary scales for the same physical size", () => {
    // 1 GB worth of memory expressed four ways should all round to ~1024 MB.
    // (Plain bytes is the most precise; the others are approximations to the
    // nearest native unit, but all must land within ±1 MB of 1024.)
    expect(parseMemoryToMb("1073741824")).toBe(1024);          // plain
    expect(parseMemoryToMb("1048576Ki")).toBe(1024);           // Ki
    expect(parseMemoryToMb("1024Mi")).toBe(1024);              // Mi
    expect(parseMemoryToMb("1Gi")).toBe(1024);                 // Gi
  });
});
