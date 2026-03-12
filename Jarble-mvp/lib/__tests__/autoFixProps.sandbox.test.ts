import { describe, it, expect } from "vitest";
import { autoFixProps } from "../autoFixProps";

describe("autoFixProps — sandbox-detect-bare-globals", () => {
  it("converts THREE.js bare global to module mode", () => {
    const result = autoFixProps("sandbox", {
      html: "<canvas id='c'></canvas>",
      js: "const scene = new THREE.Scene();\nconst renderer = new THREE.WebGLRenderer();",
    });
    expect(result.props.moduleJs).toContain("import * as THREE from 'three';");
    expect(result.props.moduleJs).toContain("new THREE.Scene()");
    expect(result.props.js).toBeUndefined();
    expect(result.repairs).toContainEqual(
      expect.objectContaining({ rule: "sandbox-detect-bare-globals" })
    );
  });

  it("converts d3 bare global to module mode", () => {
    const result = autoFixProps("sandbox", {
      html: "<svg id='chart'></svg>",
      js: "const svg = d3.select('#chart');\nd3.forceSimulation();",
    });
    expect(result.props.moduleJs).toContain("import * as d3 from 'd3';");
    expect(result.props.js).toBeUndefined();
  });

  it("converts Chart bare global to module mode", () => {
    const result = autoFixProps("sandbox", {
      html: "<canvas id='chart'></canvas>",
      js: "new Chart(document.getElementById('chart'), { type: 'bar' });",
    });
    expect(result.props.moduleJs).toContain("import { Chart } from 'chart.js/auto';");
    expect(result.props.js).toBeUndefined();
  });

  it("converts Leaflet L global to module mode", () => {
    const result = autoFixProps("sandbox", {
      html: "<div id='map'></div>",
      js: "const map = L.map('map').setView([51.505, -0.09], 13);",
    });
    expect(result.props.moduleJs).toContain("import L from 'leaflet';");
  });

  it("converts gsap bare global to module mode", () => {
    const result = autoFixProps("sandbox", {
      html: "<div class='box'></div>",
      js: "gsap.to('.box', { x: 100, duration: 1 });",
    });
    expect(result.props.moduleJs).toContain("import gsap from 'gsap';");
  });

  it("converts p5 bare global to module mode", () => {
    const result = autoFixProps("sandbox", {
      html: "<div id='sketch'></div>",
      js: "new p5(function(s) { s.setup = function() { s.createCanvas(400, 400); }; });",
    });
    expect(result.props.moduleJs).toContain("import p5 from 'p5';");
  });

  it("handles multiple bare globals in same code", () => {
    const result = autoFixProps("sandbox", {
      html: "<canvas id='c'></canvas>",
      js: "const scene = new THREE.Scene();\ngsap.to(scene, {});",
    });
    expect(result.props.moduleJs).toContain("import * as THREE from 'three';");
    expect(result.props.moduleJs).toContain("import gsap from 'gsap';");
    expect(result.props.js).toBeUndefined();
  });

  it("does NOT trigger when moduleJs already exists", () => {
    const result = autoFixProps("sandbox", {
      html: "<canvas></canvas>",
      js: "const scene = new THREE.Scene();",
      moduleJs: "import * as THREE from 'three';",
    });
    // Should not have the repair since moduleJs already exists
    expect(result.repairs).not.toContainEqual(
      expect.objectContaining({ rule: "sandbox-detect-bare-globals" })
    );
  });

  it("does NOT trigger when libraries already provided", () => {
    const result = autoFixProps("sandbox", {
      html: "<canvas></canvas>",
      js: "const scene = new THREE.Scene();",
      libraries: ["https://esm.sh/three@0.169.0"],
    });
    expect(result.repairs).not.toContainEqual(
      expect.objectContaining({ rule: "sandbox-detect-bare-globals" })
    );
  });

  it("does NOT trigger for non-sandbox components", () => {
    const result = autoFixProps("card", {
      body: "THREE is a 3D library",
    });
    expect(result.repairs).not.toContainEqual(
      expect.objectContaining({ rule: "sandbox-detect-bare-globals" })
    );
  });

  it("does NOT trigger when no known globals are referenced", () => {
    const result = autoFixProps("sandbox", {
      html: "<div>Hello</div>",
      js: "document.querySelector('div').textContent = 'World';",
    });
    expect(result.repairs).not.toContainEqual(
      expect.objectContaining({ rule: "sandbox-detect-bare-globals" })
    );
  });
});
