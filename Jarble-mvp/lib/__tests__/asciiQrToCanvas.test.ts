/**
 * Unit tests for the pure parser in `lib/asciiQrToCanvas.ts`.
 *
 * `parseAsciiQr` translates Unicode-block-art QR codes into a 2D
 * boolean matrix (true = dark module, false = light). The platform
 * receives QR codes as ASCII strings from terminal-rendering libs
 * (each character represents a 2-pixel-tall vertical strip), and
 * different libs invert the foreground/background convention.
 * `parseAsciiQr` auto-detects the inversion by scoring the top-left
 * finder pattern and flipping the whole matrix if needed.
 *
 * Two contracts pinned:
 *
 *   1. **Unicode block grammar** — █ (U+2588) = both rows filled,
 *      ▀ (U+2580) = top only, ▄ (U+2584) = bottom only, space =
 *      neither. A regression that mis-decoded the half-blocks would
 *      cause every QR scan in the platform to fail.
 *
 *   2. **Auto-inversion via finder-pattern detection** — when the
 *      input is the inverted convention (foreground = light), the
 *      function flips the matrix so callers always get
 *      "true = dark module".
 *
 * `renderQrToCanvas` and `asciiQrToDataUrl` are DOM-bound and
 * tested separately (they need an actual canvas element).
 */

import { describe, it, expect } from "vitest";
import { parseAsciiQr } from "../asciiQrToCanvas";

// ── Empty / degenerate input ────────────────────────────────────────────────

describe("parseAsciiQr — degenerate input", () => {
  it("returns an empty matrix for an empty string", () => {
    expect(parseAsciiQr("")).toEqual([]);
  });

  it("returns an empty matrix for whitespace-only input (lines have length 0 after filter)", () => {
    expect(parseAsciiQr("\n\n\n")).toEqual([]);
  });

  it("ignores empty lines (filter discards them before parsing)", () => {
    // Two filled rows separated by a blank line produces just 4 rows
    // (2 lines × 2 vertical pixels each), not 6.
    const matrix = parseAsciiQr("█\n\n█");
    expect(matrix).toHaveLength(4);
  });
});

// ── Unicode block grammar ───────────────────────────────────────────────────

describe("parseAsciiQr — Unicode block grammar", () => {
  it("█ (full block) fills both top and bottom rows", () => {
    // Single character, single line → 2 rows × 1 col matrix, both true.
    // (The auto-inversion only flips when a finder pattern scores
    // higher inverted; for a 2x1 matrix scanLimit is 0 so no
    // inversion can happen — output is the raw decoding.)
    const matrix = parseAsciiQr("█");
    expect(matrix).toEqual([[true], [true]]);
  });

  it("space character leaves both rows empty", () => {
    const matrix = parseAsciiQr(" ");
    expect(matrix).toEqual([[false], [false]]);
  });

  it("▀ (upper half) fills top row only", () => {
    const matrix = parseAsciiQr("▀");
    expect(matrix).toEqual([[true], [false]]);
  });

  it("▄ (lower half) fills bottom row only", () => {
    const matrix = parseAsciiQr("▄");
    expect(matrix).toEqual([[false], [true]]);
  });

  it("decodes a mixed-character row correctly", () => {
    // Four columns: full / upper / lower / space.
    const matrix = parseAsciiQr("█▀▄ ");
    expect(matrix).toHaveLength(2);
    expect(matrix[0]).toEqual([true, true, false, false]);
    expect(matrix[1]).toEqual([true, false, true, false]);
  });

  it("pads short lines with falses to match the widest line", () => {
    // Line 1 is 3 chars wide, line 2 is 1 char. Width should be 3.
    const matrix = parseAsciiQr("█▀▄\n█");
    expect(matrix[0]).toHaveLength(3);
    // Line 2's columns 1 and 2 are not in the input → both rows
    // stay false at those positions.
    expect(matrix[2][1]).toBe(false);
    expect(matrix[2][2]).toBe(false);
    expect(matrix[3][1]).toBe(false);
    expect(matrix[3][2]).toBe(false);
  });

  it("ignores unknown characters (treats as background)", () => {
    // 'X' is not in the grammar; must not crash, must leave both rows false.
    const matrix = parseAsciiQr("X");
    expect(matrix).toEqual([[false], [false]]);
  });
});

// ── Auto-inversion via finder-pattern detection ─────────────────────────────

describe("parseAsciiQr — auto-inversion", () => {
  /**
   * Build a 14-row × 7-column ASCII string where the top 7 rows form
   * a perfect QR finder pattern (7x7 block — outer ring dark, inner
   * ring light, center 3x3 dark). 14 rows = 7 ASCII lines × 2 pixels.
   *
   * The function expects scanLimit to find a finder pattern starting
   * at (0, 0), so we render exactly the canonical pattern.
   */
  function makeFinderAscii(invert: boolean): string {
    // Build the 7x7 finder pattern as a boolean matrix first.
    const pattern: boolean[][] = [];
    for (let r = 0; r < 7; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < 7; c++) {
        const isEdge = r === 0 || r === 6 || c === 0 || c === 6;
        const isInnerEdge = !isEdge && (r === 1 || r === 5 || c === 1 || c === 5);
        const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        // Direct convention: edge=dark, innerEdge=light, center=dark.
        let dark = isEdge || isCenter;
        if (invert) dark = !dark;
        row.push(dark);
      }
      pattern.push(row);
    }
    // Render to ASCII: each line covers 2 vertical rows.
    // Rows 0-1, 2-3, 4-5 → 3 ASCII lines; row 6 → one extra ASCII line
    // where the bottom row stays false (pad to 14 actual rows).
    const asciiLines: string[] = [];
    for (let asciiRow = 0; asciiRow < 4; asciiRow++) {
      let line = "";
      for (let c = 0; c < 7; c++) {
        const top = asciiRow * 2 < 7 ? pattern[asciiRow * 2][c] : false;
        const bot = asciiRow * 2 + 1 < 7 ? pattern[asciiRow * 2 + 1][c] : false;
        if (top && bot) line += "█";
        else if (top) line += "▀";
        else if (bot) line += "▄";
        else line += " ";
      }
      asciiLines.push(line);
    }
    return asciiLines.join("\n");
  }

  it("direct convention (foreground=dark) returns matrix matching the finder pattern", () => {
    const matrix = parseAsciiQr(makeFinderAscii(false));
    // Outer 7x7 should all match the canonical finder pattern.
    // Top-left corner (0,0) is an edge cell → dark in direct convention.
    expect(matrix[0][0]).toBe(true);
    // Center (3,3) is a center cell → dark.
    expect(matrix[3][3]).toBe(true);
    // Inner-edge (1,1) is a light cell → false.
    expect(matrix[1][1]).toBe(false);
  });

  it("inverted convention (foreground=light) flips back to canonical orientation", () => {
    // Render the pattern with INVERTED foreground/background. After
    // parseAsciiQr's auto-detect + flip, the output should match the
    // canonical pattern (NOT the inverted one).
    const matrix = parseAsciiQr(makeFinderAscii(true));
    // Same positional assertions as the direct test — the auto-flip
    // should make the inverted input look identical to the direct one.
    expect(matrix[0][0]).toBe(true);
    expect(matrix[3][3]).toBe(true);
    expect(matrix[1][1]).toBe(false);
  });
});
