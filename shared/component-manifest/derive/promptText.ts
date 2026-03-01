/**
 * Generate prompt reference text from the component manifest.
 *
 * Produces the "Component Quick Reference" section embedded in soul.md
 * so the LLM knows how to use components without calling component_reference.
 */

import type { ComponentManifestEntry } from "../types.js";

/** The top 10 components to include inline in the prompt */
const TOP_10_NAMES = [
  "chart",
  "data_table",
  "card",
  "metric_card",
  "stat_grid",
  "list",
  "alert",
  "code_block",
  "layout",
  "sandbox",
];

/**
 * Generate the Component Quick Reference text for the soul.md prompt.
 *
 * @param manifest - The full component manifest record
 * @param options.top10Only - If true, only emit the top 10 components inline
 *   and add a pointer to the component_reference tool for the rest.
 */
export function generatePromptReference(
  manifest: Record<string, ComponentManifestEntry>,
  options?: { top10Only?: boolean }
): string {
  const lines: string[] = [];

  if (options?.top10Only) {
    lines.push("### Component Quick Reference (Top 10)");

    for (const name of TOP_10_NAMES) {
      const entry = manifest[name];
      if (!entry) continue;
      // Match the existing format: **name**: `{props}` -- description
      const guidance = entry.promptGuidance
        ? ` -- ${entry.promptGuidance}`
        : ` -- ${entry.description.toLowerCase()}`;
      lines.push(`**${name}**: ${entry.reference}${guidance}`);
    }

    // Count remaining
    const allBuiltin = Object.values(manifest).filter((e) => e.builtin);
    const remaining = allBuiltin.length - TOP_10_NAMES.length;
    if (remaining > 0) {
      lines.push("");
      lines.push(
        `${remaining} more components available. Call \`component_reference\` for full props: timeline, tabs, accordion, form, button_group, progress, badge, header, divider, key_value, image, video, steps, result, and more.`
      );
      lines.push("");
      lines.push("Full details: call `component_reference` tool.");
    }
  } else {
    // Full reference — all components grouped by category
    lines.push("### Component Quick Reference");
    lines.push("");

    const categories: Record<string, ComponentManifestEntry[]> = {};
    for (const entry of Object.values(manifest)) {
      if (!entry.builtin) continue;
      const cat = entry.category;
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(entry);
    }

    const categoryOrder = ["display", "chart", "interactive", "media", "specialized"];
    const categoryLabels: Record<string, string> = {
      display: "Display",
      chart: "Charts",
      interactive: "Interactive",
      media: "Media",
      specialized: "Specialized",
    };

    for (const cat of categoryOrder) {
      const entries = categories[cat];
      if (!entries || entries.length === 0) continue;
      lines.push(`**${categoryLabels[cat] || cat}**`);
      for (const entry of entries) {
        lines.push(`- **${entry.name}**: ${entry.reference}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
