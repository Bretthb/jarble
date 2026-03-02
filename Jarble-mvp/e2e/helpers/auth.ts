import type { Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const STORAGE_STATE_PATH = path.join(__dirname, "..", ".auth", "storageState.json");

/**
 * Intercept Auth0 token refresh requests and return cached tokens.
 * This prevents refresh token rotation from invalidating the session.
 */
export async function setupAuthIntercept(page: Page) {
  const storageState = JSON.parse(fs.readFileSync(STORAGE_STATE_PATH, "utf-8"));
  const origin = storageState.origins?.[0];
  if (!origin) return;

  // Extract the cached token entry
  const tokenEntry = origin.localStorage.find((e: { name: string }) =>
    e.name.includes("@@auth0spajs@@") && !e.name.includes("@@user@@")
  );
  if (!tokenEntry) return;

  const cached = JSON.parse(tokenEntry.value);
  const body = cached.body;

  // Intercept Auth0 token endpoint to return our cached tokens
  await page.route("**/oauth/token", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: body.access_token,
        id_token: body.id_token,
        refresh_token: body.refresh_token,
        scope: body.scope,
        expires_in: body.expires_in || 86400,
        token_type: body.token_type || "Bearer",
      }),
    });
  });
}

/**
 * Wait for Auth0 to finish loading and the page to settle.
 * Checks that "Sign In" button in the main content area is NOT present
 * (indicating the user is authenticated).
 */
export async function waitForAuthReady(page: Page, timeout = 10_000) {
  // Wait for page to settle — Auth0 SDK needs time to restore from cache
  await page.waitForTimeout(3_000);

  // Check if we're on a "Please log in" page by looking for the Sign In button
  const loginBtn = page.getByRole("button", { name: "Sign In" });
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const isLoginVisible = await loginBtn.isVisible().catch(() => false);
    if (!isLoginVisible) return true;
    await page.waitForTimeout(500);
  }
  return false;
}
