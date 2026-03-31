/**
 * Auth0 tenant setup for E2E testing.
 *
 * Automates the Auth0 Dashboard steps via the Management API:
 *   1. Ensures "Username-Password-Authentication" database connection exists
 *   2. Enables it on the SPA application
 *   3. Enables Password grant type on the SPA
 *   4. Sets Default Directory on the tenant
 *   5. Creates a test user
 *   6. Writes credentials to e2e/.env.test
 *
 * Usage:
 *   AUTH0_MGMT_CLIENT_ID=xxx AUTH0_MGMT_CLIENT_SECRET=yyy npx tsx e2e/auth0-setup.ts
 *
 * To get M2M credentials:
 *   Auth0 Dashboard → Applications → API Explorer Application → copy Client ID & Secret
 *   (or create a new M2M app with "Auth0 Management API" authorized)
 */
import * as fs from "fs";
import * as path from "path";
import { config } from "dotenv";
import { randomBytes } from "crypto";

config({ path: path.join(__dirname, "..", ".env.local") });

const AUTH0_DOMAIN = process.env.NEXT_PUBLIC_AUTH0_DOMAIN || "";
const SPA_CLIENT_ID = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID || "";
const AUTH0_AUDIENCE = process.env.NEXT_PUBLIC_AUTH0_AUDIENCE || "";
const MGMT_CLIENT_ID = process.env.AUTH0_MGMT_CLIENT_ID || "";
const MGMT_CLIENT_SECRET = process.env.AUTH0_MGMT_CLIENT_SECRET || "";

const DB_CONNECTION_NAME = "Username-Password-Authentication";
const TEST_EMAIL = "e2e-test@jarble.ai";
const TEST_PASSWORD = `E2e-Test-${randomBytes(12).toString("base64url")}!`;

const ENV_TEST_PATH = path.join(__dirname, ".env.test");

// ─── Management API helpers ─────────────────────────────────────────

async function getManagementToken(): Promise<string> {
  const res = await fetch(`https://${AUTH0_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: MGMT_CLIENT_ID,
      client_secret: MGMT_CLIENT_SECRET,
      audience: `https://${AUTH0_DOMAIN}/api/v2/`,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to get Management API token (${res.status}): ${err}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function mgmtApi(
  token: string,
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`https://${AUTH0_DOMAIN}/api/v2${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!res.ok) {
    // 409 = already exists - that's fine for some operations
    if (res.status === 409) return data;
    throw new Error(
      `Management API ${method} ${endpoint} failed (${res.status}): ${typeof data === "string" ? data : JSON.stringify(data)}`,
    );
  }
  return data;
}

// ─── Setup steps ─────────────────────────────────────────────────────

async function ensureDatabaseConnection(token: string): Promise<string> {
  console.log(`\n1. Checking for "${DB_CONNECTION_NAME}" database connection...`);

  // List all connections
  const connections = (await mgmtApi(
    token,
    "GET",
    "/connections?strategy=auth0&include_totals=false",
  )) as Array<{ id: string; name: string; enabled_clients: string[] }>;

  const existing = connections.find((c) => c.name === DB_CONNECTION_NAME);
  if (existing) {
    console.log(`   Found existing connection: ${existing.id}`);
    return existing.id;
  }

  // Create the database connection
  console.log(`   Creating "${DB_CONNECTION_NAME}" database connection...`);
  const created = (await mgmtApi(token, "POST", "/connections", {
    name: DB_CONNECTION_NAME,
    strategy: "auth0",
    enabled_clients: [SPA_CLIENT_ID, MGMT_CLIENT_ID],
    options: {
      requires_username: false,
      brute_force_protection: true,
      disable_signup: true, // Only allow test user creation via API
    },
  })) as { id: string };
  console.log(`   Created connection: ${created.id}`);
  return created.id;
}

async function enableConnectionOnSPA(
  token: string,
  connectionId: string,
): Promise<void> {
  console.log(
    "\n2. Enabling database connection on SPA application...",
  );

  // Get the connection to check enabled_clients
  const connection = (await mgmtApi(
    token,
    "GET",
    `/connections/${connectionId}`,
  )) as { enabled_clients: string[] };

  if (connection.enabled_clients?.includes(SPA_CLIENT_ID)) {
    console.log("   Already enabled on SPA.");
    return;
  }

  const updatedClients = [
    ...new Set([...(connection.enabled_clients || []), SPA_CLIENT_ID]),
  ];
  await mgmtApi(token, "PATCH", `/connections/${connectionId}`, {
    enabled_clients: updatedClients,
  });
  console.log("   Enabled on SPA application.");
}

async function enablePasswordGrant(token: string): Promise<void> {
  console.log("\n3. Enabling Password grant type on SPA application...");

  const client = (await mgmtApi(
    token,
    "GET",
    `/clients/${SPA_CLIENT_ID}?fields=grant_types`,
  )) as { grant_types: string[] };

  const currentGrants = client.grant_types || [];
  if (currentGrants.includes("password")) {
    console.log("   Password grant already enabled.");
    return;
  }

  const updatedGrants = [...new Set([...currentGrants, "password"])];
  await mgmtApi(token, "PATCH", `/clients/${SPA_CLIENT_ID}`, {
    grant_types: updatedGrants,
  });
  console.log(
    `   Enabled. Grant types: ${updatedGrants.join(", ")}`,
  );
}

async function setDefaultDirectory(token: string): Promise<void> {
  console.log("\n4. Setting tenant Default Directory...");

  const tenant = (await mgmtApi(
    token,
    "GET",
    "/tenants/settings?fields=default_directory",
  )) as { default_directory?: string };

  if (tenant.default_directory === DB_CONNECTION_NAME) {
    console.log(`   Already set to "${DB_CONNECTION_NAME}".`);
    return;
  }

  await mgmtApi(token, "PATCH", "/tenants/settings", {
    default_directory: DB_CONNECTION_NAME,
  });
  console.log(`   Set to "${DB_CONNECTION_NAME}".`);
}

async function createTestUser(token: string): Promise<void> {
  console.log("\n5. Creating test user...");

  // Check if user already exists
  const existing = (await mgmtApi(
    token,
    "GET",
    `/users-by-email?email=${encodeURIComponent(TEST_EMAIL)}`,
  )) as Array<{ user_id: string; identities: Array<{ connection: string }> }>;

  const dbUser = existing.find((u) =>
    u.identities?.some((i) => i.connection === DB_CONNECTION_NAME),
  );

  if (dbUser) {
    console.log(`   User already exists: ${dbUser.user_id}`);
    // Update password to our generated one
    await mgmtApi(token, "PATCH", `/users/${encodeURIComponent(dbUser.user_id)}`, {
      password: TEST_PASSWORD,
    });
    console.log("   Password updated.");
    return;
  }

  // Create new user
  const user = (await mgmtApi(token, "POST", "/users", {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    connection: DB_CONNECTION_NAME,
    email_verified: true, // Skip email verification for test user
    name: "E2E Test User",
    nickname: "e2e-test",
  })) as { user_id: string };
  console.log(`   Created user: ${user.user_id}`);
}

function writeEnvTestFile(): void {
  console.log("\n6. Writing e2e/.env.test...");
  const content = [
    "# Auto-generated by auth0-setup.ts",
    `# Created: ${new Date().toISOString()}`,
    "",
    `E2E_TEST_EMAIL=${TEST_EMAIL}`,
    `E2E_TEST_PASSWORD=${TEST_PASSWORD}`,
    "",
  ].join("\n");

  fs.writeFileSync(ENV_TEST_PATH, content);
  console.log(`   Saved to ${ENV_TEST_PATH}`);
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Auth0 E2E Test Setup ===");
  console.log(`Domain:     ${AUTH0_DOMAIN}`);
  console.log(`SPA Client: ${SPA_CLIENT_ID.slice(0, 8)}...`);
  console.log(`Audience:   ${AUTH0_AUDIENCE}`);

  if (!AUTH0_DOMAIN || !SPA_CLIENT_ID) {
    throw new Error(
      "Missing NEXT_PUBLIC_AUTH0_DOMAIN or NEXT_PUBLIC_AUTH0_CLIENT_ID in .env.local",
    );
  }
  if (!MGMT_CLIENT_ID || !MGMT_CLIENT_SECRET) {
    throw new Error(
      "Missing AUTH0_MGMT_CLIENT_ID or AUTH0_MGMT_CLIENT_SECRET.\n\n" +
        "To get these:\n" +
        "  1. Go to Auth0 Dashboard → Applications\n" +
        '  2. Find "API Explorer Application" (or create a new M2M app)\n' +
        "  3. Copy the Client ID and Client Secret\n" +
        "  4. Run: AUTH0_MGMT_CLIENT_ID=xxx AUTH0_MGMT_CLIENT_SECRET=yyy npx tsx e2e/auth0-setup.ts",
    );
  }

  console.log("\nAcquiring Management API token...");
  const token = await getManagementToken();
  console.log("Token acquired.");

  const connectionId = await ensureDatabaseConnection(token);
  await enableConnectionOnSPA(token, connectionId);
  await enablePasswordGrant(token);
  await setDefaultDirectory(token);
  await createTestUser(token);
  writeEnvTestFile();

  console.log("\n=== Setup complete! ===");
  console.log(`\nTest user: ${TEST_EMAIL}`);
  console.log(`Password:  ${TEST_PASSWORD}`);
  console.log("\nNext steps:");
  console.log("  1. npm run test:e2e:auth    # Fetch tokens using ROPC");
  console.log("  2. npm run test:e2e         # Run all E2E tests");
}

main().catch((err) => {
  console.error("\nSetup failed:", err.message);
  process.exit(1);
});
