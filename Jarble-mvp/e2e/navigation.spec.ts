import { test, expect } from "@playwright/test";
import { attachAllLoggers, screenshotMilestone } from "./helpers/logging";
import { setupAuthIntercept, waitForAuthReady } from "./helpers/auth";

// Known deployment IDs for deep-link tests
const DEPLOYMENT_ID = "3vt3ej3hj1oi";

// ─── Authenticated navigation ───────────────────────────────────────────────

test.describe("Navigation — Authenticated", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  // ── Homepage navbar ─────────────────────────────────────────────────────

  test("homepage nav renders all expected links for authenticated user", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.waitForTimeout(3_000);

    const nav = page.locator("nav");

    // Logo text is visible
    await expect(nav.locator("h1")).toHaveText("Jarble");

    // Public links (use .first() since About/Pricing may appear in footer too)
    await expect(page.getByRole("link", { name: "About" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Pricing" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Marketplace" }).first()).toBeVisible();

    // Authenticated-only link
    await expect(page.getByRole("link", { name: "Dashboard" }).first()).toBeVisible();

    // Profile avatar/dropdown trigger should be visible (no "Sign in" button)
    const signInBtn = page.getByRole("button", { name: /sign in/i });
    await expect(signInBtn).not.toBeVisible();

    await screenshotMilestone(page, testInfo, "nav-authenticated-homepage");
  });

  // ── Logo click → home ──────────────────────────────────────────────────

  test("clicking Jarble logo from pricing page navigates home", async ({ page }) => {
    await page.goto("/pricing");
    await page.waitForTimeout(3_000);

    const logoLink = page.locator("nav").getByRole("link", { name: "Jarble" });
    await logoLink.click();

    await expect(page).toHaveURL("/");
  });

  test("clicking Jarble logo from dashboard navigates home", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(3_000);

    const logoLink = page.locator("nav").getByRole("link", { name: "Jarble" });
    await logoLink.click();

    await expect(page).toHaveURL("/");
  });

  // ── Page-to-page navigation ────────────────────────────────────────────

  test("navigate from homepage to pricing via nav link", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3_000);

    await page.getByRole("link", { name: "Pricing" }).first().click();
    await expect(page).toHaveURL("/pricing");
    await expect(page).toHaveTitle(/Jarble/);
  });

  test("navigate from homepage to marketplace via nav link", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3_000);

    await page.getByRole("link", { name: "Marketplace" }).first().click();
    await expect(page).toHaveURL("/marketplace");
    await expect(page).toHaveTitle(/Jarble/);
  });

  test("navigate from homepage to dashboard via nav link", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3_000);

    await page.getByRole("link", { name: "Dashboard" }).first().click();
    await expect(page).toHaveURL("/dashboard");
    await expect(page).toHaveTitle(/Jarble/);
  });

  test("navigate from pricing to home via nav link", async ({ page }) => {
    await page.goto("/pricing");
    await page.waitForTimeout(3_000);

    // Pricing page nav has Home, About, Pricing links (no Marketplace)
    await page.getByRole("link", { name: "Home" }).first().click();
    await expect(page).toHaveURL("/");
  });

  test("navigate from marketplace to home via nav link", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    // Marketplace page has its own nav — navigate home via Jarble logo
    const logoLink = page.locator("nav").getByRole("link", { name: "Jarble" });
    await logoLink.click();
    await expect(page).toHaveURL("/");
  });

  // ── Profile dropdown menu ──────────────────────────────────────────────

  test("profile dropdown opens and shows menu items", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.waitForTimeout(3_000);

    // Click the avatar trigger (it's a button containing an Avatar)
    const avatarButton = page.locator("nav button").filter({ has: page.locator("img, span") }).last();
    await avatarButton.click();

    // Dropdown menu items should be visible
    await expect(page.getByRole("menuitem", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Linked Deployments" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Marketplace" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Usage Analytics" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Billing" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Profile Settings" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Log Out" })).toBeVisible();

    await screenshotMilestone(page, testInfo, "nav-profile-dropdown-open");
  });

  test("profile dropdown navigates to dashboard", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3_000);

    const avatarButton = page.locator("nav button").filter({ has: page.locator("img, span") }).last();
    await avatarButton.click();

    await page.getByRole("menuitem", { name: "Dashboard" }).click();
    await expect(page).toHaveURL("/dashboard");
  });

  test("profile dropdown navigates to linked deployments", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3_000);

    const avatarButton = page.locator("nav button").filter({ has: page.locator("img, span") }).last();
    await avatarButton.click();

    await page.getByRole("menuitem", { name: "Linked Deployments" }).click();
    await expect(page).toHaveURL("/deployments");
  });

  test("profile dropdown navigates to marketplace", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3_000);

    const avatarButton = page.locator("nav button").filter({ has: page.locator("img, span") }).last();
    await avatarButton.click();

    await page.getByRole("menuitem", { name: "Marketplace" }).click();
    await expect(page).toHaveURL("/marketplace");
  });

  // ── Active link highlighting ───────────────────────────────────────────

  test("marketplace nav link has active styling when on /marketplace", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    const marketplaceLink = page.locator("nav").getByRole("link", { name: "Marketplace" });
    await expect(marketplaceLink).toBeVisible();
    // Active link uses text-primary (not text-muted-foreground)
    await expect(marketplaceLink).toHaveClass(/text-primary/);
  });

  // ── Deep linking ───────────────────────────────────────────────────────

  test("direct URL access to /dashboard loads correctly", async ({ page }, testInfo) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(5_000);

    await expect(page).toHaveTitle(/Jarble/);
    // Dashboard should not show Sign In button for authenticated user
    const signInBtn = page.getByRole("button", { name: /sign in/i });
    await expect(signInBtn).not.toBeVisible();

    await screenshotMilestone(page, testInfo, "nav-deep-link-dashboard");
  });

  test("direct URL access to /marketplace loads correctly", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    await expect(page).toHaveTitle(/Jarble/);
    await expect(page.getByText("Marketplace").first()).toBeVisible();
  });

  test("direct URL access to /deployments loads correctly", async ({ page }) => {
    await page.goto("/deployments");
    await page.waitForTimeout(5_000);

    await expect(page).toHaveTitle(/Jarble/);
  });

  test("direct URL access to /pricing loads correctly", async ({ page }) => {
    await page.goto("/pricing");
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveTitle(/Jarble/);
  });

  test("direct URL access to deployment chat /d/[id]", async ({ page }, testInfo) => {
    await page.goto(`/d/${DEPLOYMENT_ID}`);
    await page.waitForTimeout(5_000);

    await expect(page).toHaveTitle(/Jarble/);
    // Should not be redirected to /login
    await expect(page).not.toHaveURL(/\/login/);

    await screenshotMilestone(page, testInfo, "nav-deep-link-deployment-chat");
  });

  // ── Back button (browser history) ──────────────────────────────────────

  test("browser back button returns to previous page", async ({ page }) => {
    // Start at homepage
    await page.goto("/");
    await page.waitForTimeout(3_000);

    // Navigate to marketplace
    await page.getByRole("link", { name: "Marketplace" }).first().click();
    await expect(page).toHaveURL("/marketplace");

    // Navigate to dashboard
    await page.getByRole("link", { name: "Dashboard" }).first().click();
    await expect(page).toHaveURL("/dashboard");

    // Go back — should return to marketplace
    await page.goBack();
    await expect(page).toHaveURL("/marketplace");

    // Go back again — should return to homepage
    await page.goBack();
    await expect(page).toHaveURL("/");
  });

  // ── Auth state persistence ─────────────────────────────────────────────

  test("auth state persists across page navigations", async ({ page }) => {
    // Load dashboard (auth-protected)
    await page.goto("/dashboard");
    await page.waitForTimeout(5_000);

    // Verify authenticated (no sign-in button)
    const signInBtn = page.getByRole("button", { name: /sign in/i });
    await expect(signInBtn).not.toBeVisible();

    // Navigate to marketplace
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    // Still authenticated — Dashboard link should be visible in nav
    await expect(page.getByRole("link", { name: "Dashboard" }).first()).toBeVisible();

    // Navigate to pricing
    await page.goto("/pricing");
    await page.waitForTimeout(3_000);

    // Still authenticated — Dashboard button should be visible (pricing page uses Button, not Link)
    await expect(page.getByRole("button", { name: "Dashboard" })).toBeVisible();
  });
});

// ─── Unauthenticated navigation ─────────────────────────────────────────────

test.describe("Navigation — Unauthenticated", () => {
  let flush: () => Promise<void>;

  // Override storage state to clear auth for this group
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
  });

  test.afterEach(async () => {
    await flush();
  });

  test("homepage shows Sign in button when not authenticated", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.waitForTimeout(3_000);

    // Sign in button should be visible
    const signInBtn = page.getByRole("button", { name: /sign in/i });
    await expect(signInBtn).toBeVisible();

    // Dashboard link should NOT be visible in nav (auth-only)
    const dashboardLink = page.locator("nav").getByRole("link", { name: "Dashboard" });
    await expect(dashboardLink).not.toBeVisible();

    await screenshotMilestone(page, testInfo, "nav-unauthenticated-homepage");
  });

  test("public pages accessible without auth: homepage", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3_000);
    await expect(page).toHaveTitle(/Jarble/);
    await expect(page.locator("nav h1")).toHaveText("Jarble");
  });

  test("public pages accessible without auth: pricing", async ({ page }) => {
    await page.goto("/pricing");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveTitle(/Jarble/);
  });

  test("public pages accessible without auth: marketplace", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);
    await expect(page).toHaveTitle(/Jarble/);
    await expect(page.getByText("Marketplace").first()).toBeVisible();
  });

  test("marketplace does not show Publish tab when unauthenticated", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    // Components and Services tabs should exist
    await expect(page.getByRole("tab", { name: "Components" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Services" })).toBeVisible();

    // Publish tab should NOT be visible
    const publishTab = page.getByRole("tab", { name: "Publish" });
    await expect(publishTab).not.toBeVisible();
  });

  test("protected route /d/[id] redirects to /login when unauthenticated", async ({ page }) => {
    await page.goto(`/d/${DEPLOYMENT_ID}`);
    // The page uses useEffect to redirect to /login when not authenticated
    await page.waitForURL("**/login", { timeout: 15_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("login page loads and shows sign-in UI", async ({ page }, testInfo) => {
    await page.goto("/login");
    await page.waitForTimeout(3_000);

    await expect(page).toHaveTitle(/Jarble/);
    await expect(page.locator("h1")).toContainText("Welcome back");
    await expect(page.getByText("Sign in to your account to continue")).toBeVisible();

    await screenshotMilestone(page, testInfo, "nav-login-page");
  });
});

// ─── 404 Not Found ──────────────────────────────────────────────────────────

test.describe("Navigation — 404 Not Found", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  test("invalid route shows 404 page", async ({ page }, testInfo) => {
    await page.goto("/this-route-does-not-exist");
    await page.waitForTimeout(3_000);

    // 404 page shows "404" heading and "Page Not Found" text
    await expect(page.getByText("404")).toBeVisible();
    await expect(page.getByText("Page Not Found")).toBeVisible();
    await expect(page.getByText("Sorry, the page you are looking for")).toBeVisible();

    await screenshotMilestone(page, testInfo, "nav-404-page");
  });

  test("404 page Go Home button navigates to homepage", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    await page.waitForTimeout(3_000);

    const goHomeButton = page.getByRole("button", { name: "Go Home" });
    await expect(goHomeButton).toBeVisible();

    await goHomeButton.click();
    await expect(page).toHaveURL("/");
  });

  test("deeply nested invalid route shows 404", async ({ page }) => {
    await page.goto("/foo/bar/baz/nonexistent");
    await page.waitForTimeout(3_000);

    await expect(page.getByText("404")).toBeVisible();
    await expect(page.getByText("Page Not Found")).toBeVisible();
  });
});

// ─── Cross-page nav consistency ─────────────────────────────────────────────

test.describe("Navigation — Consistency across pages", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  test("nav bar is present on all main pages", async ({ page }, testInfo) => {
    // Pages with h1 "Jarble" in nav
    const pagesWithH1 = ["/", "/pricing", "/marketplace"];
    // Dashboard has a nav but no h1 logo
    const pagesNavOnly = ["/dashboard"];

    for (const url of pagesWithH1) {
      await page.goto(url);
      await page.waitForTimeout(3_000);

      const nav = page.locator("nav").first();
      await expect(nav).toBeVisible();
      await expect(nav.locator("h1")).toHaveText("Jarble");
    }

    for (const url of pagesNavOnly) {
      await page.goto(url);
      await page.waitForTimeout(3_000);

      const nav = page.locator("nav").first();
      await expect(nav).toBeVisible();
    }

    await screenshotMilestone(page, testInfo, "nav-consistency-check");
  });

  test("deployment chat page has back button and header", async ({ page }, testInfo) => {
    await page.goto(`/d/${DEPLOYMENT_ID}`);
    await page.waitForTimeout(5_000);

    // Chat page has a header with back button (ArrowLeft icon)
    const header = page.locator("header");
    await expect(header).toBeVisible();

    // Back button (link or button with ArrowLeft) should be present
    const backButton = page.locator("header").getByRole("button").first();
    await expect(backButton).toBeVisible();

    await screenshotMilestone(page, testInfo, "nav-deployment-chat-header");
  });
});
