#!/usr/bin/env node
/**
 * Deploy the new JARBLE_UI_PROMPT to a live pod via kubectl exec.
 * Usage: node scripts/deploy-prompt.js [deploymentId]
 */
const fs = require("fs");
const { execSync } = require("child_process");

const DEPLOYMENT_ID = process.argv[2] || "uv95yd6bfr9q";

// Read openclaw.ts to extract JARBLE_UI_PROMPT
const src = fs.readFileSync("src/runtimes/handlers/openclaw.ts", "utf-8");

// Find the prompt — it starts after `const JARBLE_UI_PROMPT = \`` and ends at `\`;`
const marker = "const JARBLE_UI_PROMPT = `";
const startIdx = src.indexOf(marker);
if (startIdx === -1) {
  console.error("Could not find JARBLE_UI_PROMPT in openclaw.ts");
  process.exit(1);
}
const contentStart = startIdx + marker.length;

// Find the matching closing backtick (not escaped)
let depth = 0;
let endIdx = contentStart;
while (endIdx < src.length) {
  if (src[endIdx] === "\\" && src[endIdx + 1] === "`") {
    endIdx += 2; // skip escaped backtick
    continue;
  }
  if (src[endIdx] === "$" && src[endIdx + 1] === "{") {
    depth++;
    endIdx += 2;
    continue;
  }
  if (depth > 0 && src[endIdx] === "}") {
    depth--;
    endIdx++;
    continue;
  }
  if (src[endIdx] === "`" && depth === 0) {
    break;
  }
  endIdx++;
}

let prompt = src.slice(contentStart, endIdx);

// Unescape: \` -> ` and \\ -> \ (template literal escapes)
prompt = prompt.replace(/\\\\/g, "\\").replace(/\\`/g, "`");

// The prompt contains ${generatePromptReference(...)} — replace with static ref
const refMarker = "${generatePromptReference(COMPONENT_MANIFEST, { top10Only: true })}";
const refContent = `### Component Quick Reference (Top 10)
**chart**: \`{type, data, dataKeys, xAxisKey, title?, showLegend?, showGrid?, stacked?, colors?}\` -- bar/line/pie/area via recharts
**data_table**: \`{columns, rows, title?}\` -- sortable read-only table (rows = 2D arrays)
**metric_card**: \`{label, value, change?, sparkline?}\` -- single KPI with trend
**stat_grid**: \`{stats: [{label, value, change?, icon?}]}\` -- compact multi-metric grid
**card**: \`{title?, subtitle?, body?}\` -- markdown content card
**code_block**: \`{code, language?, title?}\` -- syntax-highlighted code
**alert**: \`{title?, message, variant}\` -- status notification
**sandbox**: \`{html, css?, js?, libraries?}\` -- sandboxed iframe (LAST RESORT)
**map**: \`{center: [lat,lng], zoom?, markers?}\` -- interactive Leaflet map
**embed**: \`{url, title?, height?}\` -- third-party widget iframe

27 more components available. Call \`component_reference\` for full props: timeline, tabs, accordion, form, button_group, progress, badge, header, divider, key_value, image, video, steps, result, and more.

Full details: call \`component_reference\` tool.`;

prompt = prompt.replace(refMarker, refContent);

// Build full soul.md
const soulContent = "# test\nYou are test.\n\n" + prompt;

console.log("Prompt length:", soulContent.length, "chars");
console.log("Has Platform Awareness:", soulContent.includes("Platform Awareness"));
console.log("Has Rendering Protocol:", soulContent.includes("Rendering Protocol"));
console.log("Has REQUIRED layout:", soulContent.includes("REQUIRED on every"));
console.log("Has 35+ tools:", soulContent.includes("35+ MCP tools"));
console.log("Has SEPARATE blocks:", soulContent.includes("SEPARATE"));
console.log("Has CRITICAL error:", soulContent.includes("CRITICAL"));

// Find the pod
const podName = execSync(
  `kubectl get pods -n jarble -l app=dep-${DEPLOYMENT_ID} --no-headers -o custom-columns=:metadata.name`,
  { encoding: "utf-8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }
).trim();
console.log("Pod:", podName);

if (!podName) {
  console.error("No pod found");
  process.exit(1);
}

// Write to a local temp file (avoid Windows temp path issues with kubectl cp)
const tmpFile = require("path").join(__dirname, "soul-deploy-tmp.md");
fs.writeFileSync(tmpFile, soulContent, "utf-8");
console.log("Temp file:", tmpFile, "(" + soulContent.length + " bytes)");

const destPaths = [
  "/data/config/soul.md",
  "/data/.openclaw/.openclaw/workspace/SOUL.md",
];

// Use kubectl exec with tar to pipe the file into the pod (avoids kubectl cp path issues on Windows)
for (const destPath of destPaths) {
  try {
    // Ensure parent dir exists, then pipe file via tar
    const dir = require("path").posix.dirname(destPath);
    execSync(
      `kubectl exec -n jarble ${podName} -c runtime -- mkdir -p "${dir}"`,
      { encoding: "utf-8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }
    );
    // Use base64 chunks via a node child process to avoid command line length limits
    const b64 = fs.readFileSync(tmpFile).toString("base64");
    const chunkSize = 4000;
    // First, clear/create the file
    execSync(
      `kubectl exec -n jarble ${podName} -c runtime -- sh -c "echo -n '' > '${destPath}'"`,
      { encoding: "utf-8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }
    );
    // Write base64 chunks to a temp file on the pod, then decode
    const podTmp = "/tmp/soul-b64-" + Date.now();
    execSync(
      `kubectl exec -n jarble ${podName} -c runtime -- sh -c "echo -n '' > ${podTmp}"`,
      { encoding: "utf-8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }
    );
    for (let i = 0; i < b64.length; i += chunkSize) {
      const chunk = b64.slice(i, i + chunkSize);
      execSync(
        `kubectl exec -n jarble ${podName} -c runtime -- sh -c "echo -n '${chunk}' >> ${podTmp}"`,
        { encoding: "utf-8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }
      );
    }
    // Decode base64 to destination
    execSync(
      `kubectl exec -n jarble ${podName} -c runtime -- sh -c "base64 -d ${podTmp} > '${destPath}' && rm ${podTmp}"`,
      { encoding: "utf-8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }
    );
    console.log("Written:", destPath);
  } catch (e) {
    console.error("Failed to write", destPath, ":", e.message.slice(0, 200));
  }
}

// Clean up temp file
try { fs.unlinkSync(tmpFile); } catch {}

// Verify
try {
  const check = execSync(
    `kubectl exec -n jarble ${podName} -- head -5 /data/config/soul.md`,
    { encoding: "utf-8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }
  );
  console.log("\nVerification (first 5 lines):");
  console.log(check);
} catch (e) {
  console.error("Verification failed:", e.message.slice(0, 200));
}
