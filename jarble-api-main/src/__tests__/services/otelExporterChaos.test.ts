/**
 * JAR-51 Phase 2 — exporter chaos test.
 *
 * The observability plan (docs/audits/orchestration-observability-plan.md §6.6)
 * makes one non-negotiable promise:
 *
 *   > Exporter failures MUST NOT block request handling.
 *   > Backend down MUST result in dropped spans, not 5xxs.
 *
 * Our instrument.ts wires a BatchSpanProcessor with a bounded queue:
 *
 *   new BatchSpanProcessor(traceExporter, {
 *     maxExportBatchSize: 256,
 *     maxQueueSize: 2048,
 *     scheduledDelayMillis: 1_000,
 *     exportTimeoutMillis: 5_000,
 *   });
 *
 * This test verifies, with a live processor + hanging exporter, that:
 *
 *   1. Ending a span is always a synchronous, non-blocking operation —
 *      even when the exporter is wedged and the queue is at capacity.
 *   2. Producing MORE spans than the queue size does not block — the
 *      excess is dropped on the floor.
 *   3. Forcing `forceFlush` against a wedged exporter honors a timeout
 *      rather than hanging the caller.
 *
 * If any of these assertions fail, the exporter can back-pressure into
 * the API hot path and a Langfuse outage could become a user-facing
 * 5xx storm. That is exactly what the BatchSpanProcessor contract
 * exists to prevent.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type SpanExporter,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import type { ExportResult } from "@opentelemetry/core";

/**
 * A deliberately broken exporter. Every export call hangs forever so the
 * BatchSpanProcessor's queue never drains. This simulates "Langfuse Cloud
 * down, DNS timeouts, TCP black hole" — the worst case for a remote OTLP
 * target.
 */
class HangingExporter implements SpanExporter {
  public exportCalls = 0;
  public shutdownCalled = false;

  export(
    _spans: ReadableSpan[],
    _resultCallback: (result: ExportResult) => void,
  ): void {
    this.exportCalls += 1;
    // Never call the callback. Forever. The processor's exportTimeoutMillis
    // is what bails us out.
  }

  async shutdown(): Promise<void> {
    this.shutdownCalled = true;
  }

  async forceFlush(): Promise<void> {
    // Swallow; we're simulating a wedged backend.
  }
}

describe("OTel BatchSpanProcessor — drop-on-full chaos", () => {
  let provider: BasicTracerProvider;
  let exporter: HangingExporter;
  let processor: BatchSpanProcessor;

  beforeAll(() => {
    exporter = new HangingExporter();
    // Tiny queue + batch so we hit the drop path fast. In prod we run
    // 2048, but the behavior under test is the same.
    processor = new BatchSpanProcessor(exporter, {
      maxQueueSize: 8,
      maxExportBatchSize: 4,
      scheduledDelayMillis: 50,
      exportTimeoutMillis: 200,
    });
    provider = new BasicTracerProvider({ spanProcessors: [processor] });
    // Scope to this test only — do not pollute the global tracer provider
    // because other tests in the suite may expect a noop tracer.
  });

  afterAll(async () => {
    // Best-effort cleanup. shutdown() on a BatchSpanProcessor with a
    // wedged exporter should itself honor its timeout rather than hang.
    // Catch any rejection — we expect the hanging exporter to cause one
    // and we do not want it to surface as an unhandled rejection in
    // vitest's reporter.
    await processor.shutdown().catch(() => {
      // expected — hanging exporter, nothing to do
    });
  });

  it("ending a span is synchronous and non-blocking under a wedged exporter", () => {
    const tracer = provider.getTracer("chaos");
    // Baseline: end one span and measure wall time. If BatchSpanProcessor
    // were blocking on the exporter, this would take 200ms+ (the
    // exportTimeoutMillis) or forever. Budget: 50ms is generous.
    const start = Date.now();
    const span = tracer.startSpan("chaos.one");
    span.end();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it("producing more spans than the queue size does not block the caller", async () => {
    const tracer = provider.getTracer("chaos");
    // Queue is 8 + batch 4, so by the time we cross ~12 spans the
    // processor has to drop. Fire 200 and measure total wall time.
    const start = Date.now();
    for (let i = 0; i < 200; i += 1) {
      const span = tracer.startSpan(`chaos.flood.${i}`);
      span.setAttribute("index", i);
      span.end();
    }
    const elapsed = Date.now() - start;
    // 200 spans with a hanging exporter should still return in well
    // under a second. If this ever crosses 500ms something is VERY
    // wrong with the drop-on-full path.
    expect(elapsed).toBeLessThan(500);
  });

  it("forceFlush honors the configured timeout even when the exporter hangs", async () => {
    // With a hanging exporter, forceFlush cannot succeed — but it MUST
    // settle (either resolve or reject) within exportTimeoutMillis.
    // A BatchSpanProcessor that hangs its own forceFlush would mean
    // shutdown could hang a pod's SIGTERM grace period forever, which
    // violates the failure isolation contract.
    //
    // The processor implementation rejects with `Error("Timeout")` from
    // its own internal timer after exportTimeoutMillis elapses, which
    // we catch explicitly so vitest does not classify it as an
    // unhandled rejection.
    const start = Date.now();
    let settled = false;
    await processor
      .forceFlush()
      .catch(() => {
        // Expected — hanging exporter causes the processor's internal
        // timeout to fire. This is exactly the failure mode we want:
        // the caller gets an error within a bounded time instead of
        // hanging forever.
      })
      .finally(() => {
        settled = true;
      });
    const elapsed = Date.now() - start;
    expect(settled).toBe(true);
    // Must settle within a reasonable bound. The processor's
    // exportTimeoutMillis is 200ms; allow 500ms slack for test
    // scheduler jitter on busy CI.
    expect(elapsed).toBeLessThan(700);
  });
});
