/**
 * Persona 05: Stress Tester
 * Rapid API calls, large payloads, concurrent requests, rate limit detection, memory checks.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { ApiClient } from "../lib/apiClient.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";
import { injectAuth } from "../lib/auth.mjs";

export default async function runStressTester({ baseUrl, apiUrl, config = {} }) {
  const session = new BrowserSession("05-stress-tester");
  const authHeaders = config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {};
  const api = new ApiClient(apiUrl, config.authToken);
  const steps = [];

  try {
    await session.start();

    // Inject Auth0 session for authenticated pages
    if (config.authToken) {
      await injectAuth(session.context, session.page, config.authToken);
    }

    // Step 1: Rapid page navigation (10 pages in quick succession)
    const pages = ["/", "/dashboard", "/pricing", "/d/demo", "/settings", "/marketplace", "/about", "/billing", "/onboarding", "/"];
    const times = [];
    for (const path of pages) {
      try {
        const t = await session.navigate(`${baseUrl}${path}`);
        times.push(t);
      } catch (_) {
        times.push(30000); // timeout
      }
    }
    const avgTime = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    steps.push(
      testStep("Rapid navigation (10 pages)", avgTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, {
        avgLoadTime: `${avgTime}ms`, pages: times.map((t) => `${t}ms`).join(", "),
      })
    );
    await session.screenshot("stress-rapid-nav");

    // Step 2: 5 concurrent API calls
    const concurrent5 = await api.concurrent([
      { method: "GET", path: "/trpc/runtimeCatalog.list" },
      { method: "GET", path: "/trpc/runtimeCatalog.list" },
      { method: "GET", path: "/trpc/runtimeCatalog.list" },
      { method: "GET", path: "/trpc/runtimeCatalog.list" },
      { method: "GET", path: "/trpc/runtimeCatalog.list" },
    ]);
    const all5Ok = concurrent5.every((r) => r.status && r.status < 500);
    steps.push(
      testStep("5 concurrent API calls succeed", all5Ok ? TestStatus.PASS : TestStatus.FAIL, {
        statuses: concurrent5.map((r) => r.status).join(", "),
      })
    );

    // Step 3: 10 concurrent API calls
    const concurrent10 = await api.concurrent(
      Array.from({ length: 10 }, () => ({ method: "GET", path: "/trpc/runtimeCatalog.list" }))
    );
    const all10Ok = concurrent10.every((r) => r.status && r.status < 500);
    steps.push(
      testStep("10 concurrent API calls succeed", all10Ok ? TestStatus.PASS : TestStatus.WARN, {
        statuses: concurrent10.map((r) => r.status).join(", "),
      })
    );

    // Step 4: Large query string (2KB)
    const longInput = "a".repeat(2048);
    const largeQueryRes = await api.rest("GET", `/trpc/runtimeCatalog.list?input=${encodeURIComponent(JSON.stringify({ q: longInput }))}`);
    steps.push(
      testStep("Large query string (2KB) handled", largeQueryRes.status !== null ? TestStatus.PASS : TestStatus.FAIL, {
        status: largeQueryRes.status, duration: `${largeQueryRes.duration}ms`,
      })
    );

    // Step 5: Rate limit detection (hit endpoint 100x rapidly)
    const rateLimitResults = [];
    const batchSize = 20;
    for (let i = 0; i < 5; i++) {
      const batch = await api.concurrent(
        Array.from({ length: batchSize }, () => ({ method: "GET", path: "/trpc/runtimeCatalog.list" }))
      );
      rateLimitResults.push(...batch);
    }
    const rateLimited = rateLimitResults.filter((r) => r.status === 429);
    steps.push(
      testStep("Rate limit detection (100 requests)", TestStatus.PASS, {
        totalRequests: rateLimitResults.length,
        rateLimited: rateLimited.length,
        note: rateLimited.length > 0 ? "Rate limiting is active" : "No rate limiting detected",
      })
    );

    // Step 6: Large POST body (50KB)
    const largeBody = { data: "x".repeat(50000) };
    const largePostRes = await api.rest("POST", "/trpc/runtimeCatalog.list", largeBody);
    steps.push(
      testStep("Large POST body (50KB) handled", largePostRes.status !== null ? TestStatus.PASS : TestStatus.FAIL, {
        status: largePostRes.status, duration: `${largePostRes.duration}ms`,
      })
    );

    // Step 7: API response time < 500ms for list endpoints
    const listRes = await api.trpc("runtimeCatalog.list");
    steps.push(
      testStep("API response time < 500ms (list)", listRes.duration < 500 ? TestStatus.PASS : TestStatus.WARN, { duration: `${listRes.duration}ms` })
    );

    // Step 8: API response time < 200ms for health check
    const healthRes = await api.rest("GET", "/");
    steps.push(
      testStep("API response time < 200ms (health)", healthRes.duration < 200 ? TestStatus.PASS : TestStatus.WARN, { duration: `${healthRes.duration}ms` })
    );

    // Step 9: Verify no 500 errors under load
    const allResults = api.getResults();
    const serverErrors = allResults.filter((r) => (r.status || 0) >= 500);
    steps.push(
      testStep("No 500 errors under load", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: serverErrors.length, total: allResults.length })
    );

    // Step 10: Memory check — page doesn't exceed 100MB
    await session.navigate(baseUrl);
    await session.page.waitForTimeout(2000);
    const memoryUsage = await session.page.evaluate(() => {
      if (performance.memory) {
        return {
          usedJSHeapSize: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
          totalJSHeapSize: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
        };
      }
      return null;
    });
    if (memoryUsage) {
      steps.push(
        testStep("Page memory < 100MB", memoryUsage.usedJSHeapSize < 100 ? TestStatus.PASS : TestStatus.WARN, {
          usedMB: memoryUsage.usedJSHeapSize, totalMB: memoryUsage.totalJSHeapSize,
        })
      );
    } else {
      steps.push(testStep("Page memory < 100MB", TestStatus.SKIP, { note: "performance.memory not available" }));
    }

    // Step 11: Rapid DOM interaction stress test
    const clickCount = await session.page.evaluate(() => {
      let clicks = 0;
      const links = document.querySelectorAll("a, button");
      links.forEach((el) => {
        el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
        clicks++;
      });
      return clicks;
    });
    steps.push(
      testStep("Rapid hover stress (all interactive elements)", TestStatus.PASS, { elementsHovered: clickCount })
    );

    // Step 12: Check memory-related console warnings
    const memoryWarnings = session.consoleLogs.filter(
      (l) => l.text.toLowerCase().includes("memory") || l.text.toLowerCase().includes("leak")
    );
    steps.push(
      testStep("No memory leak warnings", memoryWarnings.length === 0 ? TestStatus.PASS : TestStatus.WARN, { count: memoryWarnings.length })
    );

    // Step 13: Check no 429 rate limit responses in browser
    const browserRateLimits = session.networkErrors.filter((e) => e.status === 429);
    steps.push(
      testStep("No browser-side rate limiting", browserRateLimits.length === 0 ? TestStatus.PASS : TestStatus.WARN, { count: browserRateLimits.length })
    );

    // Step 14: API average response time under threshold
    const apiSummary = api.getSummary();
    steps.push(
      testStep("API avg response time", apiSummary.avgDuration < Thresholds.API_CALL ? TestStatus.PASS : TestStatus.WARN, {
        avgDuration: `${apiSummary.avgDuration}ms`, totalCalls: apiSummary.total,
      })
    );

    // Step 15: Overall server error check
    const allServerErrors = [...session.networkErrors, ...api.getResults()].filter((e) => (e.status || 0) >= 500);
    steps.push(
      testStep("No server errors under stress", allServerErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: allServerErrors.length })
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
