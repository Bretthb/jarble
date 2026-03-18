/**
 * Marketplace Hub — mediates agent-to-agent calls
 *
 * Central proxy that handles credit deduction, revenue sharing,
 * and call tracking for agent-to-agent skill invocations.
 */

import crypto from "crypto";
import { eq, and, sql } from "drizzle-orm";
import { db, tables, dbDate } from "../db/index.js";
import { createModuleLogger } from "../utils/logger.js";
import { getCurrentBalance, addLedgerEntry } from "../trpc/routers/agentCredits.js";

const logger = createModuleLogger("marketplace-hub");

const CREDITS_PER_CALL = 1;        // Flat rate per call (MVP)
const CREATOR_REVENUE_SHARE = 0.7; // 70% goes to the callee's owner

export interface AgentCallParams {
  callerDeploymentId: string;
  calleeServiceId: string;
  skillName: string;
  args: any;
  callerUserId: string;
}

export interface AgentCallResult {
  result: any;
  creditsCharged: number;
  callId: string;
}

/**
 * Execute an agent-to-agent call through the marketplace hub.
 *
 * Flow:
 * 1. Look up the service and its owner
 * 2. Check caller has sufficient credits
 * 3. Debit credits from caller
 * 4. Execute the skill via the service execution infrastructure
 * 5. Credit the callee's owner (70% revenue share)
 * 6. Record the call in agentCalls
 * 7. Return result
 */
export async function executeAgentCall(
  params: AgentCallParams
): Promise<AgentCallResult> {
  const startTime = Date.now();
  const callId = `acl_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

  logger.info(
    {
      callId,
      caller: params.callerDeploymentId,
      callee: params.calleeServiceId,
      skill: params.skillName,
    },
    "Agent call: starting"
  );

  // 1. Look up the service
  const service = await db
    .select()
    .from(tables.marketplaceServices)
    .where(eq(tables.marketplaceServices.id, params.calleeServiceId))
    .limit(1);

  if (service.length === 0) {
    throw new Error(`Service not found: ${params.calleeServiceId}`);
  }

  const svc = service[0];
  if (svc.status !== "published") {
    throw new Error(`Service is not published: ${svc.status}`);
  }

  // Get the callee deployment ID (the creator's deployment that runs this service)
  const calleeDeploymentId = svc.creatorDeploymentId;
  if (!calleeDeploymentId) {
    throw new Error("Service has no associated deployment");
  }

  // Get the service owner's user ID via creator profile
  const creatorProfile = await db
    .select()
    .from(tables.creatorProfiles)
    .where(eq(tables.creatorProfiles.id, svc.creatorId))
    .limit(1);

  const calleeUserId = creatorProfile.length > 0 ? creatorProfile[0].userId : null;

  // 2. Check caller has sufficient credits
  const balance = await getCurrentBalance(params.callerUserId);
  if (balance < CREDITS_PER_CALL) {
    // Record the failed call
    await db.insert(tables.agentCalls).values({
      id: callId,
      callerDeploymentId: params.callerDeploymentId,
      calleeDeploymentId: calleeDeploymentId,
      skillName: params.skillName,
      creditsCharged: 0,
      status: "failed",
      requestBody: JSON.stringify(params.args),
      errorMessage: `Insufficient credits. Balance: ${balance}, required: ${CREDITS_PER_CALL}`,
      latencyMs: Date.now() - startTime,
      createdAt: dbDate(),
    } as any);

    throw new Error(
      `Insufficient credits. Balance: ${balance}, required: ${CREDITS_PER_CALL}`
    );
  }

  // 3. Debit credits from caller
  await addLedgerEntry({
    userId: params.callerUserId,
    amount: -CREDITS_PER_CALL,
    reason: "agent_call",
    reference: callId,
  });

  // 4. Execute the skill via HTTP to the service execution endpoint
  let result: any;
  let error: string | null = null;

  try {
    const apiBase = process.env.API_BASE_URL || "http://localhost:3001";
    const execUrl = `${apiBase}/api/services/execute/${params.calleeServiceId}/${params.skillName}`;

    const response = await fetch(execUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Deployment-Id": params.callerDeploymentId,
        // Use internal auth for hub-mediated calls
        "X-Hub-Call-Id": callId,
      },
      body: JSON.stringify(params.args || {}),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const errBody = await response.text();
      error = `Service returned ${response.status}: ${errBody.slice(0, 500)}`;
      throw new Error(error);
    }

    result = await response.json();
  } catch (err: any) {
    error = error || err.message;

    // Refund credits on failure
    await addLedgerEntry({
      userId: params.callerUserId,
      amount: CREDITS_PER_CALL,
      reason: "refund",
      reference: callId,
    });

    // Record the failed call
    await db.insert(tables.agentCalls).values({
      id: callId,
      callerDeploymentId: params.callerDeploymentId,
      calleeDeploymentId: calleeDeploymentId,
      skillName: params.skillName,
      creditsCharged: 0,
      status: "failed",
      requestBody: JSON.stringify(params.args),
      errorMessage: error,
      latencyMs: Date.now() - startTime,
      createdAt: dbDate(),
    } as any);

    throw new Error(`Agent call failed: ${error}`);
  }

  // 5. Credit the callee's owner (70% revenue share)
  if (calleeUserId) {
    const creatorCredits = Math.floor(CREDITS_PER_CALL * CREATOR_REVENUE_SHARE);
    if (creatorCredits > 0) {
      try {
        await addLedgerEntry({
          userId: calleeUserId,
          amount: creatorCredits,
          reason: "earnings",
          reference: callId,
        });
      } catch (err: any) {
        // Non-fatal — log but don't fail the call
        logger.warn(
          { callId, calleeUserId, err: err.message },
          "Failed to credit callee owner"
        );
      }
    }
  }

  // 6. Record the successful call
  const latencyMs = Date.now() - startTime;
  await db.insert(tables.agentCalls).values({
    id: callId,
    callerDeploymentId: params.callerDeploymentId,
    calleeDeploymentId: calleeDeploymentId,
    skillName: params.skillName,
    creditsCharged: CREDITS_PER_CALL,
    status: "completed",
    requestBody: JSON.stringify(params.args),
    responseBody: JSON.stringify(result).slice(0, 10_000), // truncate large responses
    latencyMs,
    createdAt: dbDate(),
  } as any);

  logger.info(
    { callId, latencyMs, creditsCharged: CREDITS_PER_CALL },
    "Agent call: completed"
  );

  return {
    result,
    creditsCharged: CREDITS_PER_CALL,
    callId,
  };
}
