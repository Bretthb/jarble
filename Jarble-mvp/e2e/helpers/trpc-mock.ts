import type { Page, Route } from "@playwright/test";
import superjson from "superjson";

/**
 * tRPC batch-aware mock helper.
 *
 * The frontend uses httpBatchLink which combines multiple tRPC queries into
 * a single HTTP request. Individual route intercepts don't work because the
 * URL contains all procedure names comma-separated.
 *
 * This helper intercepts ALL /trpc/* requests and resolves each procedure
 * from a registered mock map. Procedures without mocks are forwarded to
 * the real API.
 */

type MockHandler = (input: unknown) => unknown;

/**
 * Set up batch-aware tRPC mocks.
 *
 * @param page - Playwright page
 * @param mocks - Map of procedure name → mock response data (or handler function)
 *
 * Example:
 * ```ts
 * await setupTrpcMocks(page, {
 *   "deployment.list": [{ id: "1", name: "test" }],
 *   "runtimeCatalog.list": [{ id: "rt1", slug: "openclaw" }],
 *   "deployment.canDeploy": { freeUsed: false, canDeploy: true },
 * });
 * ```
 */
export async function setupTrpcMocks(
  page: Page,
  mocks: Record<string, unknown | MockHandler>,
) {
  await page.route("**/trpc/*", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;

    // Extract procedure names from URL path: /trpc/proc1,proc2,proc3
    const trpcPath = pathname.replace(/^.*\/trpc\//, "");
    const procedures = trpcPath.split(",");

    // Parse batch input if present
    const inputParam = url.searchParams.get("input");
    let inputs: Record<string, unknown> = {};
    if (inputParam) {
      try {
        inputs = JSON.parse(inputParam);
      } catch {
        // Non-batch request or malformed input
      }
    }

    // Check if ALL procedures have mocks
    const allMocked = procedures.every((proc) => proc in mocks);

    if (!allMocked) {
      // Forward to real API if any procedure lacks a mock
      await route.continue();
      return;
    }

    // Build batch response array
    const responses = procedures.map((proc, index) => {
      const mockData = mocks[proc];
      const input = inputs[index.toString()];

      // If mock is a function, call it with the input
      const data = typeof mockData === "function"
        ? (mockData as MockHandler)(input)
        : mockData;

      // Wrap with SuperJSON serialization
      const serialized = superjson.serialize(data);

      return {
        result: {
          data: serialized,
        },
      };
    });

    // Single procedure = single response, batch = array
    const body = procedures.length === 1 ? responses[0] : responses;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

/**
 * Set up a mock for tRPC error responses.
 */
export async function setupTrpcErrorMocks(
  page: Page,
  errorMocks: Record<string, { message: string; code: string }>,
) {
  await page.route("**/trpc/*", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const trpcPath = pathname.replace(/^.*\/trpc\//, "");
    const procedures = trpcPath.split(",");

    const allMocked = procedures.every((proc) => proc in errorMocks);
    if (!allMocked) {
      await route.continue();
      return;
    }

    const responses = procedures.map((proc) => {
      const err = errorMocks[proc];
      return {
        error: {
          message: err.message,
          code: err.code,
          data: { code: err.code, httpStatus: 500 },
        },
      };
    });

    const body = procedures.length === 1 ? responses[0] : responses;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}
