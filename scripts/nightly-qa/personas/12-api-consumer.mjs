/**
 * Persona 12: API Consumer
 * Direct tRPC and REST API calls without browser.
 */

import { ApiClient } from "../lib/apiClient.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runApiConsumer({ apiUrl }) {
  const api = new ApiClient(apiUrl);
  const steps = [];

  try {
    // Step 1: Health check / root endpoint
    const healthRes = await api.rest("GET", "/");
    steps.push(
      testStep(
        "API root responds",
        healthRes.status !== null && healthRes.status < 500 ? TestStatus.PASS : TestStatus.FAIL,
        { status: healthRes.status, duration: `${healthRes.duration}ms` }
      )
    );

    // Step 2: tRPC runtime catalog list
    const runtimeRes = await api.trpc("runtimeCatalog.list");
    steps.push(
      testStep(
        "tRPC runtimeCatalog.list",
        runtimeRes.status !== null && runtimeRes.status < 500 ? TestStatus.PASS : TestStatus.FAIL,
        { status: runtimeRes.status, duration: `${runtimeRes.duration}ms` }
      )
    );

    // Step 3: tRPC template.list
    const templateRes = await api.trpc("template.list");
    steps.push(
      testStep(
        "tRPC template.list",
        templateRes.status !== null && templateRes.status < 500 ? TestStatus.PASS : TestStatus.FAIL,
        { status: templateRes.status, duration: `${templateRes.duration}ms` }
      )
    );

    // Step 4: tRPC marketplace endpoint
    const marketplaceRes = await api.trpc("marketplace.listPublished");
    steps.push(
      testStep(
        "tRPC marketplace.listPublished",
        marketplaceRes.status !== null && marketplaceRes.status < 500 ? TestStatus.PASS : TestStatus.FAIL,
        { status: marketplaceRes.status, duration: `${marketplaceRes.duration}ms` }
      )
    );

    // Step 5: Protected endpoint returns 401 without auth
    const protectedRes = await api.trpc("user.me");
    steps.push(
      testStep(
        "Protected endpoint returns 401",
        protectedRes.status === 401 || protectedRes.status === 403 ? TestStatus.PASS : TestStatus.WARN,
        { status: protectedRes.status, note: "Unauthenticated request should be rejected" }
      )
    );

    // Step 6: Invalid tRPC path returns error gracefully
    const invalidRes = await api.trpc("nonexistent.route");
    steps.push(
      testStep(
        "Invalid tRPC route handled gracefully",
        invalidRes.status !== null ? TestStatus.PASS : TestStatus.FAIL,
        { status: invalidRes.status }
      )
    );

    // Step 7: API response times under threshold
    const summary = api.getSummary();
    steps.push(
      testStep(
        "Average API response time",
        summary.avgDuration < Thresholds.API_CALL ? TestStatus.PASS : TestStatus.WARN,
        {
          avgDuration: `${summary.avgDuration}ms`,
          totalCalls: summary.total,
          slowest: summary.slowest ? `${summary.slowest.path} (${summary.slowest.duration}ms)` : "N/A",
        }
      )
    );

    // Step 8: CORS headers present
    const corsRes = await api.rest("OPTIONS", "/trpc/runtimeCatalog.list");
    steps.push(
      testStep(
        "API responds to OPTIONS (CORS preflight)",
        corsRes.status !== null ? TestStatus.PASS : TestStatus.WARN,
        { status: corsRes.status, duration: `${corsRes.duration}ms` }
      )
    );

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message }));
  }

  return {
    persona: "API Consumer",
    description: "Direct tRPC and REST API calls without browser",
    steps,
    browser: {
      persona: "12-api-consumer",
      screenshots: [],
      consoleLogs: [],
      networkErrors: api.getResults().filter((r) => r.error).map((r) => ({
        method: r.method,
        url: r.path,
        status: r.status,
        error: r.error,
        timestamp: r.timestamp,
      })),
      networkRequests: api.getResults().map((r) => ({
        method: r.method,
        url: r.path,
        status: r.status,
        duration: r.duration,
        timestamp: r.timestamp,
      })),
      performanceMetrics: api.getResults().map((r) => ({
        name: `${r.method} ${r.path}`,
        value: r.duration,
        timestamp: r.timestamp,
      })),
      errors: [],
    },
  };
}
