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

  // Determine if this is a free/platform service (skip credits)
  // Note: SQLite returns 0/1 for booleans, so check both true and 1
  const isFreeService =
    svc.pricingModel === "free" || svc.priceUsdCents === 0 ||
    (svc as any).isPlatform === true || (svc as any).isPlatform === 1;

  if (!isFreeService) {
    // 2 + 3. Check balance AND debit atomically inside a transaction.
    // Without a transaction, two concurrent requests from the same caller can
    // both read a sufficient balance, both proceed to debit, and overdraw the
    // account. The transaction serialises the read-then-write so only one
    // request can debit at a time.
    let insufficientBalance: number | null = null;
    await (db as any).transaction(async (tx: typeof db) => {
      const balance = await getCurrentBalance(params.callerUserId, tx);
      if (balance < CREDITS_PER_CALL) {
        insufficientBalance = balance;
        throw new Error("INSUFFICIENT_CREDITS");
      }

      await addLedgerEntry({
        userId: params.callerUserId,
        amount: -CREDITS_PER_CALL,
        reason: "agent_call",
        reference: callId,
        tx,
      });
    }).catch(async (txErr: any) => {
      // If the transaction was rolled back due to insufficient credits,
      // record the failed call AFTER the transaction completes (to avoid
      // writing on `db` while a SQLite transaction holds the connection).
      if (insufficientBalance !== null) {
        await db.insert(tables.agentCalls).values({
          id: callId,
          callerDeploymentId: params.callerDeploymentId,
          calleeDeploymentId: calleeDeploymentId,
          skillName: params.skillName,
          creditsCharged: 0,
          status: "failed",
          requestBody: JSON.stringify(params.args),
          errorMessage: `Insufficient credits. Balance: ${insufficientBalance}, required: ${CREDITS_PER_CALL}`,
          latencyMs: Date.now() - startTime,
          createdAt: dbDate(),
        } as any);

        throw new Error(
          `Insufficient credits. Balance: ${insufficientBalance}, required: ${CREDITS_PER_CALL}`
        );
      }
      // Re-throw unexpected transaction errors
      throw txErr;
    });
  } else {
    logger.info(
      { callId, serviceId: params.calleeServiceId },
      "Agent call: free/platform service — skipping credit debit"
    );
  }

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

    // Refund credits on failure (only if they were charged).
    // Wrapped in a transaction so the balance read + credit insert are atomic,
    // and in a try-catch so a refund failure does not lose credits silently —
    // the error is logged for manual reconciliation instead.
    if (!isFreeService) {
      try {
        await (db as any).transaction(async (tx: typeof db) => {
          await addLedgerEntry({
            userId: params.callerUserId,
            amount: CREDITS_PER_CALL,
            reason: "refund",
            reference: callId,
            tx,
          });
        });
      } catch (refundErr: any) {
        // Critical: log for manual reconciliation — caller must not lose credits
        logger.error(
          { callId, userId: params.callerUserId, err: refundErr.message },
          "CRITICAL: Failed to refund credits after agent call failure"
        );
      }
    }

    // Record the failed call (outside transaction — this is just logging)
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

  const creditsCharged = isFreeService ? 0 : CREDITS_PER_CALL;

  // 5. Credit the callee's owner (70% revenue share) — skip for free/platform services
  if (!isFreeService && calleeUserId) {
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

  // 6. Record the successful call (always recorded for analytics, even if free)
  const latencyMs = Date.now() - startTime;
  await db.insert(tables.agentCalls).values({
    id: callId,
    callerDeploymentId: params.callerDeploymentId,
    calleeDeploymentId: calleeDeploymentId,
    skillName: params.skillName,
    creditsCharged,
    status: "completed",
    requestBody: JSON.stringify(params.args),
    responseBody: JSON.stringify(result).slice(0, 10_000), // truncate large responses
    latencyMs,
    createdAt: dbDate(),
  } as any);

  logger.info(
    { callId, latencyMs, creditsCharged },
    "Agent call: completed"
  );

  return {
    result,
    creditsCharged,
    callId,
  };
}
