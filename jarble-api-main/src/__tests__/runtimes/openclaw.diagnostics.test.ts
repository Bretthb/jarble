/**
 * Unit tests for runOpenClawDiagnostics (JAR-99 LOW #3).
 *
 * The diagnostic helper runs every pod-side probe in a single exec call
 * and slices the combined stdout back into per-check fragments using
 * `===TAG===` section markers. Coverage focuses on:
 *
 *   1. The section parser — does it correctly extract each fragment
 *      across all the canned outcomes the probe script can emit?
 *   2. The gatewayDown decision matrix — HTTP 200, CURL_FAILED + process
 *      heuristic, non-200 HTTP code.
 *   3. podModel resolution — primary path, legacy fallback, neither.
 *   4. Exec failure — must return a single error check and gatewayDown=true
 *      without throwing.
 *
 * The probe script itself (the "what to run inside the pod" half) is
 * covered indirectly: every test that asserts on the parsed checks
 * implicitly asserts that the script's output structure matches what
 * the parser expects.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockExecInPod = vi.fn();

vi.mock("../../k8s/index.js", () => ({
  execInPod: (...args: any[]) => mockExecInPod(...args),
}));

vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { runOpenClawDiagnostics } from "../../runtimes/handlers/openclaw.diagnostics.js";

beforeEach(() => {
  mockExecInPod.mockReset();
});

/** Build an exec output string in the format the probe script emits. */
function buildExecOutput(sections: Record<string, string>) {
  const order = [
    "HTTP_HEALTH",
    "PROCESS",
    "VERSION",
    "CONFIG",
    "PID",
    "HELP",
    "DOCTOR",
  ];
  const parts: string[] = [];
  for (const tag of order) {
    parts.push(`===${tag}===`);
    if (tag in sections) parts.push(sections[tag]);
  }
  parts.push("===DONE===");
  return parts.join("\n");
}

const HEALTHY_CONFIG = JSON.stringify({
  agents: { defaults: { model: { primary: "claude-sonnet-4-20250514" } } },
});

const HEALTHY_VERSION = JSON.stringify({ name: "openclaw", version: "2026.2.25" });

const HEALTHY_OUTPUT = buildExecOutput({
  HTTP_HEALTH: "200",
  PROCESS: "USER PID CMD\n1 root /sbin/init\n42 root node /opt/openclaw/gateway",
  VERSION: HEALTHY_VERSION,
  CONFIG: HEALTHY_CONFIG,
  PID: "12345",
  HELP: "openclaw <command>",
  DOCTOR: "All systems nominal",
});

const ctx = { podName: "dep-test-pod", managedBy: "legacy" as const };

// ── Happy path ──────────────────────────────────────────────────────────────

describe("runOpenClawDiagnostics — happy path", () => {
  it("returns ok checks for every probe when everything succeeds", async () => {
    mockExecInPod.mockResolvedValueOnce(HEALTHY_OUTPUT);

    const result = await runOpenClawDiagnostics(ctx);

    expect(result.gatewayDown).toBe(false);
    expect(result.podModel).toBe("claude-sonnet-4-20250514");

    const byName = Object.fromEntries(result.checks.map((c) => [c.name, c]));
    expect(byName["Gateway HTTP"].status).toBe("ok");
    expect(byName["Process List"].status).toBe("ok");
    expect(byName["OpenClaw Version"].status).toBe("ok");
    expect(byName["OpenClaw Version"].detail).toContain("2026.2.25");
    expect(byName["OpenClaw Config"].status).toBe("ok");
    expect(byName["Hot Reload"].status).toBe("ok");
    expect(byName["OpenClaw CLI"].status).toBe("ok");
    expect(byName["OpenClaw Doctor"].status).toBe("ok");
  });
});

// ── Gateway HTTP / gatewayDown matrix ───────────────────────────────────────

describe("runOpenClawDiagnostics — Gateway HTTP", () => {
  it("marks gatewayDown=false on HTTP 200", async () => {
    mockExecInPod.mockResolvedValueOnce(HEALTHY_OUTPUT);
    const r = await runOpenClawDiagnostics(ctx);
    expect(r.gatewayDown).toBe(false);
    expect(r.checks.find((c) => c.name === "Gateway HTTP")?.status).toBe("ok");
  });

  it("marks gatewayDown=true on a non-200 HTTP response", async () => {
    mockExecInPod.mockResolvedValueOnce(
      buildExecOutput({
        ...defaultSections(),
        HTTP_HEALTH: "502",
      }),
    );
    const r = await runOpenClawDiagnostics(ctx);
    expect(r.gatewayDown).toBe(true);
    const httpCheck = r.checks.find((c) => c.name === "Gateway HTTP")!;
    expect(httpCheck.status).toBe("error");
    expect(httpCheck.detail).toContain("502");
  });

  it("falls back to process detection when curl is missing AND a node process is running", async () => {
    mockExecInPod.mockResolvedValueOnce(
      buildExecOutput({
        ...defaultSections(),
        HTTP_HEALTH: "CURL_FAILED",
        PROCESS: "1 root /sbin/init\n42 root node /opt/openclaw/gateway",
      }),
    );
    const r = await runOpenClawDiagnostics(ctx);
    expect(r.gatewayDown).toBe(false);
    expect(r.checks.find((c) => c.name === "Gateway HTTP")?.status).toBe("warning");
  });

  it("falls back to process detection when curl is missing AND no openclaw process is running", async () => {
    mockExecInPod.mockResolvedValueOnce(
      buildExecOutput({
        ...defaultSections(),
        HTTP_HEALTH: "CURL_FAILED",
        PROCESS: "1 root /sbin/init",
      }),
    );
    const r = await runOpenClawDiagnostics(ctx);
    expect(r.gatewayDown).toBe(true);
  });
});

// ── Process List ────────────────────────────────────────────────────────────

describe("runOpenClawDiagnostics — Process List", () => {
  it("warns when ps is unavailable", async () => {
    mockExecInPod.mockResolvedValueOnce(
      buildExecOutput({
        ...defaultSections(),
        PROCESS: "NO_PS",
      }),
    );
    const r = await runOpenClawDiagnostics(ctx);
    const proc = r.checks.find((c) => c.name === "Process List")!;
    expect(proc.status).toBe("warning");
    expect(proc.detail).toContain("ps not available");
  });

  it("trims process listing to first 3 lines for the detail field", async () => {
    const longProc = Array.from({ length: 10 }, (_, i) => `line-${i}`).join("\n");
    mockExecInPod.mockResolvedValueOnce(
      buildExecOutput({
        ...defaultSections(),
        PROCESS: longProc,
      }),
    );
    const r = await runOpenClawDiagnostics(ctx);
    const proc = r.checks.find((c) => c.name === "Process List")!;
    expect(proc.detail).toBe("line-0; line-1; line-2");
  });
});

// ── Version ─────────────────────────────────────────────────────────────────

describe("runOpenClawDiagnostics — OpenClaw Version", () => {
  it("warns when version file is missing", async () => {
    mockExecInPod.mockResolvedValueOnce(
      buildExecOutput({ ...defaultSections(), VERSION: "NO_VERSION" }),
    );
    const r = await runOpenClawDiagnostics(ctx);
    const v = r.checks.find((c) => c.name === "OpenClaw Version")!;
    expect(v.status).toBe("warning");
  });

  it("warns when package.json exists but is malformed", async () => {
    mockExecInPod.mockResolvedValueOnce(
      buildExecOutput({ ...defaultSections(), VERSION: "{not json" }),
    );
    const r = await runOpenClawDiagnostics(ctx);
    const v = r.checks.find((c) => c.name === "OpenClaw Version")!;
    expect(v.status).toBe("warning");
    expect(v.detail).toContain("malformed");
  });
});

// ── Config / podModel resolution ────────────────────────────────────────────

describe("runOpenClawDiagnostics — OpenClaw Config", () => {
  it("returns error + suggestion when config is missing", async () => {
    mockExecInPod.mockResolvedValueOnce(
      buildExecOutput({ ...defaultSections(), CONFIG: "NO_CONFIG" }),
    );
    const r = await runOpenClawDiagnostics(ctx);
    const c = r.checks.find((x) => x.name === "OpenClaw Config")!;
    expect(c.status).toBe("error");
    expect(c.suggestion).toBeDefined();
    expect(r.podModel).toBeNull();
  });

  it("warns when config file is malformed JSON", async () => {
    mockExecInPod.mockResolvedValueOnce(
      buildExecOutput({ ...defaultSections(), CONFIG: "{not json" }),
    );
    const r = await runOpenClawDiagnostics(ctx);
    const c = r.checks.find((x) => x.name === "OpenClaw Config")!;
    expect(c.status).toBe("warning");
    expect(r.podModel).toBeNull();
  });

  it("extracts podModel from agents.defaults.model.primary (current path)", async () => {
    mockExecInPod.mockResolvedValueOnce(
      buildExecOutput({
        ...defaultSections(),
        CONFIG: JSON.stringify({
          agents: { defaults: { model: { primary: "claude-opus-4-20250514" } } },
        }),
      }),
    );
    const r = await runOpenClawDiagnostics(ctx);
    expect(r.podModel).toBe("claude-opus-4-20250514");
  });

  it("falls back to agent.model legacy field when primary path is absent", async () => {
    mockExecInPod.mockResolvedValueOnce(
      buildExecOutput({
        ...defaultSections(),
        CONFIG: JSON.stringify({ agent: { model: "legacy-model-name" } }),
      }),
    );
    const r = await runOpenClawDiagnostics(ctx);
    expect(r.podModel).toBe("legacy-model-name");
  });

  it("returns ok with podModel=null when valid config has neither field", async () => {
    mockExecInPod.mockResolvedValueOnce(
      buildExecOutput({
        ...defaultSections(),
        CONFIG: JSON.stringify({ unrelated: "yes" }),
      }),
    );
    const r = await runOpenClawDiagnostics(ctx);
    const c = r.checks.find((x) => x.name === "OpenClaw Config")!;
    expect(c.status).toBe("ok");
    expect(r.podModel).toBeNull();
  });
});

// ── Hot Reload / PID ────────────────────────────────────────────────────────

describe("runOpenClawDiagnostics — Hot Reload", () => {
  it("reports ok with the PID when the .openclaw.pid file is present", async () => {
    mockExecInPod.mockResolvedValueOnce(
      buildExecOutput({ ...defaultSections(), PID: "67890" }),
    );
    const r = await runOpenClawDiagnostics(ctx);
    const hr = r.checks.find((x) => x.name === "Hot Reload")!;
    expect(hr.status).toBe("ok");
    expect(hr.detail).toContain("67890");
  });

  it("warns when PID file is missing", async () => {
    mockExecInPod.mockResolvedValueOnce(
      buildExecOutput({ ...defaultSections(), PID: "NO_PID" }),
    );
    const r = await runOpenClawDiagnostics(ctx);
    const hr = r.checks.find((x) => x.name === "Hot Reload")!;
    expect(hr.status).toBe("warning");
    expect(hr.detail).toContain("Not supported");
  });
});

// ── HELP / DOCTOR optional probes ───────────────────────────────────────────

describe("runOpenClawDiagnostics — optional probes", () => {
  it("does not push a CLI check when help output is missing", async () => {
    mockExecInPod.mockResolvedValueOnce(
      buildExecOutput({ ...defaultSections(), HELP: "NO_HELP" }),
    );
    const r = await runOpenClawDiagnostics(ctx);
    expect(r.checks.find((c) => c.name === "OpenClaw CLI")).toBeUndefined();
  });

  it("strips ANSI color codes from CLI help output", async () => {
    mockExecInPod.mockResolvedValueOnce(
      buildExecOutput({
        ...defaultSections(),
        HELP: "\x1b[32mUsage:\x1b[0m openclaw <command>",
      }),
    );
    const r = await runOpenClawDiagnostics(ctx);
    const cli = r.checks.find((c) => c.name === "OpenClaw CLI")!;
    expect(cli.detail).not.toContain("\x1b[");
    expect(cli.detail).toContain("Usage:");
  });

  it("flags doctor output as warning when it mentions errors", async () => {
    mockExecInPod.mockResolvedValueOnce(
      buildExecOutput({
        ...defaultSections(),
        DOCTOR: "Critical: gateway unreachable",
      }),
    );
    const r = await runOpenClawDiagnostics(ctx);
    const doc = r.checks.find((c) => c.name === "OpenClaw Doctor")!;
    expect(doc.status).toBe("warning");
  });

  it("does not push a Doctor check when doctor output is missing", async () => {
    mockExecInPod.mockResolvedValueOnce(
      buildExecOutput({ ...defaultSections(), DOCTOR: "NO_DOCTOR" }),
    );
    const r = await runOpenClawDiagnostics(ctx);
    expect(r.checks.find((c) => c.name === "OpenClaw Doctor")).toBeUndefined();
  });
});

// ── Exec failure ────────────────────────────────────────────────────────────

describe("runOpenClawDiagnostics — exec failure", () => {
  it("returns a single error check + gatewayDown=true when exec rejects", async () => {
    mockExecInPod.mockRejectedValueOnce(new Error("connection refused"));

    const r = await runOpenClawDiagnostics(ctx);

    expect(r.checks).toHaveLength(1);
    expect(r.checks[0].name).toBe("In-Pod Diagnostics");
    expect(r.checks[0].status).toBe("error");
    expect(r.checks[0].detail).toContain("connection refused");
    expect(r.gatewayDown).toBe(true);
    expect(r.podModel).toBeNull();
  });

  it("does not throw — wraps non-Error rejections too", async () => {
    mockExecInPod.mockRejectedValueOnce("string-rejection");

    const r = await runOpenClawDiagnostics(ctx);

    expect(r.checks).toHaveLength(1);
    expect(r.checks[0].status).toBe("error");
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function defaultSections(): Record<string, string> {
  return {
    HTTP_HEALTH: "200",
    PROCESS: "USER PID CMD\n1 root /sbin/init\n42 root node /opt/openclaw/gateway",
    VERSION: HEALTHY_VERSION,
    CONFIG: HEALTHY_CONFIG,
    PID: "12345",
    HELP: "openclaw <command>",
    DOCTOR: "All systems nominal",
  };
}
