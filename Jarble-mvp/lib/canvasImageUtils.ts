"use client";

/**
 * canvasImageUtils - utilities for capturing, compressing, and describing
 * the canvas state as images or text for LLM context.
 */

import type { DrawStroke, CanvasCard } from "@/components/workspace/types";

// ── Render DrawStrokes to a base64 PNG ────────────────────────────────────────

/**
 * Renders an array of DrawStrokes onto an offscreen canvas and returns
 * a base64 PNG data URL. Useful for capturing freehand drawings independently
 * of the DOM (e.g. when html2canvas can't capture SVG overlays reliably).
 */
export function renderStrokesToCanvas(
  strokes: DrawStroke[],
  width: number,
  height: number,
): string | null {
  if (strokes.length === 0 || width <= 0 || height <= 0) return null;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Transparent background
    ctx.clearRect(0, 0, width, height);

    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;

      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = stroke.opacity;

      const [first, ...rest] = stroke.points;
      ctx.moveTo(first.x, first.y);
      for (const pt of rest) {
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    }

    // Reset alpha
    ctx.globalAlpha = 1.0;

    return canvas.toDataURL("image/png");
  } catch (err) {
    console.warn("[canvasImageUtils] renderStrokesToCanvas failed:", err);
    return null;
  }
}

// ── Image compression ────────────────────────────────────────────────────────

/**
 * Resizes and compresses a base64 image to keep it under LLM size preferences.
 * Defaults to maxWidth=1024px and quality=0.7 (JPEG).
 * Returns a base64 data URL (image/jpeg for compression, image/png if input is PNG with transparency).
 */
export async function compressImage(
  base64: string,
  maxWidth = 1024,
  quality = 0.7,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        let { width, height } = img;

        // Scale down if wider than maxWidth
        if (width > maxWidth) {
          const ratio = maxWidth / width;
          width = maxWidth;
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(base64); // Fallback: return original
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        // Use JPEG for better compression (lossy is fine for LLM context)
        const compressed = canvas.toDataURL("image/jpeg", quality);

        // If compressed is larger than original (unlikely but possible with small images), return original
        if (compressed.length > base64.length) {
          resolve(base64);
          return;
        }

        resolve(compressed);
      } catch (err) {
        console.warn("[canvasImageUtils] compressImage failed:", err);
        resolve(base64); // Fallback: return original
      }
    };
    img.onerror = () => {
      reject(new Error("Failed to load image for compression"));
    };
    img.src = base64;
  });
}

// ── Text description fallback ────────────────────────────────────────────────

/**
 * Generates a structured text description of the canvas layout.
 * Used as a fallback when screenshot capture isn't available or desired
 * (e.g. SSR, headless, or when images are too large for context).
 */
export function canvasStateToImageDescription(cards: CanvasCard[]): string {
  if (cards.length === 0) {
    return "The canvas is empty - no components are displayed.";
  }

  const lines: string[] = [];
  lines.push(`Canvas contains ${cards.length} component${cards.length === 1 ? "" : "s"}:`);
  lines.push("");

  // Sort by position (top-to-bottom, left-to-right) for natural reading order
  const sorted = [...cards].sort((a, b) => {
    const rowA = Math.floor(a.position.y / 100);
    const rowB = Math.floor(b.position.y / 100);
    if (rowA !== rowB) return rowA - rowB;
    return a.position.x - b.position.x;
  });

  for (let i = 0; i < sorted.length; i++) {
    const card = sorted[i];
    const label = card.title || card.component.replace(/_/g, " ");
    const status = card.minimized ? " [minimized]" : "";
    const pinned = card.pinned ? " [pinned]" : "";
    const selected = card.selected ? " [selected]" : "";
    const error = card.lastRenderError ? ` [error: ${card.lastRenderError.slice(0, 60)}]` : "";

    lines.push(
      `${i + 1}. **${label}** (${card.component})${status}${pinned}${selected}${error}`
    );
    lines.push(
      `   Position: (${card.position.x}, ${card.position.y}) | Size: ${card.size.width}x${card.size.height}`
    );

    // Include key props summary based on component type
    const summary = summarizeProps(card.component, card.props);
    if (summary) {
      lines.push(`   ${summary}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

// ── Prop summarization per component type ────────────────────────────────────

function summarizeProps(component: string, props: Record<string, unknown>): string | null {
  switch (component) {
    case "chart": {
      const chartType = props.type || props.chartType || "unknown";
      const title = props.title || "";
      const dataLen = Array.isArray(props.data) ? props.data.length : 0;
      return `Chart type: ${chartType}${title ? `, title: "${title}"` : ""}, ${dataLen} data points`;
    }
    case "data_table": {
      const cols = Array.isArray(props.columns) ? props.columns.length : 0;
      const rows = Array.isArray(props.rows) ? props.rows.length : 0;
      const title = props.title || "";
      return `${cols} columns, ${rows} rows${title ? `, title: "${title}"` : ""}`;
    }
    case "stat_grid": {
      const stats = Array.isArray(props.stats) ? props.stats.length : 0;
      return `${stats} stat cards`;
    }
    case "card": {
      const title = props.title || props.heading || "";
      return title ? `Title: "${title}"` : null;
    }
    case "text_message": {
      const body = typeof props.body === "string" ? props.body : "";
      return body ? `Text: "${body.slice(0, 80)}${body.length > 80 ? "..." : ""}"` : null;
    }
    case "code_block":
    case "code_editor": {
      const lang = props.language || props.lang || "unknown";
      const code = typeof props.code === "string" ? props.code : "";
      return `Language: ${lang}, ${code.split("\n").length} lines`;
    }
    case "sandbox": {
      const html = typeof props.html === "string" ? props.html : "";
      return `Sandbox: ${html.length} chars of HTML`;
    }
    case "image": {
      const alt = props.alt || props.caption || "";
      return alt ? `Image: "${alt}"` : "Image";
    }
    case "metric_card": {
      const label = props.label || "";
      const value = props.value ?? "";
      return `${label}: ${value}`;
    }
    case "tabs": {
      const tabs = Array.isArray(props.tabs) ? props.tabs.length : 0;
      return `${tabs} tabs`;
    }
    case "form": {
      const fields = Array.isArray(props.fields) ? props.fields.length : 0;
      return `${fields} form fields`;
    }
    case "list": {
      const items = Array.isArray(props.items) ? props.items.length : 0;
      return `${items} list items`;
    }
    case "timeline": {
      const events = Array.isArray(props.events) ? props.events.length : 0;
      return `${events} timeline events`;
    }
    case "key_value": {
      const items = Array.isArray(props.items) ? props.items.length : 0;
      return `${items} key-value pairs`;
    }
    case "alert": {
      const variant = props.variant || "default";
      const title = props.title || "";
      return `${variant} alert${title ? `: "${title}"` : ""}`;
    }
    case "page": {
      const sections = props.sections;
      const sectionCount = sections && typeof sections === "object" ? Object.keys(sections).length : 0;
      return `Page with ${sectionCount} sections`;
    }
    default:
      return null;
  }
}
