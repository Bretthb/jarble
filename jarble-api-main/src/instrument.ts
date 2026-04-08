import "dotenv/config";
import * as Sentry from "@sentry/node";

// ─────────────────────────────────────────────────────────────────────────
// OpenTelemetry SDK init — JAR-51 Phase 2 (orchestration observability)
// ─────────────────────────────────────────────────────────────────────────
//
// Why this is loaded BEFORE everything else: OTel auto-instrumentations
// (HTTP/Express/pg/etc) work by monkey-patching the modules at require time.
// If anything else imports `express` or `pg` before this file runs, those
// modules get cached without the instrumentation hooks and never produce
// spans. The Dockerfile + entrypoint already invoke `node dist/.../db/migrate.pg.js`
// before `dist/.../index.js`, and `index.js`'s very first import is this
// file — so we're guaranteed to be first on the API path. The migrator runs
// in its own process and doesn't need OTel.
//
// Failure isolation contract (non-negotiable):
//   - SDK init failures MUST NOT crash the API
//   - Span exporter failures MUST NOT block request handling
//   - Backend down MUST result in dropped spans, not 5xxs
//
// This means: BatchSpanProcessor with bounded queue (drop-on-full),
// short export timeout, and the whole init wrapped in a try/catch.
// The plan in docs/audits/orchestration-observability-plan.md §6.6 is
// the binding spec.
//
// Exporter selection:
//   - OTEL_EXPORTER_OTLP_ENDPOINT set → ship spans there (Langfuse Cloud,
//     a self-hosted Tempo, or an in-cluster collector)
//   - unset           → use the no-op tracer (spans created in-memory but
//                        never exported, zero overhead beyond span allocation)
//   - "console"       → use ConsoleSpanExporter so spans show up in pino
//                        logs (developer mode)
//
// Sample rate is honored from OTEL_TRACES_SAMPLER (defaults are sane).
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ConsoleSpanExporter, BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from "@opentelemetry/semantic-conventions/incubating";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const otelExporterFlag = (process.env.OTEL_EXPORTER || "").toLowerCase();

// Pick the exporter:
//   - If an OTLP endpoint is set, ship there over HTTP/JSON.
//   - Else if OTEL_EXPORTER=console, log spans to stdout (dev only).
//   - Else: undefined → no exporter, spans go nowhere (no overhead beyond
//     allocation, which is what we want by default until Langfuse is wired).
let traceExporter: ConsoleSpanExporter | OTLPTraceExporter | undefined;
if (otelEndpoint) {
  traceExporter = new OTLPTraceExporter({
    url: `${otelEndpoint.replace(/\/+$/, "")}/v1/traces`,
    // Drop spans rather than blocking the application path on a slow backend.
    // BatchSpanProcessor will retry once and then drop on the second failure.
    // 5s is generous; the default is 10s which is too long.
    timeoutMillis: 5_000,
  });
} else if (otelExporterFlag === "console") {
  traceExporter = new ConsoleSpanExporter();
}
// else: leave undefined — SDK runs with the auto-instrumentations creating
// spans in-memory but never exported. Cheap; useful for assertions in tests
// and to lay the groundwork for future Langfuse wiring.

try {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "jarble-api",
      [ATTR_SERVICE_VERSION]: process.env.GIT_SHA || "dev",
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV || "development",
    }),
    // Wrap exporter in a BatchSpanProcessor with bounded queue + drop-on-full
    // semantics so a wedged exporter cannot back-pressure into the API.
    spanProcessors: traceExporter
      ? [
          new BatchSpanProcessor(traceExporter, {
            maxExportBatchSize: 256,
            maxQueueSize: 2048,
            scheduledDelayMillis: 1_000,
            exportTimeoutMillis: 5_000,
          }),
        ]
      : undefined,
    // getNodeAutoInstrumentations() pulls in: HTTP, Express, pg, fetch,
    // and a bunch of others by default. We disable a few noisy ones
    // (fs, dns) that produce a lot of spans without much value.
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
        "@opentelemetry/instrumentation-net": { enabled: false },
      }),
    ],
  });

  sdk.start();

  // Best-effort shutdown on process exit so any in-flight spans get exported
  // before the pod terminates. Wrapped in catch so a wedged shutdown can't
  // hang the SIGTERM grace period.
  const shutdown = () => {
    sdk
      .shutdown()
      .catch((err) => {
        // Use stderr directly — the pino logger may already be torn down.
        process.stderr.write(
          `[otel] shutdown failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
} catch (err) {
  // OTel init must NEVER crash the API. Log the failure and continue.
  process.stderr.write(
    `[otel] SDK init failed (continuing without OTel): ${err instanceof Error ? err.message : String(err)}\n`,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sentry init (legacy — kept for error reporting)
// ─────────────────────────────────────────────────────────────────────────
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    integrations: [
      Sentry.expressIntegration(),
    ],
  });
}
