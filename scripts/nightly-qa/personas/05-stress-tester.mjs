/**
 * Persona 05: Stress Tester
 * Rapid API calls, large payloads, concurrent requests.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { ApiClient } from "../lib/apiClient.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runStressTester({ baseUrl, apiUrl }) {
  const session = new BrowserSession("05-stress-tester");
  const api = new ApiClient(apiUrl);
  const steps = [];

  try {
    await session.start();

    // Step 1: Rapid page navigation (5 pages quickly)
    const pages = ["/", "/dashboard", "/pricing", "/d/demo", "/"];
    const times = [];
    for (const path of pages) {
      const t = await session.navigate(`${baseUrl}${path}`);
      times.push(t);
    }
    const avgTime = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    steps.push(
      testStep("Rapid navigation (5 pages)", avgTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, {
        avgLoadTime: `${avgTime}ms`,
        pages: times.map((t) => `${t}ms`).join(", "),
      })
    );
    await session.screenshot("stress-rapid-nav");

    // Step 2: Concurrent API health checks
    const concurrentResults = await api.concurrent([
      { method: "GET", path: "/trpc/runtimeCatalog.list" },
      { method: "GET", path: "/trpc/runtimeCatalog.list" },
      { method: "GET", path: "/trpc/runtimeCatalog.list" },
      { method: "GET", path: "/trpc/runtimeCatalog.list" },
      { method: "GET", path: "/trpc/runtimeCatalog.list" },
    ]);
    const allOk = concurrentResults.every((r) => r.status && r.status < 500);
    steps.push(
      testStep("5 concurrent API calls succeed", allOk ? TestStatus.PASS : TestStatus.FAIL, {
        statuses: concurrentResults.map((r) => r.status).join(", "),
      })
    );

    // Step 3: Large query string handling
    const longInput = "a".repeat(5000);
    const largeRes = await api.rest("GET", `/trpc/runtimeCatalog.list?input=${encodeURIComponent(JSON.stringify({ q: longInput }))}`);
    steps.push(
      testStep("Large query string handled", largeRes.status !== null ? TestStatus.PASS : TestStatus.FAIL, {
        status: largeRes.status,
        duration: `${largeRes.duration}ms`,
      })
    );

    // Step 4: API response times under threshold
    const apiSummary = api.getSummary();
    steps.push(
      testStep(
        "API avg response time",
        apiSummary.avgDuration < Thresholds.API_CALL ? TestStatus.PASS : TestStatus.WARN,
        { avgDuration: `${apiSummary.avgDuration}ms`, totalCalls: apiSummary.total }
      )
    );

    // Step 5: Rapid DOM interaction stress test
    await session.navigate(baseUrl);
    const clickCount = await session.page.evaluate(() => {
      let clicks = 0;
      const links = document.querySelectorAll("a, button");
      // Simulate rapid hover over all interactive elements
      links.forEach((el) => {
        el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
        clicks++;
      });
      return clicks;
    });
    steps.push(
      testStep("Rapid hover stress (all interactive elements)", TestStatus.PASS, {
        elementsHovered: clickCount,
      })
    );

    // Step 6: Check memory-related console warnings
    const memoryWarnings = session.consoleLogs.filter(
      (l) => l.text.toLowerCase().includes("memory") || l.text.toLowerCase().includes("leak")
    );
    steps.push(
      testStep("No memory leak warnings", memoryWarnings.length === 0 ? TestStatus.PASS : TestStatus.WARN, {
        count: memoryWarnings.length,
      })
    );

    // Step 7: Check no 429 rate limit responses
    const rateLimits = session.networkErrors.filter((e) => e.status === 429);
    const apiRateLimits = api.getResults().filter((r) => r.status === 429);
    steps.push(
      testStep(
        "No rate limiting (429)",
        rateLimits.length === 0 && apiRateLimits.length === 0 ? TestStatus.PASS : TestStatus.WARN,
        { browser429: rateLimits.length, api429: apiRateLimits.length }
      )
    );

    // Step 8: Overall server error check
    const serverErrors = [...session.networkErrors, ...api.getResults()].filter(
      (e) => (e.status || 0) >= 500
    );
    steps.push(
      testStep("No server errors under stress", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, {
        count: serverErrors.length,
      })
    );

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "Stress Tester",
    description: "Rapid API calls, large payloads, concurrency",
    steps,
    browser: session.getReport(),
  };
}
