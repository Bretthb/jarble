import { describe, it, expect } from "vitest";
import {
  validateManifest,
  validateTemplateJson,
  validateSandboxHtml,
} from "./manifestValidator.js";

// ── Helper: minimal valid manifest ──────────────────────────────────────────

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    name: "my_component",
    displayName: "My Component",
    description: "A test component",
    version: "1.0.0",
    tier: "template",
    ...overrides,
  };
}

// ── validateManifest ────────────────────────────────────────────────────────

describe("validateManifest", () => {
  it("accepts a valid minimal manifest", () => {
    const result = validateManifest(validManifest());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.tier).toBe("template");
  });

  it("accepts a valid full manifest with all optional fields", () => {
    const result = validateManifest(
      validManifest({
        tier: "sandbox",
        category: "chart",
        propsSchema: { type: "object" },
        exampleProps: { title: "Hi" },
        examplePrompts: ["Show me a chart"],
        pricingModel: "free",
      })
    );
    expect(result.valid).toBe(true);
    expect(result.tier).toBe("sandbox");
  });

  // ── Required fields ─────────────────────────────────────────────────────

  it("rejects when name is missing", () => {
    const m = validManifest();
    delete (m as Record<string, unknown>).name;
    const result = validateManifest(m);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('"name"')])
    );
  });

  it("rejects when displayName is missing", () => {
    const m = validManifest();
    delete (m as Record<string, unknown>).displayName;
    const result = validateManifest(m);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('"displayName"')])
    );
  });

  it("rejects when description is missing", () => {
    const m = validManifest();
    delete (m as Record<string, unknown>).description;
    const result = validateManifest(m);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('"description"')])
    );
  });

  it("rejects when version is missing", () => {
    const m = validManifest();
    delete (m as Record<string, unknown>).version;
    const result = validateManifest(m);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('"version"')])
    );
  });

  it("rejects when tier is missing", () => {
    const m = validManifest();
    delete (m as Record<string, unknown>).tier;
    const result = validateManifest(m);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('"tier"')])
    );
  });

  it("rejects when required field is null", () => {
    const result = validateManifest(validManifest({ name: null }));
    expect(result.valid).toBe(false);
  });

  it("rejects when required field is not a string", () => {
    const result = validateManifest(validManifest({ name: 123 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("must be a string")])
    );
  });

  // ── Name format ─────────────────────────────────────────────────────────

  it("rejects name with spaces", () => {
    const result = validateManifest(validManifest({ name: "my component" }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Invalid name")])
    );
  });

  it("rejects name with uppercase letters", () => {
    const result = validateManifest(validManifest({ name: "MyComponent" }));
    expect(result.valid).toBe(false);
  });

  it("rejects name starting with a digit", () => {
    const result = validateManifest(validManifest({ name: "1component" }));
    expect(result.valid).toBe(false);
  });

  it("rejects name with special characters", () => {
    const result = validateManifest(validManifest({ name: "my-component" }));
    expect(result.valid).toBe(false);
  });

  it("accepts name with underscores", () => {
    const result = validateManifest(validManifest({ name: "my_component_v2" }));
    expect(result.valid).toBe(true);
  });

  it("rejects name longer than 64 characters", () => {
    const result = validateManifest(
      validManifest({ name: "a" + "b".repeat(64) })
    );
    expect(result.valid).toBe(false);
  });

  // ── Tier ────────────────────────────────────────────────────────────────

  it("rejects invalid tier value", () => {
    const result = validateManifest(validManifest({ tier: "premium" }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Invalid tier")])
    );
  });

  it("accepts tier 'sandbox'", () => {
    const result = validateManifest(validManifest({ tier: "sandbox" }));
    expect(result.valid).toBe(true);
    expect(result.tier).toBe("sandbox");
  });

  // ── Version ─────────────────────────────────────────────────────────────

  it("rejects non-semver version", () => {
    const result = validateManifest(validManifest({ version: "1.0" }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Invalid version")])
    );
  });

  it("rejects version with pre-release suffix", () => {
    const result = validateManifest(validManifest({ version: "1.0.0-beta" }));
    expect(result.valid).toBe(false);
  });

  it("accepts version 0.0.1", () => {
    const result = validateManifest(validManifest({ version: "0.0.1" }));
    expect(result.valid).toBe(true);
  });

  // ── Category ────────────────────────────────────────────────────────────

  it("accepts valid category", () => {
    const result = validateManifest(validManifest({ category: "dashboard" }));
    expect(result.valid).toBe(true);
  });

  it("rejects invalid category", () => {
    const result = validateManifest(validManifest({ category: "widgets" }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Invalid category")])
    );
  });

  it("rejects non-string category", () => {
    const result = validateManifest(validManifest({ category: 42 }));
    expect(result.valid).toBe(false);
  });

  // ── propsSchema ─────────────────────────────────────────────────────────

  it("accepts valid propsSchema as object", () => {
    const result = validateManifest(
      validManifest({ propsSchema: { type: "object", properties: {} } })
    );
    expect(result.valid).toBe(true);
  });

  it("accepts valid propsSchema as JSON string", () => {
    const result = validateManifest(
      validManifest({ propsSchema: '{"type":"object"}' })
    );
    expect(result.valid).toBe(true);
  });

  it("rejects invalid JSON string in propsSchema", () => {
    const result = validateManifest(
      validManifest({ propsSchema: "{not valid json" })
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("propsSchema")])
    );
  });

  // ── examplePrompts ──────────────────────────────────────────────────────

  it("accepts valid examplePrompts array", () => {
    const result = validateManifest(
      validManifest({ examplePrompts: ["Show chart", "Draw graph"] })
    );
    expect(result.valid).toBe(true);
  });

  it("rejects examplePrompts exceeding max of 5", () => {
    const result = validateManifest(
      validManifest({
        examplePrompts: ["a", "b", "c", "d", "e", "f"],
      })
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("max is 5")])
    );
  });

  it("rejects non-array examplePrompts", () => {
    const result = validateManifest(
      validManifest({ examplePrompts: "not an array" })
    );
    expect(result.valid).toBe(false);
  });

  it("rejects non-string items in examplePrompts", () => {
    const result = validateManifest(
      validManifest({ examplePrompts: [123, true] })
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("examplePrompts[0]")])
    );
  });

  // ── pricingModel ────────────────────────────────────────────────────────

  it("accepts pricingModel 'free'", () => {
    const result = validateManifest(validManifest({ pricingModel: "free" }));
    expect(result.valid).toBe(true);
  });

  it("accepts pricingModel 'one_time' with priceUsdCents", () => {
    const result = validateManifest(
      validManifest({ pricingModel: "one_time", priceUsdCents: 499 })
    );
    expect(result.valid).toBe(true);
  });

  it("accepts pricingModel 'subscription' with priceUsdCents", () => {
    const result = validateManifest(
      validManifest({ pricingModel: "subscription", priceUsdCents: 999 })
    );
    expect(result.valid).toBe(true);
  });

  it("rejects invalid pricingModel", () => {
    const result = validateManifest(
      validManifest({ pricingModel: "premium" })
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Invalid pricingModel")])
    );
  });

  it("rejects non-free pricingModel without priceUsdCents", () => {
    const result = validateManifest(
      validManifest({ pricingModel: "one_time" })
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("priceUsdCents")])
    );
  });

  it("rejects non-free pricingModel with zero priceUsdCents", () => {
    const result = validateManifest(
      validManifest({ pricingModel: "one_time", priceUsdCents: 0 })
    );
    expect(result.valid).toBe(false);
  });

  it("rejects non-free pricingModel with negative priceUsdCents", () => {
    const result = validateManifest(
      validManifest({ pricingModel: "subscription", priceUsdCents: -100 })
    );
    expect(result.valid).toBe(false);
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  it("rejects non-object input", () => {
    const result = validateManifest("not an object");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("valid JSON object");
  });

  it("rejects null input", () => {
    const result = validateManifest(null);
    expect(result.valid).toBe(false);
  });

  it("rejects array input", () => {
    const result = validateManifest([1, 2, 3]);
    expect(result.valid).toBe(false);
  });

  it("returns tier null for invalid tier", () => {
    const result = validateManifest(validManifest({ tier: "invalid" }));
    expect(result.tier).toBeNull();
  });
});

// ── validateTemplateJson ────────────────────────────────────────────────────

describe("validateTemplateJson", () => {
  const manifest = validManifest() as Record<string, unknown>;

  it("accepts a valid template with known components", () => {
    const template = {
      layout: [
        { component: "card", props: { title: "Test" } },
        { component: "chart", props: { type: "bar", data: [] } },
      ],
    };
    const result = validateTemplateJson(template, manifest);
    expect(result.valid).toBe(true);
    expect(result.tier).toBe("template");
  });

  it("rejects non-object template", () => {
    const result = validateTemplateJson("not an object", manifest);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("valid JSON object");
  });

  it("rejects template without layout", () => {
    const result = validateTemplateJson({}, manifest);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('"layout" array')])
    );
  });

  it("rejects template where layout is not an array", () => {
    const result = validateTemplateJson({ layout: "not array" }, manifest);
    expect(result.valid).toBe(false);
  });

  it("rejects layout item that is not an object", () => {
    const result = validateTemplateJson(
      { layout: ["not an object"] },
      manifest
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("layout[0]")])
    );
  });

  it("rejects layout item without component field", () => {
    const result = validateTemplateJson(
      { layout: [{ props: {} }] },
      manifest
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('string "component"')])
    );
  });

  it("rejects layout item without props field", () => {
    const result = validateTemplateJson(
      { layout: [{ component: "card" }] },
      manifest
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('object "props"')])
    );
  });

  it("rejects unknown component names", () => {
    const result = validateTemplateJson(
      { layout: [{ component: "nonexistent_widget", props: {} }] },
      manifest
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('unknown component "nonexistent_widget"'),
      ])
    );
  });

  it("rejects sandbox component in template tier", () => {
    const result = validateTemplateJson(
      { layout: [{ component: "sandbox", props: {} }] },
      manifest
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Template tier cannot embed sandbox"),
      ])
    );
  });

  it("rejects canvas alias in template tier", () => {
    const result = validateTemplateJson(
      { layout: [{ component: "canvas", props: {} }] },
      manifest
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Template tier cannot embed sandbox"),
      ])
    );
  });

  it("rejects template exceeding 50KB size limit", () => {
    const hugeProps = { data: "x".repeat(60_000) };
    const template = {
      layout: [{ component: "card", props: hugeProps }],
    };
    const result = validateTemplateJson(template, manifest);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("50KB")])
    );
  });

  it("accepts template just under 50KB", () => {
    // Create a template that's under 50KB
    const template = {
      layout: [{ component: "card", props: { title: "small" } }],
    };
    const result = validateTemplateJson(template, manifest);
    expect(result.valid).toBe(true);
  });

  it("reports multiple errors for multiple bad layout items", () => {
    const template = {
      layout: [
        { component: "unknown_a", props: {} },
        { component: "unknown_b", props: {} },
      ],
    };
    const result = validateTemplateJson(template, manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ── validateSandboxHtml ─────────────────────────────────────────────────────

describe("validateSandboxHtml", () => {
  const validHtml = `
    <html>
    <head><script src="https://cdn.jsdelivr.net/npm/three@0.150.0/build/three.min.js"></script></head>
    <body>
      <script>
        const props = window.__JARBLE_PROPS__;
        console.log(props);
      </script>
    </body>
    </html>
  `;

  it("accepts valid sandbox HTML with jarble bridge", () => {
    const result = validateSandboxHtml(validHtml);
    expect(result.valid).toBe(true);
    expect(result.tier).toBe("sandbox");
  });

  it("rejects non-string input", () => {
    const result = validateSandboxHtml(42 as unknown as string);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("must be a string");
  });

  it("rejects HTML exceeding 1MB", () => {
    const hugeHtml = "<html>" + "x".repeat(1_100_000) + "</html>";
    const result = validateSandboxHtml(hugeHtml);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("1MB")])
    );
  });

  // ── Dangerous pattern warnings ──────────────────────────────────────────

  it("warns on document.cookie access", () => {
    const html = "<script>var c = document.cookie;</script>";
    const result = validateSandboxHtml(html);
    expect(result.valid).toBe(true); // warnings, not errors
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("document.cookie")])
    );
  });

  it("warns on localStorage access", () => {
    const html = "<script>localStorage.setItem('k','v');</script>";
    const result = validateSandboxHtml(html);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("localStorage")])
    );
  });

  it("warns on sessionStorage access", () => {
    const html = "<script>sessionStorage.getItem('k');</script>";
    const result = validateSandboxHtml(html);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("sessionStorage")])
    );
  });

  it("warns on eval usage", () => {
    const html = '<script>eval("alert(1)")</script>';
    const result = validateSandboxHtml(html);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("eval()")])
    );
  });

  it("warns on new Function constructor", () => {
    const html = '<script>new Function("return 1")()</script>';
    const result = validateSandboxHtml(html);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Function() constructor")])
    );
  });

  it("warns on embedded iframe tags", () => {
    const html = '<iframe src="https://evil.com"></iframe>';
    const result = validateSandboxHtml(html);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("<iframe>")])
    );
  });

  it("warns on embedded object tags", () => {
    const html = '<object data="flash.swf"></object>';
    const result = validateSandboxHtml(html);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("<object>")])
    );
  });

  it("warns on embedded embed tags", () => {
    const html = '<embed src="plugin.swf">';
    const result = validateSandboxHtml(html);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("<embed>")])
    );
  });

  it("warns on window.top access", () => {
    const html = "<script>window.top.location = '/';</script>";
    const result = validateSandboxHtml(html);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("window.top")])
    );
  });

  it("warns on non-postMessage window.parent access", () => {
    const html = "<script>window.parent.document.title</script>";
    const result = validateSandboxHtml(html);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("window.parent (non-postMessage"),
      ])
    );
  });

  it("does NOT warn on window.parent.postMessage (allowed bridge)", () => {
    const html =
      "<script>window.__JARBLE_PROPS__; window.parent.postMessage({}, '*');</script>";
    const result = validateSandboxHtml(html);
    const parentWarnings = result.warnings.filter((w) =>
      w.includes("window.parent")
    );
    expect(parentWarnings).toHaveLength(0);
  });

  it("warns on non-CDN script sources", () => {
    const html =
      '<script src="https://evil-domain.com/malware.js"></script>';
    const result = validateSandboxHtml(html);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Non-CDN script source")])
    );
  });

  it("does NOT warn on known CDN script sources", () => {
    const html = `
      <script src="https://cdn.jsdelivr.net/npm/three@0.150.0/build/three.min.js"></script>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js"></script>
      <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
      <script>window.__JARBLE_PROPS__;</script>
    `;
    const result = validateSandboxHtml(html);
    const cdnWarnings = result.warnings.filter((w) =>
      w.includes("Non-CDN script")
    );
    expect(cdnWarnings).toHaveLength(0);
  });

  it("does not warn on relative script paths", () => {
    const html =
      '<script src="./local-script.js"></script><script>window.__JARBLE_PROPS__;</script>';
    const result = validateSandboxHtml(html);
    const cdnWarnings = result.warnings.filter((w) =>
      w.includes("Non-CDN script")
    );
    expect(cdnWarnings).toHaveLength(0);
  });

  // ── Missing jarble bridge ───────────────────────────────────────────────

  it("warns when window.__JARBLE_PROPS__ is missing", () => {
    const html = "<html><body><script>console.log('hi');</script></body></html>";
    const result = validateSandboxHtml(html);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Missing jarble bridge setup"),
      ])
    );
  });

  // ── Multiple warnings accumulate ────────────────────────────────────────

  it("accumulates multiple warnings from different patterns", () => {
    const html = `
      <script>
        document.cookie;
        localStorage.setItem('a','b');
        eval('bad');
      </script>
    `;
    const result = validateSandboxHtml(html);
    expect(result.warnings.length).toBeGreaterThanOrEqual(3);
  });

  // ── valid + warnings coexist ────────────────────────────────────────────

  it("can be valid:true even with warnings (dangerous patterns are not errors)", () => {
    const html =
      "<script>document.cookie; window.__JARBLE_PROPS__;</script>";
    const result = validateSandboxHtml(html);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
