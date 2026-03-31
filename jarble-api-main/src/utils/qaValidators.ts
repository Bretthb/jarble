/**
 * QA Validators - pure synchronous functions for validating composed components.
 *
 * Run in Phase 3 (Synthesize) of the compose pipeline, after all component
 * agents return but before sending to the frontend.
 *
 * Also used by debug_component / test_dashboard MCP tools.
 * A JS reimplementation exists in jarble-ui-server.js for pod-side usage.
 */

import { TRUSTED_CDN_ORIGINS } from "@jarble/component-manifest";
import { validateJsonSchema, autofixNativeProps } from "./jsonSchemaValidator.js";

// ── Result type ───────────────────────────────────────────────────────────────

export interface QAValidationResult {
  validator: string;
  passed: boolean;
  warnings: string[];
  fixes: string[];
  details?: Record<string, unknown>;
}

// ── CSP Compliance ────────────────────────────────────────────────────────────

function isUrlTrustedCdn(url: string): boolean {
  if (!url.startsWith("https://")) return false;
  try {
    const parsed = new URL(url);
    return TRUSTED_CDN_ORIGINS.includes(parsed.origin);
  } catch {
    return false;
  }
}

// No `g` flag on regexes used with .test() - prevents lastIndex state bugs across calls
const INLINE_HANDLER_RE = /\bon(?:click|load|error|mouse\w+|key\w+|submit|change|input|focus|blur)\s*=\s*["']/i;
const EVAL_RE = /\beval\s*\(/;
const NEW_FUNCTION_RE = /\bnew\s+Function\s*\(/;
const IFRAME_RE = /<iframe[\s>]/i;
const DOC_WRITE_RE = /\bdocument\.write\s*\(/;

export function validateCspCompliance(html: string): QAValidationResult {
  const warnings: string[] = [];
  const fixes: string[] = [];
  let cleaned = html;

  // Check script sources (fresh regex per call to avoid lastIndex issues)
  let match: RegExpExecArray | null;
  const srcRe = /<script[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((match = srcRe.exec(html)) !== null) {
    const url = match[1];
    if (!isUrlTrustedCdn(url)) {
      warnings.push(`Script from non-CDN origin: ${url}`);
    }
  }

  // Inline event handlers
  if (INLINE_HANDLER_RE.test(html)) {
    warnings.push("Inline event handlers detected (onclick=, onload=, etc.)");
    cleaned = cleaned.replace(INLINE_HANDLER_RE, "data-removed-handler=");
    fixes.push("Stripped inline event handlers");
  }

  // eval / Function
  if (EVAL_RE.test(html)) {
    warnings.push("eval() usage detected");
  }
  if (NEW_FUNCTION_RE.test(html)) {
    warnings.push("new Function() usage detected");
  }

  // iframe creation
  if (IFRAME_RE.test(html)) {
    warnings.push("iframe creation detected inside sandbox");
    cleaned = cleaned.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "<!-- iframe removed -->");
    fixes.push("Stripped iframe tags");
  }

  // document.write
  if (DOC_WRITE_RE.test(html)) {
    warnings.push("document.write() usage detected");
  }

  return {
    validator: "csp_compliance",
    passed: warnings.length === 0,
    warnings,
    fixes,
    details: fixes.length > 0 ? { cleanedHtml: cleaned } : undefined,
  };
}

// ── HTML Integrity ────────────────────────────────────────────────────────────

const JARBLE_READY_RE = /jarble:ready/;
const READY_SNIPPET = `\nwindow.parent.postMessage({ type: 'jarble:ready' }, '*');\n`;

export function validateHtmlIntegrity(html: string): QAValidationResult {
  const warnings: string[] = [];
  const fixes: string[] = [];
  let cleaned = html;

  // Check for unclosed critical tags
  for (const tag of ["script", "style", "div", "table"]) {
    const opens = (html.match(new RegExp(`<${tag}[\\s>]`, "gi")) || []).length;
    const closes = (html.match(new RegExp(`</${tag}\\s*>`, "gi")) || []).length;
    if (opens > closes) {
      warnings.push(`Unclosed <${tag}> tag (${opens} opens, ${closes} closes)`);
    }
  }

  // Check for jarble:ready signal
  if (!JARBLE_READY_RE.test(html)) {
    warnings.push("Missing jarble:ready postMessage signal");
    // Auto-fix: append to the last </script> or at the end
    const lastScript = cleaned.lastIndexOf("</script>");
    if (lastScript !== -1) {
      cleaned = cleaned.slice(0, lastScript) + READY_SNIPPET + cleaned.slice(lastScript);
    } else {
      cleaned += `<script>${READY_SNIPPET}</script>`;
    }
    fixes.push("Appended jarble:ready signal");
  }

  // DOM size estimate
  const tagCount = (html.match(/<[a-z]/gi) || []).length;
  if (tagCount > 500) {
    warnings.push(`Excessive DOM size: ~${tagCount} elements (recommended < 500)`);
  }

  return {
    validator: "html_integrity",
    passed: warnings.filter((w) => !w.includes("jarble:ready")).length === 0,
    warnings,
    fixes,
    details: fixes.length > 0 ? { cleanedHtml: cleaned } : undefined,
  };
}

// ── Native Props ──────────────────────────────────────────────────────────────

export function validateNativeProps(
  component: string,
  props: Record<string, unknown>,
  schema?: Record<string, unknown>,
): QAValidationResult {
  const warnings: string[] = [];
  const fixes: string[] = [];

  // Auto-fix first
  const fixed = autofixNativeProps(component, { ...props });
  const fixKeys = Object.keys(fixed).filter(
    (k) => JSON.stringify(fixed[k]) !== JSON.stringify(props[k]),
  );
  if (fixKeys.length > 0) {
    fixes.push(`Auto-fixed fields: ${fixKeys.join(", ")}`);
  }

  // Schema validation
  if (schema) {
    const errors = validateJsonSchema(fixed, schema);
    for (const err of errors) {
      warnings.push(`${err.path}: ${err.message}`);
    }
  }

  // Component-specific sanity checks
  if (component === "data_table") {
    if (Array.isArray(fixed.rows) && fixed.rows.length === 0) {
      warnings.push("data_table has empty rows array");
    }
    if (!Array.isArray(fixed.columns) || fixed.columns.length === 0) {
      warnings.push("data_table missing columns");
    }
  }
  if (component === "chart") {
    if (Array.isArray(fixed.data) && fixed.data.length === 0) {
      warnings.push("chart has empty data array");
    }
    if (!Array.isArray(fixed.dataKeys) || fixed.dataKeys.length === 0) {
      warnings.push("chart missing dataKeys");
    }
  }
  if (component === "stat_grid") {
    if (Array.isArray(fixed.stats) && fixed.stats.length === 0) {
      warnings.push("stat_grid has empty stats array");
    }
  }

  return {
    validator: "native_props",
    passed: warnings.length === 0,
    warnings,
    fixes,
    details: fixKeys.length > 0 ? { fixedProps: fixed } : undefined,
  };
}

// ── Data Consistency ──────────────────────────────────────────────────────────

interface BlockForConsistency {
  type: "native" | "sandbox";
  component: string;
  props: Record<string, unknown>;
}

function extractNumericValue(val: unknown): number | null {
  if (typeof val === "number") return val;
  if (typeof val !== "string") return null;
  const cleaned = val.replace(/[$€£¥,\s%]/g, "");
  // Handle K/M/B suffixes
  const suffixMatch = cleaned.match(/^(-?[\d.]+)\s*([KMBkmb])?$/);
  if (!suffixMatch) return null;
  let num = parseFloat(suffixMatch[1]);
  if (isNaN(num)) return null;
  const suffix = (suffixMatch[2] || "").toUpperCase();
  if (suffix === "K") num *= 1_000;
  else if (suffix === "M") num *= 1_000_000;
  else if (suffix === "B") num *= 1_000_000_000;
  return num;
}

export function validateDataConsistency(blocks: BlockForConsistency[]): QAValidationResult {
  const warnings: string[] = [];

  // Extract labeled metrics from all blocks
  const metrics: Array<{ label: string; value: number; source: string }> = [];

  for (const block of blocks) {
    const p = block.props;

    // stat_grid stats
    if (block.component === "stat_grid" && Array.isArray(p.stats)) {
      for (const stat of p.stats as Array<{ label?: string; value?: unknown }>) {
        if (stat.label && stat.value !== undefined) {
          const num = extractNumericValue(stat.value);
          if (num !== null) {
            metrics.push({ label: stat.label.toLowerCase(), value: num, source: "stat_grid" });
          }
        }
      }
    }

    // metric_card
    if (block.component === "metric_card" && p.label && p.value !== undefined) {
      const num = extractNumericValue(p.value);
      if (num !== null) {
        metrics.push({ label: (p.label as string).toLowerCase(), value: num, source: "metric_card" });
      }
    }
  }

  // Check for same-label metric conflicts (> 2 orders of magnitude difference)
  const byLabel = new Map<string, typeof metrics>();
  for (const m of metrics) {
    const key = m.label.replace(/[^a-z0-9]/g, "");
    if (!byLabel.has(key)) byLabel.set(key, []);
    byLabel.get(key)!.push(m);
  }

  for (const [label, group] of byLabel) {
    if (group.length < 2) continue;
    const values = group.map((g) => g.value).filter((v) => v !== 0);
    if (values.length < 2) continue;
    const min = Math.min(...values.map(Math.abs));
    const max = Math.max(...values.map(Math.abs));
    if (min > 0 && max / min > 100) {
      warnings.push(
        `Metric "${group[0].label}" has inconsistent values: ${group.map((g) => `${g.value} (${g.source})`).join(" vs ")}`,
      );
    }
  }

  // Check currency symbol consistency
  const currencySymbols = new Set<string>();
  for (const block of blocks) {
    const json = JSON.stringify(block.props);
    if (json.includes("$")) currencySymbols.add("$");
    if (json.includes("€")) currencySymbols.add("€");
    if (json.includes("£")) currencySymbols.add("£");
    if (json.includes("¥")) currencySymbols.add("¥");
  }
  if (currencySymbols.size > 1) {
    warnings.push(`Mixed currency symbols across components: ${[...currencySymbols].join(", ")}`);
  }

  return {
    validator: "data_consistency",
    passed: warnings.length === 0,
    warnings,
    fixes: [],
  };
}

// ── Run all validators ────────────────────────────────────────────────────────

export interface QAReport {
  passed: boolean;
  results: Array<QAValidationResult & { slotIndex?: number }>;
  totalWarnings: number;
  totalFixes: number;
}

export function runPipelineQA(
  blocks: Array<{
    type: "native" | "sandbox";
    slotIndex: number;
    component: string;
    props: Record<string, unknown>;
    html?: string;
  }>,
  schemas: Record<string, Record<string, unknown>>,
): QAReport {
  const results: Array<QAValidationResult & { slotIndex?: number }> = [];

  for (const block of blocks) {
    if (block.type === "sandbox" && block.html) {
      const csp = validateCspCompliance(block.html);
      results.push({ ...csp, slotIndex: block.slotIndex });

      const integrity = validateHtmlIntegrity(block.html);
      results.push({ ...integrity, slotIndex: block.slotIndex });

      // Apply auto-fixes to the block's HTML
      if (csp.details?.cleanedHtml) {
        block.html = csp.details.cleanedHtml as string;
      }
      if (integrity.details?.cleanedHtml) {
        block.html = integrity.details.cleanedHtml as string;
      }
    }

    if (block.type === "native") {
      const nativeResult = validateNativeProps(block.component, block.props, schemas[block.component]);
      results.push({ ...nativeResult, slotIndex: block.slotIndex });

      // Apply auto-fixed props
      if (nativeResult.details?.fixedProps) {
        block.props = nativeResult.details.fixedProps as Record<string, unknown>;
      }
    }
  }

  // Cross-component consistency
  const consistencyBlocks = blocks.filter((b) => b.type === "native").map((b) => ({
    type: b.type,
    component: b.component,
    props: b.props,
  }));
  if (consistencyBlocks.length >= 2) {
    const consistency = validateDataConsistency(consistencyBlocks);
    results.push(consistency);
  }

  const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);
  const totalFixes = results.reduce((sum, r) => sum + r.fixes.length, 0);

  return {
    passed: results.every((r) => r.passed),
    results,
    totalWarnings,
    totalFixes,
  };
}
