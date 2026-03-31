/**
 * Auth setup - gets auth tokens for Playwright E2E tests.
 *
 * Two modes:
 *   1. ROPC (automatic): Set E2E_TEST_EMAIL + E2E_TEST_PASSWORD env vars
 *      - Uses Auth0 Resource Owner Password Grant to fetch tokens
 *      - Requires: Auth0 "Password" grant enabled, Default Directory set
 *
 *   2. Manual (fallback): Paste auth state from browser DevTools console
 *      - Log into localhost:3000, paste snippet in DevTools, paste output here
 *
 * Usage:
 *   npm run test:e2e:auth              # auto-detects mode
 *   E2E_TEST_EMAIL=x E2E_TEST_PASSWORD=y npm run test:e2e:auth  # force ROPC
 */
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { config } from "dotenv";

// Load env vars from .env.local (frontend Auth0 config) and .env.test (test creds)
config({ path: path.join(__dirname, "..", ".env.local") });
config({ path: path.join(__dirname, ".env.test") });

const AUTH_DIR = path.join(__dirname, ".auth");
const STORAGE_STATE_PATH = path.join(AUTH_DIR, "storageState.json");
const TEST_CONFIG_PATH = path.join(AUTH_DIR, "test-config.json");

// Auth0 config from frontend env
const AUTH0_DOMAIN = process.env.NEXT_PUBLIC_AUTH0_DOMAIN || "";
const AUTH0_CLIENT_ID = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID || "";
const AUTH0_AUDIENCE = process.env.NEXT_PUBLIC_AUTH0_AUDIENCE || "";

// Test user credentials
const TEST_EMAIL = process.env.E2E_TEST_EMAIL || "";
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD || "";

// ─── ROPC Mode ───────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  scope: string;
  expires_in: number;
  token_type: string;
}

interface IdTokenPayload {
  sub: string;
  email: string;
  name?: string;
  nickname?: string;
  picture?: string;
  email_verified?: boolean;
  [key: string]: unknown;
}

function decodeJwtPayload(token: string): IdTokenPayload {
  const payload = token.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
}

async function fetchTokensViaROPC(): Promise<TokenResponse> {
  const url = `https://${AUTH0_DOMAIN}/oauth/token`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "password",
      username: TEST_EMAIL,
      password: TEST_PASSWORD,
      client_id: AUTH0_CLIENT_ID,
      audience: AUTH0_AUDIENCE,
      scope: "openid profile email offline_access",
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `ROPC token request failed (${response.status}): ${JSON.stringify(error)}`,
    );
  }

  return response.json() as Promise<TokenResponse>;
}

function buildStorageState(tokens: TokenResponse) {
  const decoded = decodeJwtPayload(tokens.id_token);
  const scope = tokens.scope || "openid profile email offline_access";
  const expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;

  // Auth0 SPA SDK cache key format
  const cacheKey = `@@auth0spajs@@::${AUTH0_CLIENT_ID}::${AUTH0_AUDIENCE}::${scope}`;

  const cacheValue = JSON.stringify({
    body: {
      client_id: AUTH0_CLIENT_ID,
      access_token: tokens.access_token,
      id_token: tokens.id_token,
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      scope,
      expires_in: tokens.expires_in,
      token_type: tokens.token_type,
      decodedToken: {
        user: decoded,
        claims: decoded,
      },
      audience: AUTH0_AUDIENCE,
    },
    expiresAt,
  });

  // User profile cache key
  const userKey = `@@auth0spajs@@::${AUTH0_CLIENT_ID}::@@user@@`;
  const userValue = JSON.stringify({
    decodedToken: {
      user: decoded,
      claims: decoded,
    },
  });

  // Auth0 SPA SDK v2 checks this cookie before restoring from localStorage
  const authCookieName = `auth0.${AUTH0_CLIENT_ID}.is.authenticated`;

  return {
    cookies: [
      {
        name: authCookieName,
        value: "true",
        domain: "localhost",
        path: "/",
        expires: expiresAt,
        httpOnly: false,
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [
      {
        origin: "http://localhost:3000",
        localStorage: [
          { name: cacheKey, value: cacheValue },
          { name: userKey, value: userValue },
        ],
      },
    ],
  };
}

// ─── Manual Mode (fallback) ──────────────────────────────────────────

const CONSOLE_SNIPPET = `
// Copy this entire block and paste into DevTools console on localhost:3000
(function() {
  const state = {
    cookies: [],
    origins: [{
      origin: window.location.origin,
      localStorage: Object.entries(localStorage).map(([name, value]) => ({ name, value }))
    }]
  };
  document.cookie.split(';').forEach(c => {
    const [name, ...rest] = c.trim().split('=');
    if (name) state.cookies.push({
      name: name.trim(),
      value: rest.join('='),
      domain: 'localhost',
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax'
    });
  });
  const json = JSON.stringify(state);
  copy(json);
  console.log('Copied to clipboard! Paste it back in the terminal.');
  return json.substring(0, 80) + '...';
})();
`.trim();

async function manualAuthSetup(): Promise<{
  cookies: unknown[];
  origins: unknown[];
}> {
  console.log("\n=== Manual Auth Setup (fallback) ===\n");
  console.log("1. Log into http://localhost:3000 in your normal browser");
  console.log("2. Open DevTools console (F12) on localhost:3000");
  console.log("3. Paste this snippet:\n");
  console.log("\u2500".repeat(60));
  console.log(CONSOLE_SNIPPET);
  console.log("\u2500".repeat(60));
  console.log("\n4. It will copy the auth state to your clipboard.");
  console.log("5. Paste it below and press Enter:\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) => {
    rl.question("> ", (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });

  if (!answer) {
    throw new Error("No input received.");
  }

  const state = JSON.parse(answer);
  if (!state.origins || !Array.isArray(state.origins)) {
    throw new Error("Invalid JSON - missing origins array.");
  }
  return state;
}

// ─── Deployment Discovery ────────────────────────────────────────────

async function seedAndFetchDeploymentId(accessToken: string): Promise<string> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
  try {
    // Seed a deployment for the authenticated user
    const seedRes = await fetch(`${apiUrl}/debug/seed-deployment`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    if (seedRes.ok) {
      const data = await seedRes.json();
      if (data?.deployment?.id) {
        console.log(`Seeded deployment: ${data.deployment.id} (${data.message})`);
        return data.deployment.id;
      }
    }

    // Fallback: try debug/db
    const response = await fetch(`${apiUrl}/debug/db`);
    const data = await response.json();
    const deployments = data?.tables?.deployments?.data ?? data?.deployments ?? [];
    if (Array.isArray(deployments) && deployments.length > 0) {
      return (deployments[0] as Record<string, string>).id;
    }
  } catch {
    console.warn("Could not seed/fetch deployment (is the API running on :3001?)");
  }
  return "";
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const canROPC = TEST_EMAIL && TEST_PASSWORD && AUTH0_DOMAIN && AUTH0_CLIENT_ID;

  let storageState: { cookies: unknown[]; origins: unknown[] };
  let accessToken = "";

  if (canROPC) {
    console.log("=== Auth0 ROPC Auth Setup ===\n");
    console.log(`Domain:    ${AUTH0_DOMAIN}`);
    console.log(`Client ID: ${AUTH0_CLIENT_ID.slice(0, 8)}...`);
    console.log(`Audience:  ${AUTH0_AUDIENCE}`);
    console.log(`Test user: ${TEST_EMAIL}\n`);

    console.log("Fetching tokens via Resource Owner Password Grant...");
    const tokens = await fetchTokensViaROPC();
    const decoded = decodeJwtPayload(tokens.id_token);
    console.log(`Token acquired for: ${decoded.email} (${decoded.sub})`);
    console.log(`Expires in: ${tokens.expires_in}s`);
    console.log(`Refresh token: ${tokens.refresh_token ? "yes" : "no"}`);

    accessToken = tokens.access_token;
    storageState = buildStorageState(tokens);
    console.log("Built Playwright storageState with Auth0 SPA SDK cache format.");
  } else {
    if (!canROPC) {
      console.log("ROPC not configured (missing E2E_TEST_EMAIL/E2E_TEST_PASSWORD).");
      console.log(
        "Set these in e2e/.env.test or as env vars for automatic auth.\n",
      );
    }
    storageState = await manualAuthSetup();
  }

  // Save storageState
  fs.writeFileSync(STORAGE_STATE_PATH, JSON.stringify(storageState, null, 2));
  console.log(`\nSaved storageState to ${STORAGE_STATE_PATH}`);

  // Seed and discover deployment ID
  const deploymentId = await seedAndFetchDeploymentId(accessToken);
  fs.writeFileSync(
    TEST_CONFIG_PATH,
    JSON.stringify({ deploymentId }, null, 2),
  );
  if (deploymentId) {
    console.log(`Found deployment ID: ${deploymentId}`);
  } else {
    console.warn("No deployment found - chat tests will be skipped.");
  }

  console.log("\nAuth setup complete! Run tests with: npm run test:e2e");
}

main().catch((err) => {
  console.error("Auth setup failed:", err.message);
  process.exit(1);
});
