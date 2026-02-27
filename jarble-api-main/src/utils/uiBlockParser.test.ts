import { describe, it, expect } from "vitest";
import {
  extractUIBlocks,
  extractUIUpdates,
  extractComponentDefs,
  extractAllUIBlocks,
} from "./uiBlockParser.js";

// ── extractUIBlocks ──────────────────────────────────────────────────────────

describe("extractUIBlocks", () => {
  it("extracts a single jarble_ui block", () => {
    const text = `Here is a chart:\n\`\`\`jarble_ui\n{"component":"chart","props":{"type":"bar","data":[]}}\n\`\`\`\nDone.`;
    const { cleanText, uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
    expect(uiBlocks[0].component).toBe("chart");
    expect(uiBlocks[0].props).toEqual({ type: "bar", data: [] });
    expect(cleanText).toBe("Here is a chart:\n\nDone.");
  });

  it("extracts multiple jarble_ui blocks", () => {
    const text = [
      "```jarble_ui",
      '{"component":"card","props":{"title":"A"}}',
      "```",
      "text between",
      "```jarble_ui",
      '{"component":"card","props":{"title":"B"}}',
      "```",
    ].join("\n");
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(2);
    expect(uiBlocks[0].props.title).toBe("A");
    expect(uiBlocks[1].props.title).toBe("B");
  });

  it("preserves editable and fileId fields", () => {
    const text = '```jarble_ui\n{"component":"code_editor","props":{"code":"x=1"},"editable":true,"fileId":"main.py"}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks[0].editable).toBe(true);
    expect(uiBlocks[0].fileId).toBe("main.py");
  });

  it("leaves invalid JSON as visible text", () => {
    const text = "```jarble_ui\n{invalid json}\n```";
    const { cleanText, uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(0);
    expect(cleanText).toContain("{invalid json}");
  });

  it("leaves blocks missing component or props as text", () => {
    const text = '```jarble_ui\n{"component":"chart"}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(0);
  });

  it("does NOT match jarble_ui_update blocks", () => {
    const text = '```jarble_ui_update\n{"card_id":"x","props":{"title":"Y"}}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(0);
  });

  it("does NOT match jarble_ui_define blocks", () => {
    const text = '```jarble_ui_define\n{"name":"foo","layout":[{"component":"card","props":{}}]}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(0);
  });

  it("enforces MAX_BLOCKS (20)", () => {
    const blocks = Array.from({ length: 25 }, (_, i) =>
      `\`\`\`jarble_ui\n{"component":"card","props":{"title":"${i}"}}\n\`\`\``
    ).join("\n");
    const { uiBlocks } = extractUIBlocks(blocks);
    expect(uiBlocks).toHaveLength(20);
  });

  it("generates unique IDs for each block", () => {
    const text = [
      '```jarble_ui\n{"component":"card","props":{"title":"A"}}\n```',
      '```jarble_ui\n{"component":"card","props":{"title":"B"}}\n```',
    ].join("\n");
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks[0].id).not.toBe(uiBlocks[1].id);
  });
});

// ── extractUIUpdates ─────────────────────────────────────────────────────────

describe("extractUIUpdates", () => {
  it("extracts a single update block", () => {
    const text = '```jarble_ui_update\n{"card_id":"card-abc","props":{"title":"Updated"}}\n```';
    const { cleanText, uiUpdates } = extractUIUpdates(text);
    expect(uiUpdates).toHaveLength(1);
    expect(uiUpdates[0].cardId).toBe("card-abc");
    expect(uiUpdates[0].props).toEqual({ title: "Updated" });
    expect(uiUpdates[0].merge).toBe(true); // default
    expect(cleanText).toBe("");
  });

  it("respects merge: false", () => {
    const text = '```jarble_ui_update\n{"card_id":"x","props":{"html":"<div>"},"merge":false}\n```';
    const { uiUpdates } = extractUIUpdates(text);
    expect(uiUpdates[0].merge).toBe(false);
  });

  it("captures optional component field for type changes", () => {
    const text = '```jarble_ui_update\n{"card_id":"x","props":{},"component":"sandbox"}\n```';
    const { uiUpdates } = extractUIUpdates(text);
    expect(uiUpdates[0].component).toBe("sandbox");
  });

  it("leaves invalid update blocks as text", () => {
    const text = '```jarble_ui_update\n{"props":{"title":"no card_id"}}\n```';
    const { uiUpdates } = extractUIUpdates(text);
    expect(uiUpdates).toHaveLength(0);
  });
});

// ── extractComponentDefs ─────────────────────────────────────────────────────

describe("extractComponentDefs", () => {
  it("extracts a valid component definition", () => {
    const text = [
      "I'll define a component:",
      "```jarble_ui_define",
      JSON.stringify({
        name: "kpi_row",
        description: "Row of KPI metrics",
        layout: [
          { component: "metric_card", props: { label: "{{label1}}", value: "{{value1}}" } },
          { component: "metric_card", props: { label: "{{label2}}", value: "{{value2}}" } },
        ],
      }),
      "```",
      "Now I'll use it.",
    ].join("\n");
    const { cleanText, componentDefs } = extractComponentDefs(text);

    expect(componentDefs).toHaveLength(1);
    expect(componentDefs[0].name).toBe("kpi_row");
    expect(componentDefs[0].description).toBe("Row of KPI metrics");
    expect(componentDefs[0].layout).toHaveLength(2);
    expect(componentDefs[0].layout[0].component).toBe("metric_card");
    expect(componentDefs[0].layout[0].props.label).toBe("{{label1}}");
    expect(cleanText).toBe("I'll define a component:\n\nNow I'll use it.");
  });

  it("rejects invalid component name format", () => {
    const text = '```jarble_ui_define\n{"name":"KPI-Row","layout":[{"component":"card","props":{}}]}\n```';
    const { componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(0);
  });

  it("rejects name starting with number", () => {
    const text = '```jarble_ui_define\n{"name":"1bad","layout":[{"component":"card","props":{}}]}\n```';
    const { componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(0);
  });

  it("accepts valid names with underscores and numbers", () => {
    const text = '```jarble_ui_define\n{"name":"my_comp_2","layout":[{"component":"card","props":{}}]}\n```';
    const { componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(1);
    expect(componentDefs[0].name).toBe("my_comp_2");
  });

  it("rejects missing layout", () => {
    const text = '```jarble_ui_define\n{"name":"foo"}\n```';
    const { componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(0);
  });

  it("rejects non-array layout", () => {
    const text = '```jarble_ui_define\n{"name":"foo","layout":"not_array"}\n```';
    const { componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(0);
  });

  it("strips description if not a string", () => {
    const text = '```jarble_ui_define\n{"name":"foo","description":42,"layout":[{"component":"card","props":{}}]}\n```';
    const { componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(1);
    expect(componentDefs[0].description).toBeUndefined();
  });

  it("extracts multiple definitions", () => {
    const text = [
      '```jarble_ui_define\n{"name":"comp_a","layout":[{"component":"card","props":{}}]}\n```',
      '```jarble_ui_define\n{"name":"comp_b","layout":[{"component":"list","props":{}}]}\n```',
    ].join("\nsome text\n");
    const { componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(2);
    expect(componentDefs[0].name).toBe("comp_a");
    expect(componentDefs[1].name).toBe("comp_b");
  });

  it("enforces MAX_DEFS (5)", () => {
    const blocks = Array.from({ length: 8 }, (_, i) =>
      `\`\`\`jarble_ui_define\n{"name":"comp_${String.fromCharCode(97 + i)}","layout":[{"component":"card","props":{}}]}\n\`\`\``
    ).join("\n");
    const { componentDefs } = extractComponentDefs(blocks);
    expect(componentDefs).toHaveLength(5);
  });

  it("leaves invalid JSON as visible text", () => {
    const text = "```jarble_ui_define\n{broken json\n```";
    const { cleanText, componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(0);
    expect(cleanText).toContain("{broken json");
  });
});

// ── extractAllUIBlocks (integration) ─────────────────────────────────────────

describe("extractAllUIBlocks", () => {
  it("handles all three block types in one message", () => {
    const text = [
      "Let me define and use a component.",
      "```jarble_ui_define",
      JSON.stringify({
        name: "status_row",
        layout: [
          { component: "metric_card", props: { label: "{{label}}", value: "{{value}}" } },
        ],
      }),
      "```",
      "Now rendering:",
      '```jarble_ui\n{"component":"status_row","props":{"label":"Users","value":"1234"}}\n```',
      "And updating an existing card:",
      '```jarble_ui_update\n{"card_id":"card-xyz","props":{"title":"Refreshed"}}\n```',
    ].join("\n");

    const { cleanText, uiBlocks, uiUpdates, componentDefs } = extractAllUIBlocks(text);

    expect(componentDefs).toHaveLength(1);
    expect(componentDefs[0].name).toBe("status_row");

    expect(uiBlocks).toHaveLength(1);
    expect(uiBlocks[0].component).toBe("status_row");
    expect(uiBlocks[0].props).toEqual({ label: "Users", value: "1234" });

    expect(uiUpdates).toHaveLength(1);
    expect(uiUpdates[0].cardId).toBe("card-xyz");

    expect(cleanText).toBe("Let me define and use a component.\n\nNow rendering:\n\nAnd updating an existing card:");
  });

  it("processes define before render (order matters)", () => {
    // Define block is stripped first, then render block is processed
    const text = [
      '```jarble_ui_define\n{"name":"widget","layout":[{"component":"card","props":{"body":"{{text}}"}}]}\n```',
      '```jarble_ui\n{"component":"widget","props":{"text":"hello"}}\n```',
    ].join("\n");

    const { componentDefs, uiBlocks } = extractAllUIBlocks(text);
    expect(componentDefs).toHaveLength(1);
    expect(uiBlocks).toHaveLength(1);
    expect(uiBlocks[0].component).toBe("widget");
  });

  it("returns empty arrays when no blocks present", () => {
    const text = "Just plain text with no UI blocks.";
    const { cleanText, uiBlocks, uiUpdates, componentDefs } = extractAllUIBlocks(text);
    expect(cleanText).toBe("Just plain text with no UI blocks.");
    expect(uiBlocks).toHaveLength(0);
    expect(uiUpdates).toHaveLength(0);
    expect(componentDefs).toHaveLength(0);
  });

  it("cleans up triple+ newlines from stripped blocks", () => {
    const text = "Before\n\n```jarble_ui\n" +
      '{"component":"card","props":{"title":"x"}}\n' +
      "```\n\n\n\nAfter";
    const { cleanText } = extractAllUIBlocks(text);
    expect(cleanText).not.toMatch(/\n{3,}/);
  });
});
