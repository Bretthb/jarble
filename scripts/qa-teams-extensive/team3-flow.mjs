#!/usr/bin/env node
/**
 * Team 3 — Flow Orchestration & Delegation Tests
 *
 * Tests flow creation with running deployments, team chat (greeting,
 * explicit delegation, delegation events, multi-turn, canvas), REST
 * execution, fetch-by-id, and cleanup.
 */
import {
  trpcQ,
  trpcM,
  unwrap,
  errMsg,
  chatWithFlow,
  TestRunner,
  discoverDeployments,
  API_BASE,
  authHeaders,
  sleep,
} from "./lib.mjs";

export async function runTeam3(token) {
  const runner = new TestRunner("team3-flow");
  console.log("\n=== Team 3: Flow Orchestration & Delegation ===\n");

  // Rate-limited mutation wrapper
  async function trpcMR(path, input) {
    await sleep(300);
    return trpcM(path, input, token);
  }

  // Track resources for cleanup
  const createdFlowIds = [];

  // ── Discover running deployments ─────────────────────────────────────
  let deployments;
  try {
    const disc = await discoverDeployments(token);
    deployments = disc.running;
  } catch (e) {
    runner.fail("discover-deployments", `Error: ${e.message}`);
    return runner.summary();
  }

  if (!deployments || deployments.length === 0) {
    runner.skip("flow-create-with-running-bots", "No running deployments found");
    runner.skip("team-chat-greeting", "No running deployments");
    runner.skip("team-chat-explicit-delegation", "No running deployments");
    runner.skip("team-chat-delegation-events", "No running deployments");
    runner.skip("team-chat-multi-turn", "No running deployments");
    runner.skip("team-chat-canvas", "No running deployments");
    runner.skip("flow-execution-rest", "No running deployments");
    runner.skip("flow-get-by-id", "No running deployments");
    runner.skip("cleanup", "Nothing to clean up");
    return runner.summary();
  }

  // Use two deployments (or the same one twice)
  const dep1 = deployments[0];
  const dep2 = deployments.length > 1 ? deployments[1] : deployments[0];
  console.log(`  Using deployments: ${dep1.name} (${dep1.id}), ${dep2.name} (${dep2.id})`);

  // ── Test 1: flow-create-with-running-bots ────────────────────────────
  let flowId = null;
  try {
    const coordinatorNodeId = "coord-" + Date.now();
    const specialistNodeId = "spec-" + Date.now();
    const edgeId = "edge-" + Date.now();

    const definition = {
      nodes: [
        {
          id: coordinatorNodeId,
          type: "deployment",
          label: "Coordinator",
          role: "Team coordinator that delegates tasks",
          goal: "Route incoming requests to the right specialist",
          isEntryPoint: true,
          canDelegate: true,
          deploymentId: dep1.id,
          position: { x: 100, y: 100 },
          config: {},
        },
        {
          id: specialistNodeId,
          type: "deployment",
          label: "Specialist",
          role: "Subject matter expert that handles delegated tasks",
          goal: "Answer questions with detailed knowledge",
          isEntryPoint: false,
          canDelegate: false,
          deploymentId: dep2.id,
          position: { x: 400, y: 100 },
          config: {},
        },
      ],
      edges: [
        {
          id: edgeId,
          source: coordinatorNodeId,
          target: specialistNodeId,
          type: "delegates",
          label: "delegates",
        },
      ],
    };

    const res = await trpcMR(
      "flows.create",
      {
        name: "QA Flow Team3 " + Date.now(),
        description: "QA test flow for team delegation tests",
        definition,
        status: "draft",
        teamType: "hierarchy",
      },
      token
    );

    const data = unwrap(res.body);
    if (res.status === 200 && data && data.id) {
      flowId = data.id;
      createdFlowIds.push(flowId);
      runner.pass("flow-create-with-running-bots", `Created flow ${flowId}`);
    } else {
      runner.fail("flow-create-with-running-bots", `Status ${res.status}: ${errMsg(res.body)}`);
    }
  } catch (e) {
    runner.fail("flow-create-with-running-bots", `Exception: ${e.message}`);
  }

  if (!flowId) {
    runner.skip("team-chat-greeting", "No flow created");
    runner.skip("team-chat-explicit-delegation", "No flow created");
    runner.skip("team-chat-delegation-events", "No flow created");
    runner.skip("team-chat-multi-turn", "No flow created");
    runner.skip("team-chat-canvas", "No flow created");
    runner.skip("flow-execution-rest", "No flow created");
    runner.skip("flow-get-by-id", "No flow created");
    await cleanup(runner, createdFlowIds, token);
    return runner.summary();
  }

  // Shared conversationId for multi-turn tests
  const convId = `qa-team3-${Date.now()}`;

  // ── Test 2: team-chat-greeting ───────────────────────────────────────
  try {
    const result = await chatWithFlow(
      flowId,
      "hey team, help me figure something out",
      token,
      { conversationId: convId, timeout: 90_000 }
    );

    if (result.error) {
      runner.fail("team-chat-greeting", `Error: ${result.fullText}`);
    } else if (result.fullText && result.fullText.length > 0) {
      runner.pass(
        "team-chat-greeting",
        `Got ${result.fullText.length} chars in ${result.durationMs}ms`
      );
    } else {
      runner.fail("team-chat-greeting", "Empty response from flow chat");
    }
  } catch (e) {
    runner.fail("team-chat-greeting", `Exception: ${e.message}`);
  }

  // ── Test 3: team-chat-explicit-delegation ────────────────────────────
  try {
    const result = await chatWithFlow(
      flowId,
      "pass this to the specialist: what are the primary colors?",
      token,
      { conversationId: convId, timeout: 90_000 }
    );

    if (result.error) {
      runner.fail("team-chat-explicit-delegation", `Error: ${result.fullText}`);
    } else {
      // Look for delegation signals: specialist mention, or color-related answer
      const text = result.fullText.toLowerCase();
      const hasDelegation =
        text.includes("specialist") ||
        text.includes("delegat") ||
        text.includes("red") ||
        text.includes("blue") ||
        text.includes("yellow") ||
        text.includes("primary") ||
        text.includes("color");
      const hasContent = result.fullText.length > 10;

      if (hasDelegation && hasContent) {
        runner.pass(
          "team-chat-explicit-delegation",
          `Delegation detected, ${result.fullText.length} chars`
        );
      } else if (hasContent) {
        runner.warn(
          "team-chat-explicit-delegation",
          `Got response but no clear delegation signal: "${result.fullText.slice(0, 150)}..."`
        );
      } else {
        runner.fail("team-chat-explicit-delegation", "Empty or trivial response");
      }
    }
  } catch (e) {
    runner.fail("team-chat-explicit-delegation", `Exception: ${e.message}`);
  }

  // ── Test 4: team-chat-delegation-events ──────────────────────────────
  try {
    const delegationConv = `qa-deleg-${Date.now()}`;
    const result = await chatWithFlow(
      flowId,
      "ask the specialist to explain photosynthesis briefly",
      token,
      { conversationId: delegationConv, timeout: 90_000 }
    );

    if (result.error) {
      runner.fail("team-chat-delegation-events", `Error: ${result.fullText}`);
    } else {
      // Look for delegation-related SSE events — delegation events use AG-UI CUSTOM
      // type with the semantic name in e.name (e.g. "jarble.flow.delegation.start")
      const delegationEvents = result.events.filter((e) => {
        const t = e.type || e.event || "";
        const n = e.name || "";
        return (
          n.includes("delegation") ||
          n.includes("flow") ||
          t.includes("delegation") ||
          t.includes("substep") ||
          t.includes("step") ||
          t.includes("DELEGATION")
        );
      });

      if (delegationEvents.length > 0) {
        const uniqueNames = [...new Set(delegationEvents.map((e) => e.name || e.type))];
        runner.pass(
          "team-chat-delegation-events",
          `Found ${delegationEvents.length} delegation/flow events: ${uniqueNames.join(", ")}`
        );
      } else if (result.events.length > 0) {
        const uniqueTypes = [...new Set(result.events.map((e) => e.type || e.event || "").filter(Boolean))];
        runner.warn(
          "team-chat-delegation-events",
          `Got ${result.events.length} events but no delegation-specific types. Types: ${uniqueTypes.join(", ")}`
        );
      } else {
        runner.fail("team-chat-delegation-events", "No SSE events captured");
      }
    }
  } catch (e) {
    runner.fail("team-chat-delegation-events", `Exception: ${e.message}`);
  }

  // ── Test 5: team-chat-multi-turn ─────────────────────────────────────
  try {
    const multiConv = `qa-multi-${Date.now()}`;

    // Turn 1: tell
    const turn1 = await chatWithFlow(
      flowId,
      "tell the specialist to remember the number 42",
      token,
      { conversationId: multiConv, timeout: 90_000 }
    );

    if (turn1.error) {
      runner.fail("team-chat-multi-turn", `Turn 1 error: ${turn1.fullText}`);
    } else {
      // Turn 2: ask
      const turn2 = await chatWithFlow(
        flowId,
        "ask the specialist what number I said",
        token,
        { conversationId: multiConv, timeout: 90_000 }
      );

      if (turn2.error) {
        runner.fail("team-chat-multi-turn", `Turn 2 error: ${turn2.fullText}`);
      } else {
        const text = turn2.fullText.toLowerCase();
        const remembers = text.includes("42");
        const hasContent = turn2.fullText.length > 5;

        if (remembers) {
          runner.pass("team-chat-multi-turn", "Context persisted: found '42' in response");
        } else if (hasContent) {
          runner.warn(
            "team-chat-multi-turn",
            `Got response but 42 not found: "${turn2.fullText.slice(0, 150)}..."`
          );
        } else {
          runner.fail("team-chat-multi-turn", "Empty response on turn 2");
        }
      }
    }
  } catch (e) {
    runner.fail("team-chat-multi-turn", `Exception: ${e.message}`);
  }

  // ── Test 6: team-chat-canvas ─────────────────────────────────────────
  try {
    const canvasConv = `qa-canvas-${Date.now()}`;
    const result = await chatWithFlow(
      flowId,
      "ask the specialist to make a chart of monthly sales for the first 6 months of the year",
      token,
      { conversationId: canvasConv, timeout: 90_000 }
    );

    if (result.error) {
      runner.fail("team-chat-canvas", `Error: ${result.fullText}`);
    } else {
      const text = result.fullText.toLowerCase();
      const mentionsChart =
        text.includes("chart") ||
        text.includes("data") ||
        text.includes("sales") ||
        text.includes("graph") ||
        text.includes("visual");
      const hasContent = result.fullText.length > 10;

      if (mentionsChart && hasContent) {
        runner.pass(
          "team-chat-canvas",
          `Chart-related response, ${result.fullText.length} chars`
        );
      } else if (hasContent) {
        runner.warn(
          "team-chat-canvas",
          `Got response but no chart mention: "${result.fullText.slice(0, 150)}..."`
        );
      } else {
        runner.fail("team-chat-canvas", "Empty response");
      }
    }
  } catch (e) {
    runner.fail("team-chat-canvas", `Exception: ${e.message}`);
  }

  // ── Test 7: flow-execution-rest ──────────────────────────────────────
  try {
    // Fetch the flow to get its definition for execution
    const flowRes = await trpcQ("flows.getById", { id: flowId }, token);
    const flowData = unwrap(flowRes.body);
    let definition;

    if (flowData && flowData.definition) {
      definition =
        typeof flowData.definition === "string"
          ? JSON.parse(flowData.definition)
          : flowData.definition;
    }

    if (!definition) {
      runner.fail("flow-execution-rest", "Could not fetch flow definition");
    } else {
      const execRes = await fetch(`${API_BASE}/api/flows/${flowId}/execute`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ definition }),
      });

      if (execRes.status === 200 || execRes.status === 201) {
        // Try to read the response (could be JSON with executionId or SSE stream)
        const contentType = execRes.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
          const json = await execRes.json();
          if (json.executionId) {
            runner.pass("flow-execution-rest", `Execution started: ${json.executionId}`);
          } else {
            runner.pass("flow-execution-rest", `Got JSON response: ${JSON.stringify(json).slice(0, 200)}`);
          }
        } else {
          // SSE stream started — read a few events then abort
          const reader = execRes.body.getReader();
          const decoder = new TextDecoder();
          let chunk = "";
          try {
            const { value } = await reader.read();
            chunk = decoder.decode(value);
          } catch { /* stream may close */ }
          reader.cancel().catch(() => {});
          runner.pass("flow-execution-rest", `SSE stream started, first chunk: ${chunk.slice(0, 100)}`);
        }
      } else {
        const text = await execRes.text();
        runner.fail("flow-execution-rest", `Status ${execRes.status}: ${text.slice(0, 300)}`);
      }
    }
  } catch (e) {
    runner.fail("flow-execution-rest", `Exception: ${e.message}`);
  }

  // ── Test 8: flow-get-by-id ───────────────────────────────────────────
  try {
    const res = await trpcQ("flows.getById", { id: flowId }, token);
    const data = unwrap(res.body);

    if (res.status === 200 && data) {
      const hasNodes =
        data.definition &&
        (typeof data.definition === "string"
          ? JSON.parse(data.definition)
          : data.definition
        ).nodes?.length >= 2;
      const hasName = data.name && data.name.startsWith("QA Flow");
      const hasTeamType = data.teamType === "hierarchy";

      if (hasNodes && hasName && hasTeamType) {
        runner.pass("flow-get-by-id", `Verified: ${data.name}, ${hasNodes ? "2+ nodes" : "?"}, teamType=${data.teamType}`);
      } else {
        runner.warn("flow-get-by-id", `Partial match: name=${data.name}, nodes=${hasNodes}, teamType=${data.teamType}`);
      }
    } else {
      runner.fail("flow-get-by-id", `Status ${res.status}: ${errMsg(res.body)}`);
    }
  } catch (e) {
    runner.fail("flow-get-by-id", `Exception: ${e.message}`);
  }

  // ── Test 9: cleanup ──────────────────────────────────────────────────
  await cleanup(runner, createdFlowIds, token);

  return runner.summary();
}

async function cleanup(runner, flowIds, token) {
  // Also discover and clean up any leftover QA flows
  try {
    const existing = await trpcQ("flows.list", {}, token);
    const allFlows = unwrap(existing.body) || [];
    const qaFlows = allFlows.filter((f) => f.name && f.name.startsWith("QA"));

    const toDelete = [...new Set([...flowIds, ...qaFlows.map((f) => f.id)])];

    let deleted = 0;
    let failed = 0;
    for (const id of toDelete) {
      try {
        await sleep(300);
        const res = await trpcM("flows.delete", { id, hard: true }, token);
        if (res.status === 200) deleted++;
        else failed++;
      } catch {
        failed++;
      }
    }

    if (failed === 0) {
      runner.pass("cleanup", `Deleted ${deleted} QA flow(s)`);
    } else {
      runner.warn("cleanup", `Deleted ${deleted}, failed ${failed}`);
    }
  } catch (e) {
    runner.fail("cleanup", `Exception: ${e.message}`);
  }
}
