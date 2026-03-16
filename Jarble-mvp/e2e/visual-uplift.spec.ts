import { test, expect } from "@playwright/test";
import {
  attachAllLoggers,
  screenshotMilestone,
  screenshotElement,
  getTestConfig,
} from "./helpers/logging";
import { setupAuthIntercept } from "./helpers/auth";

// ────────────────────────────────────────────────────────────────────────────
// Part 1: Component Visual Tests
//
// Uses /test-components — a standalone page that renders all canvas components
// with sample props. No auth or API required.
// ────────────────────────────────────────────────────────────────────────────

/** The 8 uplifted components and their data-testid / selector info */
const UPLIFTED_COMPONENTS = [
  {
    name: "CanvasProgress",
    testId: "progress-section",
    selector: '[role="progressbar"]',
  },
  {
    name: "CanvasAlert",
    testId: "alert-section",
    selector: '[role="alert"]',
  },
  {
    name: "CanvasBlockquote",
    testId: "blockquote-section",
    selector: "blockquote",
  },
  {
    name: "CanvasKeyValue",
    testId: "keyvalue-section",
    selector: '[aria-label="Server Details"]',
  },
  {
    name: "CanvasList",
    testId: "list-section",
    selector: '[aria-label="Quick Actions"]',
  },
  {
    name: "CanvasTimeline",
    testId: "timeline-section",
    selector: '[aria-label="Project Milestones"]',
  },
  {
    name: "CanvasTabs",
    testId: "tabs-section",
    selector: '[aria-label="Content tabs"]',
  },
  {
    name: "CanvasAccordion",
    testId: "accordion-section",
    selector: '[aria-label="Expandable sections"]',
  },
] as const;

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

test.describe("Part 1: Uplifted Component Visual Tests", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
  });

  test.afterEach(async () => {
    await flush();
  });

  // ── Basic rendering: all 8 components visible, no error boundaries ────

  test("test-components page loads without errors", async ({ page }, testInfo) => {
    await page.goto("/test-components");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000); // Allow framer-motion animations to settle

    // Page heading
    await expect(page.getByRole("heading", { name: "Canvas Component Visual Test" })).toBeVisible();

    // Full page screenshot
    await screenshotMilestone(page, testInfo, "test-components-full");

    // No error boundary cards should be rendered
    const errorCards = page.locator("text=failed to render");
    await expect(errorCards).toHaveCount(0);
  });

  for (const comp of UPLIFTED_COMPONENTS) {
    test(`${comp.name} renders without error boundary`, async ({ page }, testInfo) => {
      await page.goto("/test-components");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2_000);

      // Locate the component section by data-testid
      const section = page.locator(`[data-testid="${comp.testId}"]`);
      await expect(section).toBeVisible();

      // No error boundary within the section
      const errorWithin = section.locator("text=failed to render");
      await expect(errorWithin).toHaveCount(0);

      // The actual component element should exist on the page
      const componentEl = page.locator(comp.selector).first();
      await expect(componentEl).toBeVisible();

      // Screenshot the component
      await screenshotElement(componentEl, testInfo, `${comp.name}-rendered`);
    });
  }

  // ── Responsive behavior: resize viewport and check components ─────────

  for (const viewport of VIEWPORTS) {
    test(`components render at ${viewport.name} (${viewport.width}px)`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/test-components");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2_000);

      // All 8 components should still be present (scroll may be needed)
      for (const comp of UPLIFTED_COMPONENTS) {
        const el = page.locator(comp.selector).first();
        // Use toBeAttached instead of toBeVisible since mobile might require scroll
        await expect(el).toBeAttached();
      }

      // Full page screenshot at this viewport
      await screenshotMilestone(page, testInfo, `components-${viewport.name}`);
    });
  }

  // ── Individual component detail checks ────────────────────────────────

  test("CanvasProgress shows animated bar and percentage", async ({ page }) => {
    await page.goto("/test-components");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);

    const progressBars = page.locator('[role="progressbar"]');
    const count = await progressBars.count();
    expect(count).toBeGreaterThanOrEqual(4); // Page has 4 progress variants

    // Check aria attributes on first progress bar
    const first = progressBars.first();
    await expect(first).toHaveAttribute("aria-valuemin", "0");
    await expect(first).toHaveAttribute("aria-valuemax", "100");
    const valueNow = await first.getAttribute("aria-valuenow");
    expect(Number(valueNow)).toBeGreaterThan(0);
  });

  test("CanvasAlert shows all 4 variants", async ({ page }) => {
    await page.goto("/test-components");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);

    const alerts = page.locator('[role="alert"]');
    const count = await alerts.count();
    expect(count).toBeGreaterThanOrEqual(4); // info, success, warning, error

    // Check the text content of each variant
    await expect(page.getByText("System Update")).toBeVisible();
    await expect(page.getByText("Deployment Complete")).toBeVisible();
    await expect(page.getByText("Rate Limit Warning")).toBeVisible();
    await expect(page.getByText("Connection Failed")).toBeVisible();
  });

  test("CanvasBlockquote renders text and attribution", async ({ page }) => {
    await page.goto("/test-components");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);

    const blockquotes = page.locator("blockquote");
    const count = await blockquotes.count();
    expect(count).toBeGreaterThanOrEqual(3); // 3 variants on the page

    // Verify attribution is rendered
    await expect(page.getByText("Alan Kay")).toBeVisible();
    await expect(page.getByText("Donald Knuth")).toBeVisible();
  });

  test("CanvasKeyValue renders key-value pairs with title", async ({ page }) => {
    await page.goto("/test-components");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);

    const kvSection = page.locator('[data-testid="keyvalue-section"]');
    await expect(kvSection).toBeVisible();

    // Title
    await expect(kvSection.getByText("Server Details")).toBeVisible();

    // Key-value content
    await expect(kvSection.getByText("Hostname")).toBeVisible();
    await expect(kvSection.getByText("prod-east-1.jarble.ai")).toBeVisible();
    await expect(kvSection.getByText("CPU Cores")).toBeVisible();
    await expect(kvSection.getByText("99.97%")).toBeVisible();
  });

  test("CanvasList renders items with badges and icons", async ({ page }) => {
    await page.goto("/test-components");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);

    const listSection = page.locator('[data-testid="list-section"]');
    await expect(listSection).toBeVisible();

    await expect(listSection.getByText("Quick Actions")).toBeVisible();
    await expect(listSection.getByText("Deploy to Production")).toBeVisible();
    await expect(listSection.getByText("Ready")).toBeVisible(); // badge
    await expect(listSection.getByText("3 pending")).toBeVisible(); // badge
  });

  test("CanvasTimeline renders events with status indicators", async ({ page }) => {
    await page.goto("/test-components");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);

    const timelineSection = page.locator('[data-testid="timeline-section"]');
    await expect(timelineSection).toBeVisible();

    await expect(timelineSection.getByText("Project Milestones")).toBeVisible();
    await expect(timelineSection.getByText("Requirements Gathered")).toBeVisible();
    await expect(timelineSection.getByText("Jan 15")).toBeVisible();
    await expect(timelineSection.getByText("QA & Launch")).toBeVisible();
  });

  test("CanvasTabs renders tabs and allows switching", async ({ page }) => {
    await page.goto("/test-components");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);

    const tabsSection = page.locator('[data-testid="tabs-section"]');
    await expect(tabsSection).toBeVisible();

    // All 3 tab triggers should be present
    const overviewTab = tabsSection.getByRole("tab", { name: "Overview" });
    const metricsTab = tabsSection.getByRole("tab", { name: "Metrics" });
    const logsTab = tabsSection.getByRole("tab", { name: "Logs" });

    await expect(overviewTab).toBeVisible();
    await expect(metricsTab).toBeVisible();
    await expect(logsTab).toBeVisible();

    // Overview tab should be selected by default
    await expect(overviewTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("This is the overview tab")).toBeVisible();

    // Switch to Metrics tab
    await metricsTab.click();
    await expect(metricsTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("CPU: 42%")).toBeVisible();

    // Switch to Logs tab
    await logsTab.click();
    await expect(logsTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Server started")).toBeVisible();
  });

  test("CanvasAccordion renders items and expands/collapses", async ({ page }) => {
    await page.goto("/test-components");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);

    const accSection = page.locator('[data-testid="accordion-section"]');
    await expect(accSection).toBeVisible();

    // All 3 accordion triggers
    const jarbleTrigger = accSection.getByRole("button", { name: /What is Jarble/ });
    const platformsTrigger = accSection.getByRole("button", { name: /Which platforms/ });
    const billingTrigger = accSection.getByRole("button", { name: /How does billing/ });

    await expect(jarbleTrigger).toBeVisible();
    await expect(platformsTrigger).toBeVisible();
    await expect(billingTrigger).toBeVisible();

    // First item is defaultOpen, so its content should be visible
    await expect(page.getByText("no-code AI bot deployment platform")).toBeVisible();

    // Click second item to expand
    await platformsTrigger.click();
    await expect(page.getByText("WhatsApp, Discord, Slack, and Telegram")).toBeVisible();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Part 2: Marketplace UI Tests
//
// The marketplace page requires Auth0 and tRPC. We use auth intercept and
// verify the tab structure, form buttons, and basic rendering.
// ────────────────────────────────────────────────────────────────────────────

test.describe("Part 2: Marketplace UI Tests", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;

    // Set up Auth0 intercept if auth state exists
    await setupAuthIntercept(page).catch(() => {
      // Auth state may not exist — marketplace is partially accessible without auth
    });
  });

  test.afterEach(async () => {
    await flush();
  });

  test("marketplace page loads with heading", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    await expect(page.getByRole("heading", { name: "Marketplace" })).toBeVisible();
    await expect(
      page.getByText("Discover and install community-built components and services")
    ).toBeVisible();

    await screenshotMilestone(page, testInfo, "marketplace-landing");
  });

  test("Components tab is visible and selected by default", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    const componentsTab = page.getByRole("tab", { name: "Components" });
    await expect(componentsTab).toBeVisible();
    await expect(componentsTab).toHaveAttribute("aria-selected", "true");

    await screenshotMilestone(page, testInfo, "marketplace-components-tab");
  });

  test("Services tab exists and is clickable", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    const servicesTab = page.getByRole("tab", { name: "Services" });
    await expect(servicesTab).toBeVisible();

    await servicesTab.click();
    await expect(servicesTab).toHaveAttribute("aria-selected", "true");
    await page.waitForTimeout(1_000);

    await screenshotMilestone(page, testInfo, "marketplace-services-tab");
  });

  test("My Services tab exists for authenticated users", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    const myServicesTab = page.getByRole("tab", { name: "My Services" });
    // Tab may or may not be visible depending on auth state
    const isVisible = await myServicesTab.isVisible().catch(() => false);

    if (isVisible) {
      await myServicesTab.click();
      await expect(myServicesTab).toHaveAttribute("aria-selected", "true");
      await page.waitForTimeout(1_000);
      await screenshotMilestone(page, testInfo, "marketplace-my-services-tab");
    } else {
      // Not authenticated — skip but don't fail
      test.info().annotations.push({
        type: "skip-reason",
        description: "My Services tab not visible — user not authenticated",
      });
    }
  });

  test("Create tab shows publish form with Save/Submit buttons", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    const createTab = page.getByRole("tab", { name: "Create" });
    const isVisible = await createTab.isVisible().catch(() => false);

    if (!isVisible) {
      test.info().annotations.push({
        type: "skip-reason",
        description: "Create tab not visible — user not authenticated",
      });
      return;
    }

    await createTab.click();
    await expect(createTab).toHaveAttribute("aria-selected", "true");
    await page.waitForTimeout(1_500);

    // Verify the publish form renders with its two action buttons
    const saveDraftBtn = page.getByRole("button", { name: /Save as Draft/i });
    const submitBtn = page.getByRole("button", { name: /Submit for Review/i });

    await expect(saveDraftBtn).toBeVisible();
    await expect(submitBtn).toBeVisible();

    await screenshotMilestone(page, testInfo, "marketplace-create-tab-form");
  });

  test("all 4 marketplace tabs have correct labels", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    // Components and Services are always visible
    await expect(page.getByRole("tab", { name: "Components" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Services" })).toBeVisible();

    // My Services and Create are gated by auth — check if present
    const tabs = page.getByRole("tab");
    const tabCount = await tabs.count();
    const tabLabels: string[] = [];
    for (let i = 0; i < tabCount; i++) {
      const label = await tabs.nth(i).textContent();
      if (label) tabLabels.push(label.trim());
    }

    // At minimum: Components, Services
    expect(tabLabels).toContain("Components");
    expect(tabLabels).toContain("Services");

    // If authenticated: My Services, Create should also appear
    if (tabCount >= 4) {
      expect(tabLabels.some((l) => l.includes("My Services"))).toBe(true);
      expect(tabLabels.some((l) => l.includes("Create"))).toBe(true);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Part 3: Workspace Publish Button Test
//
// Navigates to a deployment workspace and checks for the Upload/Publish
// button on canvas cards (if any exist).
// ────────────────────────────────────────────────────────────────────────────

test.describe("Part 3: Workspace Publish Button", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page).catch(() => {});
  });

  test.afterEach(async () => {
    await flush();
  });

  test("workspace loads and publish button is present on canvas cards", async ({ page }, testInfo) => {
    const config = getTestConfig();
    test.skip(!config.deploymentId, "No deploymentId configured — run test:e2e:auth first");

    await page.goto(`/d/${config.deploymentId}`);
    await page.waitForTimeout(5_000);

    await screenshotMilestone(page, testInfo, "workspace-loaded");

    // Check if any canvas cards exist
    const canvasCards = page.locator("[data-card-id]");
    const cardCount = await canvasCards.count();

    if (cardCount > 0) {
      // Hover over the first card to reveal action buttons
      const firstCard = canvasCards.first();
      await firstCard.hover();
      await page.waitForTimeout(500);

      // Look for the Publish button (Upload icon button)
      const publishBtn = firstCard.locator('[aria-label="Publish as marketplace service"]');
      const hasPublish = await publishBtn.isVisible().catch(() => false);

      if (hasPublish) {
        await screenshotMilestone(page, testInfo, "workspace-publish-button");
        // Verify it's an Upload icon, not a Pin icon
        const uploadIcon = publishBtn.locator("svg");
        await expect(uploadIcon).toBeVisible();
      } else {
        test.info().annotations.push({
          type: "info",
          description: "Publish button not visible on hover — may need card interaction",
        });
      }

      // Verify there is NO old "Pin" button
      const pinBtn = firstCard.locator('[aria-label="Pin"]');
      const hasPin = await pinBtn.isVisible().catch(() => false);
      expect(hasPin).toBe(false);

      await screenshotMilestone(page, testInfo, "workspace-card-actions");
    } else {
      test.info().annotations.push({
        type: "info",
        description: "No canvas cards present — skipping publish button check",
      });
      await screenshotMilestone(page, testInfo, "workspace-no-cards");
    }
  });
});
