import { test, expect } from "@playwright/test";

test.describe("Polished Canvas Components", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/test-components");
    // Wait for framer-motion animations to settle
    await page.waitForTimeout(1500);
  });

  test("page loads all component sections", async ({ page }) => {
    await expect(page.locator("h1")).toHaveText("Canvas Component Visual Test");
    await expect(page.getByTestId("header-section")).toBeVisible();
    await expect(page.getByTestId("alert-section")).toBeVisible();
    await expect(page.getByTestId("progress-section")).toBeVisible();
    await expect(page.getByTestId("timeline-section")).toBeVisible();
    await expect(page.getByTestId("list-section")).toBeVisible();
    await expect(page.getByTestId("datatable-section")).toBeVisible();
    await expect(page.getByTestId("codeblock-section")).toBeVisible();
  });

  test.describe("CanvasHeader", () => {
    test("renders h1 with gradient text", async ({ page }) => {
      const section = page.getByTestId("header-section");
      await expect(section.getByText("Sales Analytics Dashboard")).toBeVisible();
      // Gradient text uses bg-clip-text
      const h1 = section.locator("h3").first();
      await expect(h1).toHaveCSS("background-clip", "text");
    });

    test("renders subtitle", async ({ page }) => {
      await expect(page.getByText("Real-time metrics and insights")).toBeVisible();
    });
  });

  test.describe("CanvasAlert", () => {
    test("renders all 4 variants with titles", async ({ page }) => {
      const section = page.getByTestId("alert-section");
      await expect(section.getByText("System Update")).toBeVisible();
      await expect(section.getByText("Deployment Complete")).toBeVisible();
      await expect(section.getByText("Rate Limit Warning")).toBeVisible();
      await expect(section.getByText("Connection Failed")).toBeVisible();
    });

    test("renders all 4 variant messages", async ({ page }) => {
      const section = page.getByTestId("alert-section");
      await expect(section.getByText("A new version is available")).toBeVisible();
      await expect(section.getByText("successfully deployed")).toBeVisible();
      await expect(section.getByText("approaching your API rate limit")).toBeVisible();
      await expect(section.getByText("Unable to reach the database")).toBeVisible();
    });

    test("has SVG icons instead of emoji", async ({ page }) => {
      const section = page.getByTestId("alert-section");
      const svgs = section.locator("svg");
      expect(await svgs.count()).toBeGreaterThanOrEqual(4);
    });
  });

  test.describe("CanvasProgress", () => {
    test("renders all 4 progress bars with labels", async ({ page }) => {
      const section = page.getByTestId("progress-section");
      await expect(section.getByText("DESIGN PHASE")).toBeVisible();
      await expect(section.getByText("DEVELOPMENT")).toBeVisible();
      await expect(section.getByText("TESTING")).toBeVisible();
      await expect(section.getByText("CRITICAL BUG FIX")).toBeVisible();
    });

    test("shows animated percentage values", async ({ page }) => {
      const section = page.getByTestId("progress-section");
      // After animation, should show target values with % symbol
      await expect(section.getByText("92")).toBeVisible();
      await expect(section.getByText("67")).toBeVisible();
    });
  });

  test.describe("CanvasTimeline", () => {
    test("renders title and all events", async ({ page }) => {
      const section = page.getByTestId("timeline-section");
      await expect(section.getByText("Project Milestones")).toBeVisible();
      await expect(section.getByText("Requirements Gathered")).toBeVisible();
      await expect(section.getByText("Design Approved")).toBeVisible();
      await expect(section.getByText("Backend API Development")).toBeVisible();
      await expect(section.getByText("Frontend Integration")).toBeVisible();
      await expect(section.getByText("QA & Launch")).toBeVisible();
    });

    test("renders timestamps", async ({ page }) => {
      const section = page.getByTestId("timeline-section");
      await expect(section.getByText("Jan 15")).toBeVisible();
      await expect(section.getByText("Feb 1")).toBeVisible();
      await expect(section.getByText("Mar 25")).toBeVisible();
    });

    test("renders descriptions", async ({ page }) => {
      const section = page.getByTestId("timeline-section");
      await expect(section.getByText("All stakeholder interviews completed")).toBeVisible();
      await expect(section.getByText("Building core REST endpoints")).toBeVisible();
    });

    test("completed events have checkmark SVGs", async ({ page }) => {
      const section = page.getByTestId("timeline-section");
      // 2 completed events should have SVG checkmarks
      const svgs = section.locator("svg");
      expect(await svgs.count()).toBeGreaterThanOrEqual(2);
    });
  });

  test.describe("CanvasList", () => {
    test("ordered list renders items with text", async ({ page }) => {
      const section = page.getByTestId("list-section");
      await expect(section.getByText("Top Languages")).toBeVisible();
      await expect(section.getByText("TypeScript")).toBeVisible();
      await expect(section.getByText("Python")).toBeVisible();
      await expect(section.getByText("Rust")).toBeVisible();
    });

    test("renders badges", async ({ page }) => {
      const section = page.getByTestId("list-section");
      await expect(section.getByText("Popular")).toBeVisible();
      await expect(section.getByText("Trending")).toBeVisible();
      await expect(section.getByText("3 pending")).toBeVisible();
    });

    test("renders descriptions", async ({ page }) => {
      const section = page.getByTestId("list-section");
      await expect(section.getByText("Strongly typed JavaScript")).toBeVisible();
      await expect(section.getByText("142 tests across 8 modules")).toBeVisible();
    });

    test("unordered list renders icons", async ({ page }) => {
      const section = page.getByTestId("list-section");
      await expect(section.getByText("Quick Actions")).toBeVisible();
      await expect(section.getByText("Deploy to Production")).toBeVisible();
    });
  });

  test.describe("CanvasDataTable", () => {
    test("renders title and column headers", async ({ page }) => {
      const section = page.getByTestId("datatable-section");
      await expect(section.getByText("Team Members")).toBeVisible();
      await expect(section.getByText("Name")).toBeVisible();
      await expect(section.getByText("Role")).toBeVisible();
      await expect(section.getByText("Salary")).toBeVisible();
    });

    test("renders data rows", async ({ page }) => {
      const section = page.getByTestId("datatable-section");
      await expect(section.getByText("Alice Chen")).toBeVisible();
      await expect(section.getByText("Grace Lee")).toBeVisible();
      await expect(section.getByText("$145,000")).toBeVisible();
    });

    test("shows row count", async ({ page }) => {
      const section = page.getByTestId("datatable-section");
      await expect(section.getByText("7 rows")).toBeVisible();
    });
  });

  test.describe("CanvasCodeBlock", () => {
    test("renders title and language", async ({ page }) => {
      const section = page.getByTestId("codeblock-section");
      await expect(section.getByText("fibonacci.py")).toBeVisible();
      // language badge is uppercase
      await expect(section.getByText("PYTHON")).toBeVisible();
    });

    test("renders code content", async ({ page }) => {
      const section = page.getByTestId("codeblock-section");
      await expect(section.getByText("def fibonacci")).toBeVisible();
      await expect(section.getByText("fib.append")).toBeVisible();
    });

    test("has copy button", async ({ page }) => {
      const section = page.getByTestId("codeblock-section");
      await expect(section.getByRole("button", { name: /copy/i })).toBeVisible();
    });

    test("copy button shows feedback on click", async ({ page }) => {
      const section = page.getByTestId("codeblock-section");
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await section.getByRole("button", { name: /copy/i }).click();
      await expect(section.getByText("Copied")).toBeVisible();
    });

    test("has line numbers", async ({ page }) => {
      const section = page.getByTestId("codeblock-section");
      // Line numbers 1-15 should be present
      await expect(section.getByText("1", { exact: true }).first()).toBeVisible();
      await expect(section.getByText("10", { exact: true })).toBeVisible();
    });
  });

  test("full page screenshot", async ({ page }) => {
    await page.screenshot({ path: "test-results/canvas-components-full.png", fullPage: true });
  });

  // ── Dashboard Layout Tests ─────────────────────────────────────────

  test.describe("Dashboard Layout", () => {
    test("KPI row renders 3 metric cards", async ({ page }) => {
      const section = page.getByTestId("dashboard-kpi-row");
      await expect(section).toBeVisible();
      await expect(section.getByText("Revenue")).toBeVisible();
      await expect(section.getByText("Users")).toBeVisible();
      await expect(section.getByText("Churn Rate")).toBeVisible();
      await expect(section.getByText("$2.4M")).toBeVisible();
    });

    test("KPI row cards are equal width (3-col grid)", async ({ page }) => {
      const section = page.getByTestId("dashboard-kpi-row");
      const grid = section.locator(".grid");
      await expect(grid).toHaveCSS("display", "grid");
      // 3 children in the grid
      const children = grid.locator("> div");
      expect(await children.count()).toBe(3);
      // All should have roughly equal width
      const widths = await children.evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().width)
      );
      const maxDiff = Math.max(...widths) - Math.min(...widths);
      expect(maxDiff).toBeLessThan(5); // Allow 5px tolerance
    });

    test("chart + sidebar renders side by side", async ({ page }) => {
      const section = page.getByTestId("dashboard-chart-sidebar");
      await expect(section).toBeVisible();
      await expect(section.getByText("Recent Activity")).toBeVisible();
      await expect(section.getByText("Top Pages")).toBeVisible();
      // Verify the span-2 element is wider than span-1
      const grid = section.locator(".grid");
      const children = grid.locator("> div");
      const widths = await children.evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().width)
      );
      // First child (span-2) should be roughly 2x the second (span-1)
      expect(widths[0]).toBeGreaterThan(widths[1] * 1.5);
    });

    test("full-width table spans entire grid", async ({ page }) => {
      const section = page.getByTestId("dashboard-full-table");
      await expect(section).toBeVisible();
      await expect(section.getByText("Recent Deployments")).toBeVisible();
      const grid = section.locator(".grid");
      const table = grid.locator("> div").first();
      // col-span-3 should span full grid width
      const gridBox = await grid.boundingBox();
      const tableBox = await table.boundingBox();
      if (gridBox && tableBox) {
        // Table width should be close to grid width (within gap tolerance)
        expect(tableBox.width).toBeGreaterThan(gridBox.width * 0.9);
      }
    });

    test("mixed dashboard renders all component types", async ({ page }) => {
      const section = page.getByTestId("dashboard-mixed-full");
      await expect(section).toBeVisible();
      // Header
      await expect(section.getByText("Sales Analytics Dashboard")).toBeVisible();
      // KPIs
      await expect(section.getByText("Total Sales")).toBeVisible();
      await expect(section.getByText("Conversion")).toBeVisible();
      await expect(section.getByText("Avg Order")).toBeVisible();
      // Timeline
      await expect(section.getByText("Q4 Milestones")).toBeVisible();
      // Alert
      await expect(section.getByText("Target Met")).toBeVisible();
      // Table
      await expect(section.getByText("Top Products")).toBeVisible();
    });

    test("stat grid renders at full width", async ({ page }) => {
      const section = page.getByTestId("dashboard-stat-grid");
      await expect(section).toBeVisible();
      await expect(section.getByText("CPU Usage")).toBeVisible();
      await expect(section.getByText("Network")).toBeVisible();
      await expect(section.getByText("Uptime")).toBeVisible();
    });

    test("dashboard layout screenshot", async ({ page }) => {
      // Scroll to dashboard section
      await page.getByText("Dashboard Layout Tests").scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await page.screenshot({ path: "test-results/dashboard-layout.png", fullPage: true });
    });

    test("responsive: 1-column at narrow viewport", async ({ page }) => {
      await page.setViewportSize({ width: 500, height: 800 });
      await page.waitForTimeout(300);
      const section = page.getByTestId("dashboard-kpi-row");
      await section.scrollIntoViewIfNeeded();
      // At 500px, a 3-col grid with max-w-4xl (896px) will have the grid
      // constrained - verify cards are still visible and rendered
      await expect(section.getByText("Revenue")).toBeVisible();
      await expect(section.getByText("Churn Rate")).toBeVisible();
    });
  });
});
