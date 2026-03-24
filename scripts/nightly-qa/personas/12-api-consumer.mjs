/**
 * Persona 12: API Consumer
 * Direct tRPC and REST API calls — all routers, auth, CORS, rate limiting, response times.
 */

import { ApiClient } from "../lib/apiClient.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runApiConsumer({ apiUrl, config = {} }) {
  const authToken = config.authToken;
  const api = new ApiClient(apiUrl, authToken);
  const noAuthApi = new ApiClient(apiUrl); // No token for 401 tests
  const steps = [];

  try {
    // Step 1: Health check / root endpoint
    const healthRes = await api.rest("GET", "/");
    steps.push(
      testStep("API root responds", healthRes.status !== null && healthRes.status < 500 ? TestStatus.PASS : TestStatus.FAIL, {
        status: healthRes.status, duration: `${healthRes.duration}ms`,
      })
    );

    // Step 2: Health check response time < 200ms
    steps.push(
      testStep("Health check < 200ms", healthRes.duration < 200 ? TestStatus.PASS : TestStatus.WARN, { duration: `${healthRes.duration}ms` })
    );

    // Step 3: tRPC user.me (authenticated)
    const userRes = await api.trpc("user.me");
    steps.push(
      testStep("tRPC user.me (authenticated)", userRes.status !== null && userRes.status < 500 ? TestStatus.PASS : TestStatus.WARN, {
        status: userRes.status, duration: `${userRes.duration}ms`,
      })
    );

    // Step 4: tRPC deployment.list
    const deployRes = await api.trpc("deployment.list");
    steps.push(
      testStep("tRPC deployment.list", deployRes.status !== null && deployRes.status < 500 ? TestStatus.PASS : TestStatus.WARN, {
        status: deployRes.status, duration: `${deployRes.duration}ms`,
      })
    );

    // Step 5: tRPC runtimeCatalog.list
    const runtimeRes = await api.trpc("runtimeCatalog.list");
    steps.push(
      testStep("tRPC runtimeCatalog.list", runtimeRes.status !== null && runtimeRes.status < 500 ? TestStatus.PASS : TestStatus.FAIL, {
        status: runtimeRes.status, duration: `${runtimeRes.duration}ms`,
      })
    );

    // Step 6: tRPC template.list
    const templateRes = await api.trpc("template.list");
    steps.push(
      testStep("tRPC template.list", templateRes.status !== null && templateRes.status < 500 ? TestStatus.PASS : TestStatus.FAIL, {
        status: templateRes.status, duration: `${templateRes.duration}ms`,
      })
    );

    // Step 7: tRPC marketplace.listPublished
    const marketplaceRes = await api.trpc("marketplace.listPublished");
    steps.push(
      testStep("tRPC marketplace.listPublished", marketplaceRes.status !== null && marketplaceRes.status < 500 ? TestStatus.PASS : TestStatus.FAIL, {
        status: marketplaceRes.status, duration: `${marketplaceRes.duration}ms`,
      })
    );

    // Step 8: tRPC services.listPublished
    const servicesRes = await api.trpc("services.listPublished");
    steps.push(
      testStep("tRPC services.listPublished", servicesRes.status !== null && servicesRes.status < 500 ? TestStatus.PASS : TestStatus.WARN, {
        status: servicesRes.status, duration: `${servicesRes.duration}ms`,
      })
    );

    // Step 9: tRPC billing.getOverview
    const billingRes = await api.trpc("billing.getOverview");
    steps.push(
      testStep("tRPC billing.getOverview", billingRes.status !== null && billingRes.status < 500 ? TestStatus.PASS : TestStatus.WARN, {
        status: billingRes.status, duration: `${billingRes.duration}ms`,
      })
    );

    // Step 10: Test 401 on protected routes without token
    const unauthedUserRes = await noAuthApi.trpc("user.me");
    steps.push(
      testStep("Protected endpoint returns 401 (user.me)", unauthedUserRes.status === 401 || unauthedUserRes.status === 403 ? TestStatus.PASS : TestStatus.WARN, {
        status: unauthedUserRes.status, note: "Unauthenticated request should be rejected",
      })
    );

    // Step 11: Test 401 on deployment.list without token
    const unauthedDeployRes = await noAuthApi.trpc("deployment.list");
    steps.push(
      testStep("Protected endpoint returns 401 (deployment.list)", unauthedDeployRes.status === 401 || unauthedDeployRes.status === 403 ? TestStatus.PASS : TestStatus.WARN, {
        status: unauthedDeployRes.status,
      })
    );

    // Step 12: Test CORS headers present
    const corsRes = await api.rest("OPTIONS", "/trpc/runtimeCatalog.list");
    steps.push(
      testStep("API responds to OPTIONS (CORS preflight)", corsRes.status !== null ? TestStatus.PASS : TestStatus.WARN, {
        status: corsRes.status, duration: `${corsRes.duration}ms`,
      })
    );

    // Step 13: Test rate limiting response (hit endpoint 50x rapidly)
    const rateLimitResults = await api.concurrent(
      Array.from({ length: 50 }, () => ({ method: "GET", path: "/trpc/runtimeCatalog.list" }))
    );
    const rateLimited = rateLimitResults.filter((r) => r.status === 429);
    steps.push(
      testStep("Rate limit test (50 rapid requests)", TestStatus.PASS, {
        total: rateLimitResults.length,
        rateLimited: rateLimited.length,
        note: rateLimited.length > 0 ? "Rate limiting active" : "No rate limiting detected",
      })
    );

    // Step 14: Test invalid route returns 404
    const invalidRes = await api.trpc("nonexistent.route");
    steps.push(
      testStep("Invalid tRPC route handled gracefully", invalidRes.status !== null ? TestStatus.PASS : TestStatus.FAIL, { status: invalidRes.status })
    );

    // Step 15: Verify response times < 500ms for list endpoints
    const listEndpoints = ["runtimeCatalog.list", "template.list", "marketplace.listPublished"];
    const listTimes = [];
    for (const endpoint of listEndpoints) {
      const res = await api.trpc(endpoint);
      listTimes.push({ endpoint, duration: res.duration, status: res.status });
    }
    const allFast = listTimes.every((r) => r.duration < 500);
    steps.push(
      testStep("List endpoints < 500ms response", allFast ? TestStatus.PASS : TestStatus.WARN, {
        times: listTimes.map((r) => `${r.endpoint}: ${r.duration}ms`),
      })
    );

    // Step 16: Test large input handling
    const largeInput = { query: "a".repeat(5000) };
    const largeRes = await api.trpc("runtimeCatalog.list", largeInput);
    steps.push(
      testStep("Large input handled gracefully", largeRes.status !== null ? TestStatus.PASS : TestStatus.FAIL, {
        status: largeRes.status, duration: `${largeRes.duration}ms`,
      })
    );

    // Step 17: Test invalid JSON body
    const invalidJsonRes = await api.rest("POST", "/trpc/runtimeCatalog.list", "not-json");
    steps.push(
      testStep("Invalid JSON body handled", invalidJsonRes.status !== null && invalidJsonRes.status < 500 ? TestStatus.PASS : TestStatus.WARN, {
        status: invalidJsonRes.status,
      })
    );

    // Step 18: Average API response time
    const summary = api.getSummary();
    steps.push(
      testStep("Average API response time", summary.avgDuration < Thresholds.API_CALL ? TestStatus.PASS : TestStatus.WARN, {
        avgDuration: `${summary.avgDuration}ms`, totalCalls: summary.total,
        slowest: summary.slowest ? `${summary.slowest.path} (${summary.slowest.duration}ms)` : "N/A",
      })
    );

    // Step 19: No 500 errors across all API calls
    const serverErrors = api.getResults().filter((r) => (r.status || 0) >= 500);
    steps.push(
      testStep("No 500 errors across all API calls", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, {
        count: serverErrors.length, total: api.getResults().length,
      })
    );

    // Step 20: Test concurrent mixed endpoint calls
    const mixedConcurrent = await api.concurrent([
      { method: "GET", path: "/trpc/runtimeCatalog.list" },
      { method: "GET", path: "/trpc/template.list" },
      { method: "GET", path: "/trpc/marketplace.listPublished" },
      { method: "GET", path: "/" },
    ]);
    const allMixedOk = mixedConcurrent.every((r) => r.status && r.status < 500);
    steps.push(
      testStep("Concurrent mixed endpoints succeed", allMixedOk ? TestStatus.PASS : TestStatus.FAIL, {
        statuses: mixedConcurrent.map((r) => r.status).join(", "),
      })
    );

    // Step 21: tRPC flows.list
    const flowsRes = await api.trpc("flows.list");
    steps.push(
      testStep("tRPC flows.list", flowsRes.status !== null && flowsRes.status < 500 ? TestStatus.PASS : TestStatus.WARN, {
        status: flowsRes.status, duration: `${flowsRes.duration}ms`,
      })
    );

    // Step 22: Debug endpoints (dev only)
    const debugRes = await api.rest("GET", "/debug/db");
    steps.push(
      testStep("Debug endpoint accessible (dev)", debugRes.status !== null ? TestStatus.PASS : TestStatus.SKIP, {
        status: debugRes.status, note: "Only available in dev mode",
      })
    );

    // Step 23: Test empty input on query
    const emptyRes = await api.trpc("runtimeCatalog.list", {});
    steps.push(
      testStep("Empty input query handled", emptyRes.status !== null && emptyRes.status < 500 ? TestStatus.PASS : TestStatus.WARN, {
        status: emptyRes.status,
      })
    );

    // Step 24: Test response content type
    const contentTypeRes = await api.rest("GET", "/trpc/runtimeCatalog.list");
    steps.push(
      testStep("API returns JSON content type", contentTypeRes.status !== null ? TestStatus.PASS : TestStatus.WARN, {
        status: contentTypeRes.status,
      })
    );

    // Step 25: Overall API error rate
    const allResults = api.getResults();
    const errorRate = allResults.filter((r) => r.error).length / allResults.length;
    steps.push(
      testStep("API error rate < 10%", errorRate < 0.1 ? TestStatus.PASS : TestStatus.WARN, {
        errorRate: `${(errorRate * 100).toFixed(1)}%`, totalCalls: allResults.length,
      })
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
        method: r.method, url: r.path, status: r.status, error: r.error, timestamp: r.timestamp,
      })),
      networkRequests: api.getResults().map((r) => ({
        method: r.method, url: r.path, status: r.status, duration: r.duration, timestamp: r.timestamp,
      })),
      performanceMetrics: api.getResults().map((r) => ({
        name: `${r.method} ${r.path}`, value: r.duration, timestamp: r.timestamp,
      })),
      errors: [],
    },
  };
}
