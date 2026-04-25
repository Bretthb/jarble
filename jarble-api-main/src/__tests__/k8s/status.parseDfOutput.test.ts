/**
 * Unit tests for parseDfOutput in src/k8s/status.ts.
 *
 * The helper translates `df -B1 <path>` stdout into the
 * `StorageUsage` row the platform reports everywhere downstream
 * (Files panel header, admin storage gauges, the storage-enforcement
 * service that auto-stops over-quota pods at 100%).
 *
 * Two contracts worth pinning:
 *
 *   1. **Numeric correctness** — usedBytes / totalBytes must come
 *      out of column 2 / column 1 (not column 0 = Filesystem name).
 *      A regression that read the wrong column would mark every
 *      deployment as over-quota and the storage-enforcement sweep
 *      would stop them all.
 *
 *   2. **Defensive parse failure → null** — empty stdout, single-
 *      line stdout, malformed columns, or non-numeric byte values
 *      must return null (NOT throw, NOT return zeros). The caller
 *      uses the null to fall back to the DB value; throwing here
 *      would crash the storage-enforcement sweep.
 */

import { describe, it, expect } from "vitest";
import { parseDfOutput } from "../../k8s/status.js";

// A real sample from `df -B1 /data` on a Longhorn-mounted PVC. Indented
// alignment uses spaces and the column count is fixed at 6 (the
// "Mounted on" column at the end).
const REAL_DF_OUTPUT = [
  "Filesystem    1B-blocks    Used    Available  Use%  Mounted on",
  "/dev/longhorn/pvc-abc 21474836480 1073741824 20401094656 5% /data",
].join("\n");

describe("parseDfOutput — happy path", () => {
  it("parses a real-world df sample into the StorageUsage shape", () => {
    const r = parseDfOutput(REAL_DF_OUTPUT)!;
    expect(r).toBeDefined();
    expect(r.totalBytes).toBe(21474836480);   // 20 GiB
    expect(r.usedBytes).toBe(1073741824);     // 1 GiB
    expect(r.totalGb).toBe(20);
    expect(r.usedGb).toBe(1);
    expect(r.percentUsed).toBe(5);
  });

  it("rounds usedGb / totalGb to 2 decimal places", () => {
    // 1.5 GiB used = 1610612736 bytes.
    // After /GB → 1.5, * 100 → 150, round → 150, / 100 → 1.5
    const sample = [
      "Filesystem 1B-blocks Used Available Use% Mounted on",
      "/dev/x 5368709120 1610612736 3758096384 30% /data", // 5 GiB total, 1.5 GiB used
    ].join("\n");
    const r = parseDfOutput(sample)!;
    expect(r.totalGb).toBe(5);
    expect(r.usedGb).toBe(1.5);
  });

  it("rounds percentUsed to 1 decimal place", () => {
    // 33.333...% → 33.3
    // 1073741824 used / 3221225472 total → 0.3333... → 33.33% → round to 33.3
    const sample = [
      "Filesystem 1B-blocks Used Available Use% Mounted on",
      "/dev/x 3221225472 1073741824 2147483648 33% /data",
    ].join("\n");
    const r = parseDfOutput(sample)!;
    expect(r.percentUsed).toBe(33.3);
  });

  it("calculates percentUsed=100 when usage equals total", () => {
    const sample = [
      "Filesystem 1B-blocks Used Available Use% Mounted on",
      "/dev/x 1073741824 1073741824 0 100% /data",
    ].join("\n");
    const r = parseDfOutput(sample)!;
    expect(r.percentUsed).toBe(100);
  });

  it("handles tab-delimited output (df may use tabs in some environments)", () => {
    // `\s+` regex catches tabs as well.
    const sample = [
      "Filesystem\t1B-blocks\tUsed\tAvailable\tUse%\tMounted on",
      "/dev/x\t1073741824\t536870912\t536870912\t50%\t/data",
    ].join("\n");
    const r = parseDfOutput(sample)!;
    expect(r.totalBytes).toBe(1073741824);
    expect(r.usedBytes).toBe(536870912);
  });
});

describe("parseDfOutput — defensive parse failure", () => {
  it("returns null for empty input", () => {
    expect(parseDfOutput("")).toBeNull();
  });

  it("returns null for whitespace-only input", () => {
    expect(parseDfOutput("   \n\t  ")).toBeNull();
  });

  it("returns null when there's only one line (header but no data row)", () => {
    expect(parseDfOutput("Filesystem 1B-blocks Used Available Use% Mounted on")).toBeNull();
  });

  it("returns null when the data line has fewer than 6 columns", () => {
    const sample = [
      "Filesystem 1B-blocks Used Available Use% Mounted on",
      "/dev/x 1000 500", // missing Available, Use%, Mounted on
    ].join("\n");
    expect(parseDfOutput(sample)).toBeNull();
  });

  it("returns null when totalBytes is not a number", () => {
    const sample = [
      "Filesystem 1B-blocks Used Available Use% Mounted on",
      "/dev/x not-a-number 500 4500 10% /data",
    ].join("\n");
    expect(parseDfOutput(sample)).toBeNull();
  });

  it("returns null when usedBytes is not a number", () => {
    const sample = [
      "Filesystem 1B-blocks Used Available Use% Mounted on",
      "/dev/x 1000 not-a-number 4500 10% /data",
    ].join("\n");
    expect(parseDfOutput(sample)).toBeNull();
  });

  it("does NOT throw on any malformed input", () => {
    // The storage-enforcement sweep catches a thrown exception via a
    // try/catch in getDeploymentStorageUsage, but defense-in-depth:
    // the parser itself MUST return null instead of throwing.
    expect(() => parseDfOutput("garbage")).not.toThrow();
    expect(() => parseDfOutput("\n\n\n")).not.toThrow();
    expect(() => parseDfOutput("a b c d e f\ng h i j k l\nm n o p q r")).not.toThrow();
    // (The third case has 3 valid-looking lines but the data line has
    // non-numeric byte values — should return null without throwing.)
  });

  it("returns percentUsed=0 (not NaN, not Infinity) when totalBytes is 0", () => {
    // Defensive: a zero-byte filesystem is degenerate but the helper
    // should NOT divide-by-zero. percentUsed must be 0.
    const sample = [
      "Filesystem 1B-blocks Used Available Use% Mounted on",
      "/dev/x 0 0 0 - /data",
    ].join("\n");
    const r = parseDfOutput(sample)!;
    expect(r.percentUsed).toBe(0);
    expect(Number.isFinite(r.percentUsed)).toBe(true);
  });
});

describe("parseDfOutput — storage-enforcement boundary", () => {
  // The storage-enforcement service stops a pod when percentUsed >= 100.
  // These tests pin the boundary so a cleanup of the rounding math
  // doesn't accidentally let a 99.95% pod escape the sweep.
  it("99.94% usage rounds DOWN to 99.9 (under the 100% trigger)", () => {
    // 9994 / 10000 = 0.9994 → 99.94% → round to 99.9
    const sample = [
      "Filesystem 1B-blocks Used Available Use% Mounted on",
      "/dev/x 10000 9994 6 100% /data",
    ].join("\n");
    const r = parseDfOutput(sample)!;
    expect(r.percentUsed).toBe(99.9);
  });

  it("99.96% usage rounds UP to 100.0 (triggers the sweep)", () => {
    // 9996 / 10000 = 0.9996 → 99.96% → round to 100.0
    const sample = [
      "Filesystem 1B-blocks Used Available Use% Mounted on",
      "/dev/x 10000 9996 4 100% /data",
    ].join("\n");
    const r = parseDfOutput(sample)!;
    expect(r.percentUsed).toBe(100);
  });
});
