import { describe, it, expect } from "vitest";
import { classifyError } from "./chatErrors.js";
import type { ClassifiedError } from "./chatErrors.js";

// ── classifyError ─────────────────────────────────────────────────────────────

describe("classifyError", () => {
  // ── Regex pattern matches ───────────────────────────────────────────────

  it("classifies ETIMEDOUT as GATEWAY_TIMEOUT", () => {
    const result = classifyError("connect ETIMEDOUT 10.0.0.1:18789");
    expect(result.code).toBe("GATEWAY_TIMEOUT");
    expect(result.canRetry).toBe(true);
  });

  it("classifies 'timed out' as GATEWAY_TIMEOUT (case-insensitive)", () => {
    const result = classifyError("Request Timed Out after 30s");
    expect(result.code).toBe("GATEWAY_TIMEOUT");
  });

  it("classifies ECONNREFUSED as GATEWAY_REFUSED", () => {
    const result = classifyError("connect ECONNREFUSED 127.0.0.1:18789");
    expect(result.code).toBe("GATEWAY_REFUSED");
    expect(result.canRetry).toBe(true);
  });

  it("classifies 'handshake' as GATEWAY_REFUSED", () => {
    const result = classifyError("WebSocket handshake failed");
    expect(result.code).toBe("GATEWAY_REFUSED");
  });

  it("classifies ECONNRESET as GATEWAY_RESET", () => {
    const result = classifyError("read ECONNRESET");
    expect(result.code).toBe("GATEWAY_RESET");
    expect(result.canRetry).toBe(true);
  });

  it("classifies 'closed before response' as GATEWAY_RESET", () => {
    const result = classifyError("Socket closed before response was received");
    expect(result.code).toBe("GATEWAY_RESET");
  });

  it("classifies 'auth failed' as GATEWAY_AUTH_FAILED", () => {
    const result = classifyError("Gateway auth failed: bad token");
    expect(result.code).toBe("GATEWAY_AUTH_FAILED");
    expect(result.canRetry).toBe(false);
  });

  it("classifies 'closed before auth' as GATEWAY_AUTH_FAILED", () => {
    const result = classifyError("Connection closed before auth completed");
    expect(result.code).toBe("GATEWAY_AUTH_FAILED");
  });

  it("classifies 'empty response' as BOT_EMPTY_RESPONSE", () => {
    const result = classifyError("Bot returned empty response");
    expect(result.code).toBe("BOT_EMPTY_RESPONSE");
    expect(result.canRetry).toBe(true);
  });

  it("classifies 'No pod found' as POD_NOT_FOUND", () => {
    const result = classifyError("No pod found for deployment dep-abc123");
    expect(result.code).toBe("POD_NOT_FOUND");
    expect(result.canStart).toBe(true);
    expect(result.canRetry).toBe(false);
  });

  it("classifies 'no running pod' as POD_NOT_FOUND", () => {
    const result = classifyError("There is no running pod in namespace jarble");
    expect(result.code).toBe("POD_NOT_FOUND");
  });

  it("classifies CrashLoopBackOff as POD_CRASH_LOOP", () => {
    const result = classifyError("Pod status: CrashLoopBackOff");
    expect(result.code).toBe("POD_CRASH_LOOP");
    expect(result.canRetry).toBe(false);
    expect(result.canStart).toBe(false);
  });

  // ── Context-based classification ────────────────────────────────────────

  it("classifies as DEPLOYMENT_NOT_RUNNING when status is 'stopped'", () => {
    const result = classifyError("some generic error", {
      deploymentStatus: "stopped",
    });
    expect(result.code).toBe("DEPLOYMENT_NOT_RUNNING");
    expect(result.canStart).toBe(true);
  });

  it("classifies as DEPLOYMENT_NOT_RUNNING when status is 'failed'", () => {
    const result = classifyError("some error", {
      deploymentStatus: "failed",
    });
    expect(result.code).toBe("DEPLOYMENT_NOT_RUNNING");
  });

  it("does NOT classify as DEPLOYMENT_NOT_RUNNING when status is 'running'", () => {
    const result = classifyError("some unknown error", {
      deploymentStatus: "running",
    });
    expect(result.code).toBe("UNKNOWN");
  });

  it("does NOT classify as DEPLOYMENT_NOT_RUNNING when status is 'creating'", () => {
    const result = classifyError("some unknown error", {
      deploymentStatus: "creating",
    });
    expect(result.code).toBe("UNKNOWN");
  });

  it("does NOT classify as DEPLOYMENT_NOT_RUNNING when status is 'restarting'", () => {
    const result = classifyError("some unknown error", {
      deploymentStatus: "restarting",
    });
    expect(result.code).toBe("UNKNOWN");
  });

  // ── Fallback ────────────────────────────────────────────────────────────

  it("returns UNKNOWN for unrecognized errors", () => {
    const result = classifyError("something completely unexpected");
    expect(result.code).toBe("UNKNOWN");
    expect(result.canRetry).toBe(true);
    expect(result.canDiagnose).toBe(true);
  });

  it("returns UNKNOWN with default empty context", () => {
    const result = classifyError("random error");
    expect(result.code).toBe("UNKNOWN");
    expect(result.message).toBe("Something went wrong");
    expect(result.suggestion).toBe("Run diagnostics");
  });

  // ── Priority: regex patterns match before context-based check ───────────

  it("regex pattern takes priority over context-based check", () => {
    // ETIMEDOUT should match first even if deployment status is "stopped"
    const result = classifyError("connect ETIMEDOUT", {
      deploymentStatus: "stopped",
    });
    expect(result.code).toBe("GATEWAY_TIMEOUT");
  });

  // ── All results have required fields ────────────────────────────────────

  it("all classified errors have required fields", () => {
    const testCases = [
      classifyError("ETIMEDOUT"),
      classifyError("ECONNREFUSED"),
      classifyError("ECONNRESET"),
      classifyError("auth failed"),
      classifyError("empty response"),
      classifyError("No pod found"),
      classifyError("CrashLoopBackOff"),
      classifyError("unknown", { deploymentStatus: "stopped" }),
      classifyError("unknown"),
    ];

    for (const result of testCases) {
      expect(result).toHaveProperty("code");
      expect(result).toHaveProperty("message");
      expect(result).toHaveProperty("suggestion");
      expect(typeof result.canRetry).toBe("boolean");
      expect(typeof result.canStart).toBe("boolean");
      expect(typeof result.canDiagnose).toBe("boolean");
    }
  });
});
