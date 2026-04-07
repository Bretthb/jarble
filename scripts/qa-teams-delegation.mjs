#!/usr/bin/env node
/**
 * Focused delegation probe — creates a team flow, sends a prompt designed
 * to force delegation, captures full SSE trace.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const OUT = join(tmpdir(), "qa-teams");
mkdirSync(OUT, { recursive: true });

const TOKEN = process.env.JARBLE_QA_TOKEN?.trim();
if (!TOKEN) { console.error("JARBLE_QA_TOKEN required"); process.exit(2); }

const BASE = "https://api.jarble.ai";
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function trpcM(path, input) {
  const r = await fetch(`${BASE}/trpc/${path}`, { method: "POST", headers: H, body: JSON.stringify({ json: input }) });
  return { status: r.status, body: await r.json() };
}
async function trpcQ(path, input) {
  const r = await fetch(`${BASE}/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`, { headers: H });
  return { status: r.status, body: await r.json() };
}

// Use t1 as BOTH entry and specialist (so delegation target also exists + runs)
const r0 = await trpcQ("deployment.list", {});
const deps = r0.body.result.data.json;
const running = deps.find((d) => d.status === "running");
if (!running) { console.error("No running deployment"); process.exit(1); }
console.log(`Using deployment: ${running.id} (${running.name})`);

// Create a flow where the entry bot MUST delegate
const flow = {
  name: `QA Delegation Probe ${Date.now()}`,
  description: "Forces delegation via explicit instructions",
  teamType: "hierarchy",
  entryNodeId: "entry",
  definition: {
    nodes: [
      {
        id: "entry",
        type: "deployment",
        label: "Dispatcher",
        role: "Dispatcher — you MUST delegate every user request to the Specialist. Never answer directly.",
        goal: "Always delegate to the Specialist using the delegate_to_specialist tool.",
        isEntryPoint: true,
        canDelegate: true,
        deploymentId: running.id,
        position: { x: 0, y: 0 },
      },
      {
        id: "specialist",
        type: "deployment",
        label: "Specialist",
        role: "Subject matter expert who answers all delegated questions.",
        deploymentId: running.id,
        position: { x: 250, y: 0 },
      },
    ],
    edges: [
      { id: "e1", source: "entry", target: "specialist", type: "delegates" },
    ],
  },
};

const c = await trpcM("flows.create", flow);
if (c.status !== 200) { console.error("Create failed:", JSON.stringify(c.body)); process.exit(1); }
const flowId = c.body.result.data.json.id;
console.log(`Created flow: ${flowId}`);

const convId = "qa-persist-" + Date.now();
console.log(`Using conversationId: ${convId}`);

async function streamChat(message, tag) {
  console.log(`\n──── ${tag}: "${message.slice(0, 50)}..." ────`);
  const r = await fetch(`${BASE}/api/flows/${flowId}/chat`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ message, conversationId: convId }),
  });
  if (r.status !== 200) { console.error(`HTTP ${r.status}: ${await r.text()}`); return null; }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const events = [];
  const t0 = Date.now();
  const timer = setTimeout(() => reader.cancel(), 120_000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const raw of parts) {
        const line = raw.trim();
        if (!line || line.startsWith(":")) continue;
        const data = line.startsWith("data:") ? line.slice(5).trim() : line;
        try {
          const ev = JSON.parse(data);
          events.push(ev);
          if (ev.type === "RUN_FINISHED" || ev.type === "jarble.run.finished") {
            reader.cancel();
            break;
          }
        } catch {}
      }
    }
  } finally {
    clearTimeout(timer);
  }
  const ms = Date.now() - t0;
  const types = [...new Set(events.map((e) => e.type))];
  console.log(`  ${events.length} events in ${ms}ms`);
  console.log(`  types: ${types.join(", ")}`);
  const textDeltas = events.filter((e) => e.type === "TEXT_MESSAGE_CONTENT").map((e) => e.delta).join("");
  if (textDeltas) console.log(`  text: "${textDeltas.slice(0, 300)}${textDeltas.length > 300 ? "..." : ""}"`);
  const delegEvents = events.filter((e) => String(e.type).includes("delegation"));
  if (delegEvents.length) {
    console.log(`  DELEGATION EVENTS (${delegEvents.length}):`);
    delegEvents.forEach((e) => console.log(`    ${e.type}: ${JSON.stringify(e).slice(0, 200)}`));
  } else {
    console.log(`  ⚠ NO delegation events`);
  }
  const trace = events.find((e) => e.type === "jarble.flow.chat.trace" || String(e.type).includes("trace"));
  if (trace) console.log(`  trace:`, JSON.stringify(trace).slice(0, 400));
  return events;
}

// Test 1: explicit delegation request
const ev1 = await streamChat(
  "Delegate this to the Specialist: What are the three primary colors? Return only their answer.",
  "TEST-1 explicit-delegation-request"
);

// Test 2: simple followup to check persistent session context
const ev2 = await streamChat(
  "Now ask the Specialist to name a fourth color and explain why.",
  "TEST-2 session-continuation"
);

writeFileSync(join(OUT, "delegation-probe-events.json"), JSON.stringify({ flowId, convId, ev1, ev2 }, null, 2));

// Cleanup
const d = await trpcM("flows.delete", { id: flowId, hard: true });
console.log(`\nCleanup: ${d.status === 200 ? "✓ deleted" : "✗ failed"}`);
