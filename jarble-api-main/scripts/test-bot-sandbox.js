#!/usr/bin/env node
/**
 * Direct bot sandbox test — sends prompts via kubectl exec and analyzes responses.
 */
const { execSync } = require("child_process");

const POD = process.argv[2] || "dep-8p2di4uvnnj2-599dfd55b9-h8cqb";
const NAMESPACE = "jarble";

const tests = [
  {
    name: "Three.js rotating cube",
    prompt: "[CANVAS_STATE] cards=[] layout=grid\nCreate a 3D rotating cube with Three.js using a sandbox component. Use the sandbox component with js and libraries props.",
    sessionId: "sandbox-test-threejs",
  },
  {
    name: "D3 bar chart",
    prompt: "[CANVAS_STATE] cards=[] layout=grid\nCreate a simple D3.js bar chart showing 5 data points using the sandbox component. Use moduleJs with import statements from esm.sh.",
    sessionId: "sandbox-test-d3",
  },
  {
    name: "GSAP animation",
    prompt: "[CANVAS_STATE] cards=[] layout=grid\nCreate a GSAP animation of a bouncing ball in a sandbox component. Use the sandbox with js prop.",
    sessionId: "sandbox-test-gsap",
  },
];

function sendMessage(prompt, sessionId) {
  try {
    const cmd = `kubectl exec -n ${NAMESPACE} ${POD} -c runtime -- npx openclaw agent --message "${prompt.replace(/"/g, '\\"').replace(/\n/g, "\\n")}" --session-id "${sessionId}" --json --timeout 60`;
    const output = execSync(cmd, { timeout: 90000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    // Find JSON start
    const jsonStart = output.indexOf("{");
    if (jsonStart < 0) return { error: "No JSON in output" };
    return JSON.parse(output.slice(jsonStart));
  } catch (e) {
    return { error: e.message.substring(0, 200) };
  }
}

function analyzeResponse(parsed) {
  if (parsed.error) return { error: parsed.error };

  const text = parsed.result?.payloads?.[0]?.text || "";
  const duration = parsed.result?.meta?.durationMs;
  const model = parsed.result?.meta?.agentMeta?.model;

  // Extract jarble_ui blocks
  const blocks = [];
  const re = /```jarble_ui\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    try { blocks.push(JSON.parse(m[1].trim())); } catch {}
  }

  const analysis = {
    duration: duration + "ms",
    model,
    componentCount: blocks.length,
    components: [],
  };

  for (const b of blocks) {
    const comp = {
      type: b.component,
      layoutHint: b.layout_hint,
      hasLibraries: !!(b.props && b.props.libraries && b.props.libraries.length > 0),
      hasModuleJs: !!(b.props && b.props.moduleJs),
      hasImportMap: !!(b.props && b.props.importMap),
      hasJs: !!(b.props && b.props.js),
    };

    if (comp.hasLibraries) comp.libraries = b.props.libraries;
    if (comp.hasImportMap) comp.importMap = b.props.importMap;

    // Detect bare globals that would need autofix
    if (comp.hasJs && b.props.js) {
      const globals = ["THREE", "d3", "Chart", "gsap", "p5", "Tone"].filter(
        g => new RegExp("\\b" + g + "\\b").test(b.props.js)
      );
      if (globals.length > 0) {
        comp.bareGlobals = globals;
        if (!comp.hasLibraries && !comp.hasModuleJs) {
          comp.autofixWouldTrigger = true;
        }
      }
    }

    analysis.components.push(comp);
  }

  return analysis;
}

async function main() {
  console.log("=== Bot Sandbox Tests ===");
  console.log("Pod:", POD);
  console.log("");

  for (const test of tests) {
    console.log(`--- ${test.name} ---`);
    console.log("Sending prompt...");

    const parsed = sendMessage(test.prompt, test.sessionId);
    const result = analyzeResponse(parsed);

    if (result.error) {
      console.log("ERROR:", result.error);
    } else {
      console.log("Duration:", result.duration);
      console.log("Model:", result.model);
      console.log("Components:", result.componentCount);

      for (const c of result.components) {
        console.log(`  Component: ${c.type} (${c.layoutHint})`);
        console.log(`    libraries: ${c.hasLibraries ? JSON.stringify(c.libraries) : "none"}`);
        console.log(`    moduleJs: ${c.hasModuleJs ? "yes" : "none"}`);
        console.log(`    importMap: ${c.hasImportMap ? JSON.stringify(c.importMap) : "none"}`);
        console.log(`    js: ${c.hasJs ? "yes" : "none"}`);
        if (c.bareGlobals) {
          console.log(`    bare globals: ${c.bareGlobals.join(", ")}`);
          if (c.autofixWouldTrigger) {
            console.log("    >> AUTOFIX WOULD TRIGGER: sandbox-detect-bare-globals");
          } else {
            console.log("    >> OK: globals covered by libraries/moduleJs");
          }
        }
      }
    }
    console.log("");
  }
}

main();
