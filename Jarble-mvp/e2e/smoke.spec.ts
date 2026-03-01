import { test, expect } from "@playwright/test";

test.describe("Smoke tests", () => {
  test("homepage loads and displays Jarble branding", async ({ page }) => {
    await page.goto("/");
    // The page title is set to "Jarble" via Next.js metadata
    await expect(page).toHaveTitle(/Jarble/);
    // The nav bar renders the Jarble heading
    await expect(page.locator("nav h1")).toHaveText("Jarble");
    // Core navigation links are visible
    await expect(page.getByRole("link", { name: "About" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pricing" })).toBeVisible();
  });

  test("login page loads and renders sign-in UI", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle(/Jarble/);
    // The login page shows a "Welcome back" heading
    await expect(page.locator("h1")).toContainText("Welcome back");
    // There is a sign-in prompt
    await expect(page.getByText("Sign in to your account to continue")).toBeVisible();
  });
});
