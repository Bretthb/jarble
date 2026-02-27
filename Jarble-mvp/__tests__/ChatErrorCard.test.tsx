import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatErrorCard from "@/components/workspace/ChatErrorCard";
import type { ClassifiedChatError } from "@/components/workspace/ChatErrorCard";
import type { DiagnosticResult } from "@/hooks/useDiagnose";

// ---- fixtures ----

const GATEWAY_TIMEOUT_ERROR: ClassifiedChatError = {
  code: "GATEWAY_TIMEOUT",
  message: "Bot is not responding",
  suggestion: "The bot may still be starting up. Try again in a moment.",
  canRetry: true,
  canStart: false,
  canDiagnose: true,
};

const POD_NOT_FOUND_ERROR: ClassifiedChatError = {
  code: "POD_NOT_FOUND",
  message: "Bot is not running",
  suggestion: "Start the bot to begin chatting.",
  canRetry: false,
  canStart: true,
  canDiagnose: false,
};

const GENERIC_ERROR: ClassifiedChatError = {
  code: "UNKNOWN",
  message: "Something went wrong",
  suggestion: "Please try again later.",
  canRetry: true,
  canStart: false,
  canDiagnose: false,
};

const HEALTHY_DIAGNOSIS: DiagnosticResult = {
  deploymentId: "test-123",
  timestamp: "2026-02-27T12:00:00Z",
  overallHealth: "healthy",
  checks: [
    { name: "Pod Status", status: "ok", detail: "Running (1/1 ready)" },
    { name: "Gateway", status: "ok", detail: "Responding on port 18789" },
    { name: "LLM Key", status: "ok", detail: "Anthropic key valid" },
  ],
};

const DEGRADED_DIAGNOSIS: DiagnosticResult = {
  deploymentId: "test-456",
  timestamp: "2026-02-27T12:00:00Z",
  overallHealth: "degraded",
  checks: [
    { name: "Pod Status", status: "ok", detail: "Running (1/1 ready)" },
    {
      name: "Gateway",
      status: "warning",
      detail: "High latency (3200ms)",
      suggestion: "Consider restarting the bot if latency persists.",
    },
    { name: "LLM Key", status: "ok", detail: "OpenRouter key valid" },
  ],
};

const UNHEALTHY_DIAGNOSIS: DiagnosticResult = {
  deploymentId: "test-789",
  timestamp: "2026-02-27T12:00:00Z",
  overallHealth: "unhealthy",
  checks: [
    { name: "Pod Status", status: "error", detail: "CrashLoopBackOff", suggestion: "Check pod logs for errors." },
    { name: "Gateway", status: "skipped", detail: "Skipped (pod not ready)" },
    { name: "LLM Key", status: "skipped", detail: "Skipped (pod not ready)" },
  ],
};

// ---- tests ----

describe("ChatErrorCard", () => {
  let onRetry: ReturnType<typeof vi.fn>;
  let onStartBot: ReturnType<typeof vi.fn>;
  let onDiagnose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onRetry = vi.fn();
    onStartBot = vi.fn();
    onDiagnose = vi.fn();
  });

  // ---------- rendering error messages ----------

  it("renders GATEWAY_TIMEOUT error message and suggestion", () => {
    render(
      <ChatErrorCard
        error={GATEWAY_TIMEOUT_ERROR}
        onRetry={onRetry}
        onDiagnose={onDiagnose}
        diagnosis={null}
        isDiagnosing={false}
      />,
    );
    expect(screen.getByText("Bot is not responding")).toBeTruthy();
    expect(screen.getByText("The bot may still be starting up. Try again in a moment.")).toBeTruthy();
  });

  it("renders POD_NOT_FOUND error message and suggestion", () => {
    render(
      <ChatErrorCard
        error={POD_NOT_FOUND_ERROR}
        onStartBot={onStartBot}
        diagnosis={null}
        isDiagnosing={false}
      />,
    );
    expect(screen.getByText("Bot is not running")).toBeTruthy();
    expect(screen.getByText("Start the bot to begin chatting.")).toBeTruthy();
  });

  // ---------- button visibility ----------

  it("shows Retry and Diagnose buttons for GATEWAY_TIMEOUT", () => {
    render(
      <ChatErrorCard
        error={GATEWAY_TIMEOUT_ERROR}
        onRetry={onRetry}
        onDiagnose={onDiagnose}
        diagnosis={null}
        isDiagnosing={false}
      />,
    );
    expect(screen.getByText("Retry")).toBeTruthy();
    expect(screen.getByText("Diagnose")).toBeTruthy();
    expect(screen.queryByText("Start Bot")).toBeNull();
  });

  it("shows Start Bot button for POD_NOT_FOUND, hides Retry and Diagnose", () => {
    render(
      <ChatErrorCard
        error={POD_NOT_FOUND_ERROR}
        onStartBot={onStartBot}
        diagnosis={null}
        isDiagnosing={false}
      />,
    );
    expect(screen.getByText("Start Bot")).toBeTruthy();
    expect(screen.queryByText("Retry")).toBeNull();
    expect(screen.queryByText("Diagnose")).toBeNull();
  });

  it("shows only Retry for generic error (no diagnose, no start)", () => {
    render(
      <ChatErrorCard
        error={GENERIC_ERROR}
        onRetry={onRetry}
        diagnosis={null}
        isDiagnosing={false}
      />,
    );
    expect(screen.getByText("Retry")).toBeTruthy();
    expect(screen.queryByText("Diagnose")).toBeNull();
    expect(screen.queryByText("Start Bot")).toBeNull();
  });

  it("hides Retry button when onRetry is not provided even if canRetry is true", () => {
    render(
      <ChatErrorCard
        error={GATEWAY_TIMEOUT_ERROR}
        onDiagnose={onDiagnose}
        diagnosis={null}
        isDiagnosing={false}
      />,
    );
    expect(screen.queryByText("Retry")).toBeNull();
  });

  // ---------- button clicks ----------

  it("calls onRetry when Retry button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ChatErrorCard
        error={GATEWAY_TIMEOUT_ERROR}
        onRetry={onRetry}
        onDiagnose={onDiagnose}
        diagnosis={null}
        isDiagnosing={false}
      />,
    );
    await user.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("calls onStartBot when Start Bot button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ChatErrorCard
        error={POD_NOT_FOUND_ERROR}
        onStartBot={onStartBot}
        diagnosis={null}
        isDiagnosing={false}
      />,
    );
    await user.click(screen.getByText("Start Bot"));
    expect(onStartBot).toHaveBeenCalledOnce();
  });

  it("calls onDiagnose when Diagnose button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ChatErrorCard
        error={GATEWAY_TIMEOUT_ERROR}
        onRetry={onRetry}
        onDiagnose={onDiagnose}
        diagnosis={null}
        isDiagnosing={false}
      />,
    );
    await user.click(screen.getByText("Diagnose"));
    expect(onDiagnose).toHaveBeenCalledOnce();
  });

  // ---------- diagnosing state ----------

  it("shows 'Diagnosing...' and disables button during diagnosis", () => {
    render(
      <ChatErrorCard
        error={GATEWAY_TIMEOUT_ERROR}
        onRetry={onRetry}
        onDiagnose={onDiagnose}
        diagnosis={null}
        isDiagnosing={true}
      />,
    );
    const btn = screen.getByText("Diagnosing...");
    expect(btn).toBeTruthy();
    // The button element wrapping it should be disabled
    expect(btn.closest("button")?.disabled).toBe(true);
  });

  // ---------- diagnosis results (collapsed by default) ----------

  it("shows diagnosis header when results are present but collapsed by default", () => {
    render(
      <ChatErrorCard
        error={GATEWAY_TIMEOUT_ERROR}
        onRetry={onRetry}
        onDiagnose={onDiagnose}
        diagnosis={HEALTHY_DIAGNOSIS}
        isDiagnosing={false}
      />,
    );
    expect(screen.getByText("Diagnosis Results")).toBeTruthy();
    expect(screen.getByText("(healthy)")).toBeTruthy();
    // Checks should NOT be visible yet (collapsed)
    expect(screen.queryByText("Pod Status:")).toBeNull();
  });

  it("does not show diagnosis section when diagnosis is null", () => {
    render(
      <ChatErrorCard
        error={GATEWAY_TIMEOUT_ERROR}
        onRetry={onRetry}
        onDiagnose={onDiagnose}
        diagnosis={null}
        isDiagnosing={false}
      />,
    );
    expect(screen.queryByText("Diagnosis Results")).toBeNull();
  });

  // ---------- expanding diagnosis results ----------

  it("expands diagnosis checks when header is clicked", async () => {
    const user = userEvent.setup();
    render(
      <ChatErrorCard
        error={GATEWAY_TIMEOUT_ERROR}
        onRetry={onRetry}
        onDiagnose={onDiagnose}
        diagnosis={HEALTHY_DIAGNOSIS}
        isDiagnosing={false}
      />,
    );

    // Click to expand
    await user.click(screen.getByText("Diagnosis Results"));

    // Now checks should be visible
    expect(screen.getByText("Pod Status:")).toBeTruthy();
    expect(screen.getByText("Running (1/1 ready)")).toBeTruthy();
    expect(screen.getByText("Gateway:")).toBeTruthy();
    expect(screen.getByText("Responding on port 18789")).toBeTruthy();
    expect(screen.getByText("LLM Key:")).toBeTruthy();
    expect(screen.getByText("Anthropic key valid")).toBeTruthy();
  });

  it("collapses diagnosis checks when header is clicked again", async () => {
    const user = userEvent.setup();
    render(
      <ChatErrorCard
        error={GATEWAY_TIMEOUT_ERROR}
        onRetry={onRetry}
        onDiagnose={onDiagnose}
        diagnosis={HEALTHY_DIAGNOSIS}
        isDiagnosing={false}
      />,
    );

    // Expand
    await user.click(screen.getByText("Diagnosis Results"));
    expect(screen.getByText("Pod Status:")).toBeTruthy();

    // Collapse
    await user.click(screen.getByText("Diagnosis Results"));
    expect(screen.queryByText("Pod Status:")).toBeNull();
  });

  // ---------- health status colors ----------

  it("displays healthy status with correct color class", () => {
    render(
      <ChatErrorCard
        error={GATEWAY_TIMEOUT_ERROR}
        onRetry={onRetry}
        onDiagnose={onDiagnose}
        diagnosis={HEALTHY_DIAGNOSIS}
        isDiagnosing={false}
      />,
    );
    const healthLabel = screen.getByText("(healthy)");
    expect(healthLabel.className).toContain("text-emerald-400");
  });

  it("displays degraded status with correct color class", () => {
    render(
      <ChatErrorCard
        error={GATEWAY_TIMEOUT_ERROR}
        onRetry={onRetry}
        onDiagnose={onDiagnose}
        diagnosis={DEGRADED_DIAGNOSIS}
        isDiagnosing={false}
      />,
    );
    const healthLabel = screen.getByText("(degraded)");
    expect(healthLabel.className).toContain("text-amber-400");
  });

  it("displays unhealthy status with correct color class", () => {
    render(
      <ChatErrorCard
        error={GATEWAY_TIMEOUT_ERROR}
        onRetry={onRetry}
        onDiagnose={onDiagnose}
        diagnosis={UNHEALTHY_DIAGNOSIS}
        isDiagnosing={false}
      />,
    );
    const healthLabel = screen.getByText("(unhealthy)");
    expect(healthLabel.className).toContain("text-red-400");
  });

  // ---------- individual check statuses ----------

  it("shows suggestion text for checks that have one", async () => {
    const user = userEvent.setup();
    render(
      <ChatErrorCard
        error={GATEWAY_TIMEOUT_ERROR}
        onRetry={onRetry}
        onDiagnose={onDiagnose}
        diagnosis={DEGRADED_DIAGNOSIS}
        isDiagnosing={false}
      />,
    );

    await user.click(screen.getByText("Diagnosis Results"));
    expect(screen.getByText("Consider restarting the bot if latency persists.")).toBeTruthy();
  });

  it("renders all check statuses for unhealthy diagnosis", async () => {
    const user = userEvent.setup();
    render(
      <ChatErrorCard
        error={GATEWAY_TIMEOUT_ERROR}
        onRetry={onRetry}
        onDiagnose={onDiagnose}
        diagnosis={UNHEALTHY_DIAGNOSIS}
        isDiagnosing={false}
      />,
    );

    await user.click(screen.getByText("Diagnosis Results"));

    expect(screen.getByText("Pod Status:")).toBeTruthy();
    expect(screen.getByText("CrashLoopBackOff")).toBeTruthy();
    expect(screen.getByText("Check pod logs for errors.")).toBeTruthy();
    expect(screen.getByText("Gateway:")).toBeTruthy();
    // Both Gateway and LLM Key have "Skipped (pod not ready)" as detail
    const skippedElements = screen.getAllByText("Skipped (pod not ready)");
    expect(skippedElements.length).toBe(2);
  });

  // ---------- diagnose button auto-expands ----------

  it("auto-expands diagnosis when Diagnose is clicked and results arrive", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ChatErrorCard
        error={GATEWAY_TIMEOUT_ERROR}
        onRetry={onRetry}
        onDiagnose={onDiagnose}
        diagnosis={null}
        isDiagnosing={false}
      />,
    );

    // Click Diagnose - sets diagnosisOpen=true internally
    await user.click(screen.getByText("Diagnose"));

    // Simulate results arriving
    rerender(
      <ChatErrorCard
        error={GATEWAY_TIMEOUT_ERROR}
        onRetry={onRetry}
        onDiagnose={onDiagnose}
        diagnosis={HEALTHY_DIAGNOSIS}
        isDiagnosing={false}
      />,
    );

    // Should be auto-expanded because diagnosisOpen was set to true by the click
    expect(screen.getByText("Pod Status:")).toBeTruthy();
    expect(screen.getByText("Running (1/1 ready)")).toBeTruthy();
  });

  // ---------- error card structure ----------

  it("renders error icon (AlertTriangle svg)", () => {
    const { container } = render(
      <ChatErrorCard
        error={GATEWAY_TIMEOUT_ERROR}
        onRetry={onRetry}
        onDiagnose={onDiagnose}
        diagnosis={null}
        isDiagnosing={false}
      />,
    );
    // Lucide renders as <svg> with class including the icon name
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });

  it("has the red border styling on the outer container", () => {
    const { container } = render(
      <ChatErrorCard
        error={GENERIC_ERROR}
        onRetry={onRetry}
        diagnosis={null}
        isDiagnosing={false}
      />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("border-red-500/30");
    expect(card.className).toContain("bg-red-500/5");
  });
});
