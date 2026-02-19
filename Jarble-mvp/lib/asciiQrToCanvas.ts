/**
 * Converts ASCII art QR codes (using unicode block characters) to a canvas image.
 *
 * Each character represents a 2x1 cell (2 vertical pixels compressed into 1 character):
 * - "█" (full block U+2588) = both top and bottom filled (foreground)
 * - "▀" (upper half U+2580) = top filled, bottom empty
 * - "▄" (lower half U+2584) = top empty, bottom filled
 * - " " (space) = both empty (background)
 *
 * The inversion (which color = dark QR module) varies by terminal QR library,
 * so we auto-detect using the QR finder pattern structure.
 */

function parseRaw(ascii: string): boolean[][] {
  const lines = ascii.split("\n").filter(line => line.length > 0);

  if (lines.length === 0) return [];

  const height = lines.length * 2;
  const width = Math.max(...lines.map(l => l.length));

  // true = foreground (filled block), false = background (space)
  const matrix: boolean[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => false)
  );

  for (let y = 0; y < lines.length; y++) {
    const line = lines[y];
    for (let x = 0; x < line.length; x++) {
      const char = line[x];
      const topRow = y * 2;
      const bottomRow = y * 2 + 1;

      switch (char) {
        case "█":
          matrix[topRow][x] = true;
          if (bottomRow < height) matrix[bottomRow][x] = true;
          break;
        case "▀":
          matrix[topRow][x] = true;
          break;
        case "▄":
          if (bottomRow < height) matrix[bottomRow][x] = true;
          break;
        case " ":
          // both false (background)
          break;
        default:
          break;
      }
    }
  }

  return matrix;
}

/**
 * Check if a 7x7 region at (startR, startC) looks like a QR finder pattern.
 * Finder pattern: 7x7 dark border, 5x5 light inner, 3x3 dark center.
 * Returns a confidence score (0-1).
 */
function finderScore(matrix: boolean[][], startR: number, startC: number, dark: boolean): number {
  if (startR + 7 > matrix.length || startC + 7 > (matrix[0]?.length ?? 0)) return 0;

  let matches = 0;
  let total = 0;

  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const isEdge = r === 0 || r === 6 || c === 0 || c === 6;
      const isInnerEdge = !isEdge && (r === 1 || r === 5 || c === 1 || c === 5);
      const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;

      const expected = isEdge ? dark : isInnerEdge ? !dark : dark;
      if (matrix[startR + r][startC + c] === expected) matches++;
      total++;
    }
  }

  return matches / total;
}

export function parseAsciiQr(ascii: string): boolean[][] {
  const raw = parseRaw(ascii);
  if (raw.length === 0) return [];

  // Try to find the QR code's top-left finder pattern to determine inversion.
  // Scan the first few rows/cols for the best finder pattern match.
  const h = raw.length;
  const w = raw[0]?.length ?? 0;
  const scanLimit = Math.min(8, Math.floor(h / 3), Math.floor(w / 3));

  let bestScore = 0;
  let needsInvert = false;

  for (let r = 0; r < scanLimit; r++) {
    for (let c = 0; c < scanLimit; c++) {
      // Test: foreground = dark QR module
      const scoreDirect = finderScore(raw, r, c, true);
      if (scoreDirect > bestScore) {
        bestScore = scoreDirect;
        needsInvert = false;
      }
      // Test: foreground = light (inverted terminal)
      const scoreInvert = finderScore(raw, r, c, false);
      if (scoreInvert > bestScore) {
        bestScore = scoreInvert;
        needsInvert = true;
      }
    }
  }

  // Apply inversion if needed (foreground chars map to white, spaces map to dark)
  if (needsInvert) {
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        raw[r][c] = !raw[r][c];
      }
    }
  }

  return raw;
}

export function renderQrToCanvas(
  matrix: boolean[][],
  canvas: HTMLCanvasElement,
  pixelSize: number = 4,
  quietZone: number = 4
): void {
  if (matrix.length === 0) return;

  const height = matrix.length;
  const width = matrix[0].length;

  const totalWidth = (width + quietZone * 2) * pixelSize;
  const totalHeight = (height + quietZone * 2) * pixelSize;

  canvas.width = totalWidth;
  canvas.height = totalHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Fill background white
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  // Draw black modules
  ctx.fillStyle = "#000000";
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (matrix[y][x]) {
        ctx.fillRect(
          (x + quietZone) * pixelSize,
          (y + quietZone) * pixelSize,
          pixelSize,
          pixelSize
        );
      }
    }
  }
}

export function asciiQrToDataUrl(
  ascii: string,
  pixelSize: number = 4,
  quietZone: number = 4
): string | null {
  if (typeof document === "undefined") return null;

  const matrix = parseAsciiQr(ascii);
  if (matrix.length === 0) return null;

  const canvas = document.createElement("canvas");
  renderQrToCanvas(matrix, canvas, pixelSize, quietZone);

  return canvas.toDataURL("image/png");
}
