#!/usr/bin/env node
/**
 * QA test runner for Bot Teams feature (agent teams).
 * Tests against live dev API at api.jarble.ai using a Bearer token.
 *
 * Usage: node scripts/qa-teams.mjs [phase]
 *   phase: scout | crud | chat | persistence | cleanup | all (default: all)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BASE = "https://api.jarble.ai";
const OUT = join(tmpdir(), "qa-teams");
mkdirSync(OUT, { recursive: true });

// Token from env var first, then tmp file fallback
const TOKEN_FILE = join(tmpdir(), "jarble_qa_token.txt");
const TOKEN = (process.env.JARBLE_QA_TOKEN || (existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, "utf8") : "")).trim();
if (!TOKEN) {
  console.error("No token — set JARBLE_QA_TOKEN env var or write token to " + TOKEN_FILE);
  process.exit(2);
}
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const results = [];
let flowIdCreated = null;

function log(name, status, detail, data) {
  const rec = { name, status, detail, timestamp: new Date().toISOString() };
  if (data !== undefined) rec.data = data;
  results.push(rec);
  const icon = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : status === "WARN" ? "!" : "•";
  console.log(`${icon} [${status}] ${name}${detail ? " — " + detail : ""}`);
}

function save(file, obj) {
  writeFileSync(join(OUT, file), JSON.stringify(obj, null, 2));
}

async function trpcQ(path, input = {}) {
  const enc = encodeURIComponent(JSON.stringify({ json: input }));
  const r = await fetch(`${BASE}/trpc/${path}?input=${enc}`, { headers: H });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: r.status, body };
}

async function trpcM(path, input = {}) {
  const r = await fetch(`${BASE}/trpc/${path}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ json: input }),
  });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: r.status, body };
}

function unwrap(body) {
  return body?.result?.data?.json;
}
function errMsg(body) {
  return body?.error?.json?.message || body?.error?.message || JSON.stringify(body).slice(0, 300);
}

// ────────────────────────────── PHASE: SCOUT ──────────────────────────────
async function phaseScout() {
  console.log("\n════ PHASE 1: SCOUT — auth + discover test fixtures ════\n");

  // Test 1: Auth enforcement — no token should 401
  const r1 = await fetch(`${BASE}/trpc/flows.list?input=%7B%22json%22%3A%7B%7D%7D`);
  if (r1.status === 401) log("auth/401-without-token", "PASS", "correctly rejects missing token");
  else log("auth/401-without-token", "FAIL", `expected 401, got ${r1.status}`);

  // Test 2: Valid token should work
  const r2 = await trpcQ("flows.list", {});
  if (r2.status === 200) {
    const flows = unwrap(r2.body);
    log("auth/200-with-token", "PASS", `${flows?.length ?? 0} flows returned`);
    save("scout-flows-list.json", r2.body);
  } else {
    log("auth/200-with-token", "FAIL", `status ${r2.status}: ${errMsg(r2.body)}`);
  }

  // Test 3: List deployments — find a running one for chat testing
  const r3 = await trpcQ("deployment.list", {});
  save("scout-deployments.json", r3.body);
  if (r3.status !== 200) {
    log("scout/list-deployments", "FAIL", `status ${r3.status}: ${errMsg(r3.body)}`);
    return { runningDeployments: [] };
  }
  const deps = unwrap(r3.body) || [];
  const running = deps.filter((d) => d.status === "running");
  log("scout/list-deployments", "PASS", `${deps.length} total, ${running.length} running`);

  console.log("   Running deployments:");
  running.slice(0, 5).forEach((d) => console.log(`     ${d.id}  ${d.name}`));
  if (deps.length > 0 && running.length === 0) {
    console.log("   Statuses seen:", [...new Set(deps.map((d) => d.status))].join(", "));
    deps.slice(0, 5).forEach((d) => console.log(`     ${d.status.padEnd(10)} ${d.id}  ${d.name}`));
  }

  return { runningDeployments: running, allDeployments: deps };
}

// ────────────────────────────── PHASE: CRUD ──────────────────────────────
async function phaseCrud(ctx) {
  console.log("\n════ PHASE 2: CRUD — flow creation + validation ════\n");

  // Test: create with invalid input (no nodes)
  const r1 = await trpcM("flows.create", {
    name: "qa-invalid",
    definition: { nodes: [], edges: [] },
    teamType: "hierarchy",
  });
  if (r1.status === 200) {
    // Empty nodes might be allowed by schema — document it
    log("crud/create-empty-nodes", "WARN", "schema allows empty nodes array", unwrap(r1.body));
    if (unwrap(r1.body)?.id) {
      // clean up
      await trpcM("flows.delete", { id: unwrap(r1.body).id, hard: true });
    }
  } else {
    log("crud/create-empty-nodes", "PASS", `rejected (status ${r1.status})`);
  }

  // Test: create with HTML in name (should be rejected by noHtmlTags refine)
  const r2 = await trpcM("flows.create", {
    name: "<script>alert(1)</script>",
    definition: { nodes: [{ id: "n1", type: "output", label: "out", position: { x: 0, y: 0 } }], edges: [] },
    teamType: "hierarchy",
  });
  if (r2.status !== 200) {
    log("crud/xss-in-name-rejected", "PASS", "HTML tag refuse fired");
  } else {
    log("crud/xss-in-name-rejected", "FAIL", "HTML tag in flow name was accepted!");
    if (unwrap(r2.body)?.id) await trpcM("flows.delete", { id: unwrap(r2.body).id, hard: true });
  }

  // Test: create a minimal valid flow — pick a deployment if available
  const entryDep = ctx.runningDeployments?.[0] || ctx.allDeployments?.[0];
  const flowDef = {
    nodes: [
      {
        id: "entry",
        type: "deployment",
        label: "Entry Bot",
        role: "Coordinator",
        isEntryPoint: true,
        deploymentId: entryDep?.id || "placeholder-no-deployment",
        position: { x: 0, y: 0 },
      },
      {
        id: "specialist-1",
        type: "deployment",
        label: "Specialist A",
        role: "Researcher",
        deploymentId: ctx.runningDeployments?.[1]?.id || ctx.allDeployments?.[1]?.id || "placeholder",
        position: { x: 250, y: 0 },
      },
      {
        id: "out",
        type: "output",
        label: "Final Output",
        position: { x: 500, y: 0 },
      },
    ],
    edges: [
      { id: "e1", source: "entry", target: "specialist-1", type: "delegates" },
      { id: "e2", source: "specialist-1", target: "out" },
    ],
  };

  const r3 = await trpcM("flows.create", {
    name: `QA Test Team ${Date.now()}`,
    description: "Automated QA test flow — safe to delete",
    definition: flowDef,
    teamType: "hierarchy",
    entryNodeId: "entry",
  });
  if (r3.status === 200) {
    flowIdCreated = unwrap(r3.body)?.id;
    log("crud/create-valid", "PASS", `flowId=${flowIdCreated}`);
  } else {
    log("crud/create-valid", "FAIL", `status ${r3.status}: ${errMsg(r3.body)}`);
    return;
  }

  // Test: create each teamType variant
  for (const tt of ["hierarchy", "pipeline", "collaborative"]) {
    const r = await trpcM("flows.create", {
      name: `QA ${tt} ${Date.now()}`,
      definition: flowDef,
      teamType: tt,
    });
    if (r.status === 200) {
      log(`crud/teamType-${tt}`, "PASS");
      const id = unwrap(r.body)?.id;
      if (id) await trpcM("flows.delete", { id, hard: true });
    } else {
      log(`crud/teamType-${tt}`, "FAIL", errMsg(r.body));
    }
  }

  // Test: getById
  const r4 = await trpcQ("flows.getById", { id: flowIdCreated });
  if (r4.status === 200) {
    const flow = unwrap(r4.body);
    const parsed = typeof flow.definition === "string" ? JSON.parse(flow.definition) : flow.definition;
    log("crud/getById", "PASS", `name="${flow.name}", nodes=${parsed.nodes?.length}, teamType=${flow.teamType}`);
    save("crud-getById.json", flow);
  } else {
    log("crud/getById", "FAIL", errMsg(r4.body));
  }

  // Test: cross-user access (we can't easily test this without another user — skip)
  log("crud/cross-user-access", "SKIP", "would need second auth token");

  // Test: getById non-existent
  const r5 = await trpcQ("flows.getById", { id: "flw_nonexistent_xyz" });
  if (r5.status === 404 || r5.body?.error) {
    log("crud/getById-404", "PASS", "NOT_FOUND returned");
  } else {
    log("crud/getById-404", "FAIL", "non-existent flow returned without error");
  }

  // Test: update
  const r6 = await trpcM("flows.update", {
    id: flowIdCreated,
    description: "Updated by QA",
  });
  if (r6.status === 200) log("crud/update-description", "PASS");
  else log("crud/update-description", "FAIL", errMsg(r6.body));

  // Test: duplicate
  const r7 = await trpcM("flows.duplicate", { sourceFlowId: flowIdCreated });
  if (r7.status === 200) {
    const dupId = unwrap(r7.body)?.id;
    log("crud/duplicate", "PASS", `duplicated as ${dupId}`);
    if (dupId) await trpcM("flows.delete", { id: dupId, hard: true });
  } else {
    log("crud/duplicate", "FAIL", errMsg(r7.body));
  }

  // Test: listExecutions (empty)
  const r8 = await trpcQ("flows.listExecutions", { flowId: flowIdCreated });
  if (r8.status === 200) {
    const rows = unwrap(r8.body);
    log("crud/listExecutions", "PASS", `${Array.isArray(rows) ? rows.length : "?"} executions`);
  } else {
    log("crud/listExecutions", "FAIL", errMsg(r8.body));
  }
}

// ────────────────────────────── PHASE: CHAT ──────────────────────────────
async function phaseChat(ctx) {
  console.log("\n════ PHASE 3: TEAM CHAT — delegation + synthesis SSE ════\n");

  if (!flowIdCreated) {
    log("chat/preconditions", "FAIL", "no flow created in phase 2");
    return;
  }

  // Test: chat with no message (400)
  const r1 = await fetch(`${BASE}/api/flows/${flowIdCreated}/chat`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({}),
  });
  if (r1.status === 400) log("chat/empty-message-400", "PASS");
  else log("chat/empty-message-400", "FAIL", `expected 400, got ${r1.status}`);

  // Test: chat with oversized message
  const big = "a".repeat(11000);
  const r2 = await fetch(`${BASE}/api/flows/${flowIdCreated}/chat`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ message: big }),
  });
  if (r2.status === 400) log("chat/oversized-message-400", "PASS");
  else log("chat/oversized-message-400", "FAIL", `expected 400, got ${r2.status}`);

  // Test: chat with no token
  const r3 = await fetch(`${BASE}/api/flows/${flowIdCreated}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hi" }),
  });
  if (r3.status === 401) log("chat/no-token-401", "PASS");
  else log("chat/no-token-401", "FAIL", `expected 401, got ${r3.status}`);

  // Test: chat against non-existent flow
  const r4 = await fetch(`${BASE}/api/flows/flw_nonexistent/chat`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ message: "hi" }),
  });
  if (r4.status === 404) log("chat/nonexistent-flow-404", "PASS");
  else log("chat/nonexistent-flow-404", "FAIL", `expected 404, got ${r4.status}`);

  // Now the real thing: stream chat against the actual flow
  // This requires the entry deployment to be running. If it isn't, we expect a 400.
  console.log("\n   Attempting live SSE chat stream...");
  const r5 = await fetch(`${BASE}/api/flows/${flowIdCreated}/chat`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ message: "Hello team, give me a one-sentence status check." }),
  });

  if (r5.status !== 200) {
    const txt = await r5.text();
    log("chat/live-sse-stream", "WARN", `status ${r5.status}: ${txt.slice(0, 200)}`);
    console.log("   (Expected if no running deployment assigned to entry node)");
    return;
  }

  // Consume SSE stream with a 90s timeout
  log("chat/live-sse-stream", "PASS", "stream opened, consuming events...");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);

  const reader = r5.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events = [];
  const eventTypes = new Set();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n\n");
      buf = lines.pop() || "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith(":")) continue;
        const data = line.startsWith("data:") ? line.slice(5).trim() : line;
        try {
          const ev = JSON.parse(data);
          events.push(ev);
          if (ev.type) eventTypes.add(ev.type);
          if (ev.type === "RUN_FINISHED" || ev.type === "jarble.run.finished") {
            reader.cancel();
            break;
          }
        } catch {}
      }
    }
  } catch (e) {
    log("chat/stream-consumption", "WARN", `stream error: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  save("chat-sse-events.json", events);
  log("chat/event-count", "INFO", `${events.length} events, types: ${[...eventTypes].join(", ")}`);

  // Check for delegation events specifically
  const delegationEvents = events.filter((e) => String(e.type).includes("delegation"));
  if (delegationEvents.length > 0) {
    log("chat/delegation-events", "PASS", `${delegationEvents.length} delegation events observed`);
  } else {
    log("chat/delegation-events", "WARN", "no delegation events — entry bot may not have delegated");
  }

  // Check for text message content
  const textEvents = events.filter((e) => String(e.type).includes("TEXT_MESSAGE"));
  if (textEvents.length > 0) log("chat/text-messages-streamed", "PASS", `${textEvents.length} TEXT_MESSAGE events`);
  else log("chat/text-messages-streamed", "WARN", "no TEXT_MESSAGE events");
}

// ───────────────────────────── PHASE: CLEANUP ─────────────────────────────
async function phaseCleanup() {
  console.log("\n════ PHASE 4: CLEANUP ════\n");
  if (flowIdCreated) {
    const r = await trpcM("flows.delete", { id: flowIdCreated, hard: true });
    if (r.status === 200) log("cleanup/hard-delete", "PASS", `deleted ${flowIdCreated}`);
    else log("cleanup/hard-delete", "FAIL", errMsg(r.body));
  }
}

// ────────────────────────────────── RUN ──────────────────────────────────
(async () => {
  const phase = process.argv[2] || "all";
  const t0 = Date.now();
  try {
    const ctx = phase === "all" || phase === "scout" ? await phaseScout() : {};
    if (phase === "all" || phase === "crud") await phaseCrud(ctx);
    if (phase === "all" || phase === "chat") await phaseChat(ctx);
    if (phase === "all" || phase === "cleanup") await phaseCleanup();
  } catch (e) {
    console.error("FATAL:", e);
    log("fatal", "FAIL", e.message);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const counts = results.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  console.log(`\n════ SUMMARY (${elapsed}s) ════`);
  console.log(`  PASS: ${counts.PASS || 0}   FAIL: ${counts.FAIL || 0}   WARN: ${counts.WARN || 0}   SKIP: ${counts.SKIP || 0}   INFO: ${counts.INFO || 0}`);
  save("results.json", { elapsed, counts, results });
  console.log(`  Results saved to ${OUT}/results.json`);
  if ((counts.FAIL || 0) > 0) process.exit(1);
})();
