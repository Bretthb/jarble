import { describe, it, expect } from "vitest";
import { buildDocument, DEFAULT_SANDBOX_IMPORTS } from "../sandboxCore";

describe("sandboxCore - default import map", () => {
  it("exports DEFAULT_SANDBOX_IMPORTS with expected libraries", () => {
    expect(DEFAULT_SANDBOX_IMPORTS).toBeDefined();
    expect(DEFAULT_SANDBOX_IMPORTS["three"]).toContain("esm.sh");
    expect(DEFAULT_SANDBOX_IMPORTS["d3"]).toContain("esm.sh");
    expect(DEFAULT_SANDBOX_IMPORTS["chart.js"]).toContain("esm.sh");
    expect(DEFAULT_SANDBOX_IMPORTS["leaflet"]).toContain("esm.sh");
    expect(DEFAULT_SANDBOX_IMPORTS["react"]).toContain("esm.sh");
    expect(DEFAULT_SANDBOX_IMPORTS["react-dom"]).toContain("esm.sh");
    expect(DEFAULT_SANDBOX_IMPORTS["gsap"]).toContain("esm.sh");
    expect(DEFAULT_SANDBOX_IMPORTS["p5"]).toContain("esm.sh");
    expect(DEFAULT_SANDBOX_IMPORTS["tone"]).toContain("esm.sh");
  });

  it("includes default import map in document even without user importMap", () => {
    const doc = buildDocument("<div>test</div>", undefined, undefined, undefined, { logPrefix: "[Test]" });
    expect(doc).toContain('<script type="importmap">');
    expect(doc).toContain('"three"');
    expect(doc).toContain("esm.sh/three");
  });

  it("includes default import map when moduleJs is provided", () => {
    const doc = buildDocument(
      "<canvas></canvas>",
      undefined,
      undefined,
      undefined,
      { logPrefix: "[Test]" },
      "import * as THREE from 'three';",
    );
    expect(doc).toContain('<script type="importmap">');
    expect(doc).toContain('"three"');
    expect(doc).toContain('<script type="module">');
  });

  it("user importMap overrides default entries", () => {
    const userMap = { "three": "https://esm.sh/three@0.160.0" };
    const doc = buildDocument(
      "<canvas></canvas>",
      undefined,
      undefined,
      undefined,
      { logPrefix: "[Test]" },
      "import * as THREE from 'three';",
      userMap,
    );
    expect(doc).toContain("esm.sh/three@0.160.0");
    // The "three" key should map to the user's version, not the default
    // Note: OrbitControls default still references @0.169.0 (separate key), which is correct
    const importMapMatch = doc.match(/"three":\s*"([^"]+)"/);
    expect(importMapMatch).toBeTruthy();
    expect(importMapMatch![1]).toContain("three@0.160.0");
  });

  it("user importMap adds new entries alongside defaults", () => {
    const userMap = { "lodash": "https://esm.sh/lodash@4.17.21" };
    const doc = buildDocument(
      "<div></div>",
      undefined,
      undefined,
      undefined,
      { logPrefix: "[Test]" },
      "import _ from 'lodash';",
      userMap,
    );
    expect(doc).toContain('"lodash"');
    expect(doc).toContain("esm.sh/lodash");
    // Defaults should still be present
    expect(doc).toContain('"three"');
  });

  it("rejects untrusted CDN URLs in import map", () => {
    const userMap = { "evil": "https://evil.com/malware.js" };
    const doc = buildDocument(
      "<div></div>",
      undefined,
      undefined,
      undefined,
      { logPrefix: "[Test]" },
      undefined,
      userMap,
    );
    // Evil URL should be excluded
    expect(doc).not.toContain("evil.com");
    // Defaults should still be present
    expect(doc).toContain('"three"');
  });

  it("all default import URLs pass trusted CDN validation", () => {
    // Every default URL should appear in the output (not be filtered)
    const doc = buildDocument("<div></div>", undefined, undefined, undefined, { logPrefix: "[Test]" });
    for (const [key, url] of Object.entries(DEFAULT_SANDBOX_IMPORTS)) {
      expect(doc).toContain(url);
    }
  });
});
