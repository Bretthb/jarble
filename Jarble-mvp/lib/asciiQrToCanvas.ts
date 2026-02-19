/**
 * Converts ASCII art QR codes (using unicode block characters) to a canvas image.
 *
 * Terminal QR codes use INVERTED colors (light chars = dark modules):
 * - "█" (full block U+2588) = both top and bottom pixels are WHITE (background)
 * - "▀" (upper half U+2580) = top WHITE, bottom BLACK
 * - "▄" (lower half U+2584) = top BLACK, bottom WHITE
 * - " " (space) = both pixels BLACK (QR module)
 *
 * Each character represents a 2x1 cell (2 vertical pixels compressed into 1 character).
 */

export function parseAsciiQr(ascii: string): boolean[][] {
  const lines = ascii.split("\n").filter(line => line.length > 0);

  if (lines.length === 0) return [];

  // Each line represents 2 rows of pixels
  const height = lines.length * 2;
  const width = Math.max(...lines.map(l => l.length));

  // Initialize matrix with white (false = white, true = black)
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
        case "█": // Full block - both WHITE (background)
          // Leave as false (white)
          break;
        case "▀": // Upper half block - top WHITE, bottom BLACK
          if (bottomRow < height) matrix[bottomRow][x] = true;
          break;
        case "▄": // Lower half block - top BLACK, bottom WHITE
          matrix[topRow][x] = true;
          break;
        case " ": // Space - both BLACK (QR module)
          matrix[topRow][x] = true;
          if (bottomRow < height) matrix[bottomRow][x] = true;
          break;
        default:
          // Other characters treated as background (white)
          break;
      }
    }
  }

  return matrix;
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
