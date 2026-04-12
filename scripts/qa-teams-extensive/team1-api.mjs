#!/usr/bin/env node
/**
 * Team 1 — API Foundation Tests
 *
 * Tests: auth, subagent CRUD, flow CRUD, XSS rejection, limits, fork workflow.
 * All resources created during the run are cleaned up at the end.
 */
import {
  trpcQ,
  trpcM,
  unwrap,
  errMsg,
  TestRunner,
  discoverDeployments,
  API_BASE,
  authHeaders,
  sleep,
} from "./lib.mjs";

export async function runTeam1(token) {
  const runner = new TestRunner("team1-api");
  console.log("\n═══ Team 1 — API Foundation ═══\n");

  // Rate-limited mutation wrapper — avoids 429 on rapid writes
  async function trpcMR(path, input) {
    await sleep(300);
    return trpcM(path, input, token);
  }

  // Track resources for cleanup
  const createdSubagentIds = [];
  const createdFlowIds = [];

  // ── Discover running deployments ─────────────────────────────────────────
  let deploymentId = null;
  try {
    const { running } = await discoverDeployments(token);
    if (running.length > 0) {
      deploymentId = running[0].id;
      console.log(`  Using deployment: ${running[0].name || deploymentId}`);
    } else {
      console.log("  No running deployments found — some tests will be skipped.");
    }
  } catch (e) {
    runner.fail("discover-deployments", `Failed: ${e.message}`);
    return runner.summary();
  }

  // ── 1. auth-no-token ─────────────────────────────────────────────────────
  try {
    const r = await fetch(`${API_BASE}/trpc/flows.list?input=${encodeURIComponent(JSON.stringify({ json: {} }))}`, {
      headers: { "Content-Type": "application/json" },
    });
    runner.assert("auth-no-token", r.status === 401, `Expected 401, got ${r.status}`);
  } catch (e) {
    runner.fail("auth-no-token", e.message);
  }

  // ── 2. auth-bad-token ────────────────────────────────────────────────────
  try {
    const r = await fetch(`${API_BASE}/trpc/flows.list?input=${encodeURIComponent(JSON.stringify({ json: {} }))}`, {
      headers: { Authorization: "Bearer garbage123", "Content-Type": "application/json" },
    });
    runner.assert("auth-bad-token", r.status === 401, `Expected 401, got ${r.status}`);
  } catch (e) {
    runner.fail("auth-bad-token", e.message);
  }

  // ── Tests that require a running deployment ──────────────────────────────
  if (!deploymentId) {
    const skipped = [
      "subagent-crud", "subagent-slug-collision", "subagent-max-limit",
      "flow-create-minimal", "flow-xss-name", "flow-team-types",
      "flow-get-nonexistent", "flow-update-duplicate", "flow-delete",
      "subagent-fork",
    ];
    for (const name of skipped) runner.skip(name, "No running deployment available");
    return runner.summary();
  }

  // ── 3. subagent-crud ─────────────────────────────────────────────────────
  let crudSubagentId = null;
  try {
    // Create
    const createRes = await trpcMR("subagents.create", {
      deploymentId,
      name: "Research Helper",
      systemPrompt: "You help with research",
    }, token);
    const created = unwrap(createRes.body);

    if (!runner.assert("subagent-crud:create", created?.id && created?.slug, `Got: ${JSON.stringify(created)}`)) {
      // skip rest of crud
    } else {
      crudSubagentId = created.id;
      createdSubagentIds.push(created.id);

      // Update
      const updateRes = await trpcMR("subagents.update", {
        id: created.id,
        name: "Deep Researcher",
      }, token);
      const updated = unwrap(updateRes.body);
      runner.assert("subagent-crud:update", updated?.success === true, `Got: ${JSON.stringify(updated)}`);

      // Delete
      const deleteRes = await trpcMR("subagents.delete", { id: created.id }, token);
      const deleted = unwrap(deleteRes.body);
      runner.assert("subagent-crud:delete", deleted?.success === true, `Got: ${JSON.stringify(deleted)}`);

      // Remove from cleanup since we already deleted
      const idx = createdSubagentIds.indexOf(created.id);
      if (idx !== -1) createdSubagentIds.splice(idx, 1);
      crudSubagentId = null;
    }
  } catch (e) {
    runner.fail("subagent-crud", e.message);
  }

  // ── 4. subagent-slug-collision ───────────────────────────────────────────
  try {
    const first = await trpcMR("subagents.create", {
      deploymentId,
      name: "Collision Test Agent",
      systemPrompt: "First agent",
    }, token);
    const firstData = unwrap(first.body);
    if (firstData?.id) createdSubagentIds.push(firstData.id);

    const second = await trpcMR("subagents.create", {
      deploymentId,
      name: "Collision Test Agent",
      systemPrompt: "Second agent with same name",
    }, token);

    // Expect CONFLICT (HTTP 409 or tRPC error)
    const isConflict = second.status === 409 ||
      second.body?.error?.json?.code === "CONFLICT" ||
      errMsg(second.body).includes("already exists");
    runner.assert("subagent-slug-collision", isConflict, `Expected CONFLICT, got status=${second.status} body=${errMsg(second.body)}`);

    // If second somehow succeeded, track for cleanup
    const secondData = unwrap(second.body);
    if (secondData?.id) createdSubagentIds.push(secondData.id);
  } catch (e) {
    runner.fail("subagent-slug-collision", e.message);
  }

  // ── 5. subagent-max-limit ────────────────────────────────────────────────
  const limitSubagentIds = [];
  try {
    // First, list existing subagents to know how many slots are used
    const listRes = await trpcQ("subagents.list", { deploymentId }, token);
    const existing = unwrap(listRes.body) || [];
    const slotsUsed = existing.length;
    const toCreate = Math.max(0, 11 - slotsUsed); // need 11 total to exceed limit of 10

    let hitLimit = false;
    for (let i = 0; i < toCreate; i++) {
      const res = await trpcMR("subagents.create", {
        deploymentId,
        name: `Limit Test ${Date.now()}-${i}`,
        systemPrompt: `Limit test agent ${i}`,
      }, token);
      const data = unwrap(res.body);
      if (data?.id) {
        limitSubagentIds.push(data.id);
        createdSubagentIds.push(data.id);
      } else {
        // Check if this is the BAD_REQUEST we expect
        const isBadReq = res.status === 400 ||
          res.body?.error?.json?.code === "BAD_REQUEST" ||
          errMsg(res.body).includes("Maximum");
        if (isBadReq) {
          hitLimit = true;
          break;
        }
      }
    }

    runner.assert("subagent-max-limit", hitLimit, `Expected BAD_REQUEST after 10 subagents, created ${limitSubagentIds.length} (${slotsUsed} pre-existing)`);
  } catch (e) {
    runner.fail("subagent-max-limit", e.message);
  }

  // ── 6. flow-create-minimal ───────────────────────────────────────────────
  let testFlowId = null;
  try {
    const definition = {
      nodes: [
        {
          id: "node-1",
          type: "deployment",
          deploymentId,
          label: "Agent A",
          position: { x: 0, y: 0 },
        },
        {
          id: "node-2",
          type: "deployment",
          deploymentId,
          label: "Agent B",
          position: { x: 300, y: 0 },
        },
      ],
      edges: [
        { id: "edge-1", source: "node-1", target: "node-2" },
      ],
    };

    const res = await trpcMR("flows.create", {
      name: "QA Test Team",
      definition,
    }, token);
    const data = unwrap(res.body);
    runner.assert("flow-create-minimal", !!data?.id, `Got: ${JSON.stringify(data)?.slice(0, 200)}`);
    if (data?.id) {
      testFlowId = data.id;
      createdFlowIds.push(data.id);
    }
  } catch (e) {
    runner.fail("flow-create-minimal", e.message);
  }

  // ── 7. flow-xss-name ────────────────────────────────────────────────────
  try {
    const res = await trpcMR("flows.create", {
      name: "<img onerror=alert(1) src=x>",
      definition: {
        nodes: [{ id: "n1", type: "output", label: "out", position: { x: 0, y: 0 } }],
        edges: [],
      },
    }, token);

    // Expect rejection — either HTTP error or tRPC validation error
    const isRejected = res.status >= 400 ||
      res.body?.error?.json?.code === "BAD_REQUEST" ||
      errMsg(res.body).toLowerCase().includes("html");
    runner.assert("flow-xss-name", isRejected, `Expected rejection for XSS name, got status=${res.status} body=${errMsg(res.body)}`);

    // If it somehow succeeded, track for cleanup
    const data = unwrap(res.body);
    if (data?.id) createdFlowIds.push(data.id);
  } catch (e) {
    runner.fail("flow-xss-name", e.message);
  }

  // ── 8. flow-team-types ───────────────────────────────────────────────────
  const teamTypeIds = [];
  try {
    const teamTypes = ["hierarchy", "pipeline", "collaborative"];
    let allOk = true;

    for (const teamType of teamTypes) {
      const res = await trpcMR("flows.create", {
        name: `QA ${teamType} Team ${Date.now()}`,
        teamType,
        definition: {
          nodes: [
            { id: "n1", type: "deployment", deploymentId, label: "Agent 1", position: { x: 0, y: 0 } },
          ],
          edges: [],
        },
      }, token);
      const data = unwrap(res.body);
      if (data?.id) {
        teamTypeIds.push(data.id);
        createdFlowIds.push(data.id);
      } else {
        allOk = false;
        runner.fail(`flow-team-types:${teamType}`, errMsg(res.body));
      }
    }

    if (allOk) {
      runner.pass("flow-team-types", `All 3 teamType variants created`);
    }
  } catch (e) {
    runner.fail("flow-team-types", e.message);
  }

  // ── 9. flow-get-nonexistent ──────────────────────────────────────────────
  try {
    const res = await trpcQ("flows.getById", { id: "nonexistent_fake_id_999" }, token);
    const isNotFound = res.status === 404 ||
      res.body?.error?.json?.code === "NOT_FOUND" ||
      errMsg(res.body).includes("not found");
    runner.assert("flow-get-nonexistent", isNotFound, `Expected NOT_FOUND, got status=${res.status}`);
  } catch (e) {
    runner.fail("flow-get-nonexistent", e.message);
  }

  // ── 10. flow-update-duplicate ────────────────────────────────────────────
  let duplicateFlowId = null;
  try {
    if (!testFlowId) {
      runner.skip("flow-update-duplicate", "No test flow was created");
    } else {
      // Update description
      const updateRes = await trpcMR("flows.update", {
        id: testFlowId,
        description: "Updated by QA test suite",
      }, token);
      const updateData = unwrap(updateRes.body);
      const updateOk = updateRes.status < 400 && (updateData?.success === true || updateData?.id);

      // Duplicate
      const dupRes = await trpcMR("flows.duplicate", {
        sourceFlowId: testFlowId,
        name: "QA Duplicated Team",
      }, token);
      const dupData = unwrap(dupRes.body);

      if (dupData?.id) {
        duplicateFlowId = dupData.id;
        createdFlowIds.push(dupData.id);
      }

      runner.assert("flow-update-duplicate", updateOk && !!dupData?.id,
        `update=${updateOk}, duplicate=${!!dupData?.id}`);
    }
  } catch (e) {
    runner.fail("flow-update-duplicate", e.message);
  }

  // ── 11. flow-delete ──────────────────────────────────────────────────────
  try {
    if (!testFlowId) {
      runner.skip("flow-delete", "No test flow was created");
    } else {
      // Soft delete (archive)
      const softRes = await trpcMR("flows.delete", { id: testFlowId, hard: false }, token);
      const softOk = softRes.status < 400;

      // Verify archived — getById should still return it
      const getRes = await trpcQ("flows.getById", { id: testFlowId }, token);
      const flow = unwrap(getRes.body);
      const isArchived = flow?.status === "archived";

      // Hard delete
      const hardRes = await trpcMR("flows.delete", { id: testFlowId, hard: true }, token);
      const hardOk = hardRes.status < 400;

      // Verify gone
      const goneRes = await trpcQ("flows.getById", { id: testFlowId }, token);
      const isGone = goneRes.status === 404 ||
        goneRes.body?.error?.json?.code === "NOT_FOUND" ||
        errMsg(goneRes.body).includes("not found");

      runner.assert("flow-delete:soft", softOk && isArchived,
        `softDelete=${softOk}, isArchived=${isArchived}`);
      runner.assert("flow-delete:hard", hardOk && isGone,
        `hardDelete=${hardOk}, isGone=${isGone}`);

      // Remove from cleanup since we already deleted
      const idx = createdFlowIds.indexOf(testFlowId);
      if (idx !== -1) createdFlowIds.splice(idx, 1);
    }
  } catch (e) {
    runner.fail("flow-delete", e.message);
  }

  // ── 12. subagent-fork ────────────────────────────────────────────────────
  try {
    // Create a subagent to fork
    const createRes = await trpcMR("subagents.create", {
      deploymentId,
      name: `Fork Source ${Date.now()}`,
      systemPrompt: "I am a forkable agent",
    }, token);
    const source = unwrap(createRes.body);

    if (!source?.id) {
      runner.skip("subagent-fork", "Could not create source subagent");
    } else {
      createdSubagentIds.push(source.id);

      // Toggle public
      const toggleRes = await trpcMR("subagents.togglePublic", {
        id: source.id,
        isPublic: true,
      }, token);
      const toggleOk = unwrap(toggleRes.body)?.success === true;

      // Fork to same deployment
      const forkRes = await trpcMR("subagents.fork", {
        sourceSubagentId: source.id,
        targetDeploymentId: deploymentId,
      }, token);
      const forked = unwrap(forkRes.body);

      if (forked?.id) {
        createdSubagentIds.push(forked.id);
      }

      // Verify forkCount incremented by checking the source via getById
      const getRes = await trpcQ("subagents.getById", { id: source.id }, token);
      const sourceAfter = unwrap(getRes.body);
      const forkCountOk = sourceAfter?.forkCount >= 1;

      runner.assert("subagent-fork", toggleOk && !!forked?.id && forkCountOk,
        `togglePublic=${toggleOk}, forked=${!!forked?.id}, forkCount=${sourceAfter?.forkCount}`);
    }
  } catch (e) {
    runner.fail("subagent-fork", e.message);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────
  console.log("\n  Cleaning up...");

  for (const id of createdSubagentIds) {
    try {
      await trpcMR("subagents.delete", { id }, token);
    } catch { /* best-effort cleanup */ }
  }

  for (const id of createdFlowIds) {
    try {
      await trpcMR("flows.delete", { id, hard: true }, token);
    } catch { /* best-effort cleanup */ }
  }

  console.log(`  Cleaned up ${createdSubagentIds.length} subagents, ${createdFlowIds.length} flows.\n`);

  return runner.summary();
}
