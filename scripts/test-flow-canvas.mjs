/**
 * Full interactive flow canvas test via Playwright.
 * Creates deployments, tests canvas, connects nodes, screenshots everything.
 */
import { chromium } from "playwright";
import { fetchAuthTokens, buildAuthInjectionScript } from "./nightly-qa/lib/auth.mjs";
import { readFileSync, existsSync } from "fs";

const BASE_URL = "http://localhost:3000";
const API_URL = "http://localhost:3001";

// Load credentials
let email = "", password = "";
const envPath = "scripts/nightly-qa/.env";
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const [k, ...v] = line.split("=");
    const val = v.join("=").trim();
    if (k?.trim() === "QA_EMAIL") email = val;
    if (k?.trim() === "QA_PASSWORD") password = val;
  }
}

async function main() {
  // Step 0: Get auth tokens
  console.log("🔐 Getting auth tokens...");
  const tokens = await fetchAuthTokens(email, password);
  const accessToken = tokens.access_token;
  console.log("✅ Authenticated\n");

  // Step 0b: Create test deployments via API if needed
  console.log("📦 Checking deployments...");
  const listRes = await fetch(`${API_URL}/trpc/deployment.list`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const listData = await listRes.json();
  const deployments = listData?.result?.data || [];
  console.log(`   Found ${deployments.length} deployments`);

  if (deployments.length < 2) {
    console.log("   Creating test deployments via debug endpoint...");
    for (let i = deployments.length; i < 2; i++) {
      try {
        const seedRes = await fetch(`${API_URL}/debug/seed-deployment`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        });
        if (seedRes.ok) {
          const data = await seedRes.json();
          console.log(`   Created: ${data?.deployment?.id || "unknown"}`);
        } else {
          console.log(`   Seed failed (${seedRes.status}) - trying tRPC create...`);
          // Try creating via tRPC
          const createRes = await fetch(`${API_URL}/trpc/deployment.create`, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              name: `Test Bot ${i + 1}`,
              runtime: "openclaw",
              llmProvider: "anthropic",
              llmMode: "byok",
              llmModel: "claude-sonnet-4-20250514",
            }),
          });
          console.log(`   tRPC create: ${createRes.status}`);
        }
      } catch (err) {
        console.log(`   Create error: ${err.message}`);
      }
    }
  }

  // Launch browser
  console.log("\n🌐 Launching browser...");
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Inject auth
  const authScript = buildAuthInjectionScript(tokens);
  await page.addInitScript(authScript);
  await context.addCookies([{
    name: "auth0.1VR30862RmZIFR44UIM8aVHYEt3K2Rsh.is.authenticated",
    value: "true", domain: "localhost", path: "/",
    expires: Math.floor(Date.now() / 1000) + 86400,
    httpOnly: false, secure: false, sameSite: "Lax",
  }]);

  // Track errors
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text().slice(0, 150));
  });
  page.on("pageerror", (err) => errors.push(`PAGE: ${err.message.slice(0, 150)}`));

  const shot = async (name) => {
    await page.screenshot({ path: `scripts/nightly-qa/reports/${name}.png` });
    console.log(`   📸 ${name}.png`);
  };

  // ═══ TEST START ═══
  console.log("\n" + "═".repeat(50));
  console.log("  FLOW CANVAS INTERACTIVE TEST");
  console.log("═".repeat(50) + "\n");

  // 1. Navigate
  console.log("1️⃣  Navigate to /deployments");
  await page.goto(`${BASE_URL}/deployments`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);
  await shot("fc-01-loaded");

  const bodyText = await page.textContent("body");
  const isAuthed = !bodyText.includes("log in") && !bodyText.includes("Sign In");
  console.log(`   Auth: ${isAuthed ? "✅" : "❌ NOT AUTHENTICATED"}`);

  if (!isAuthed) {
    console.log("   ❌ Cannot proceed without auth. Exiting.");
    await browser.close();
    return;
  }

  // 2. Click Bot Teams tab
  console.log("2️⃣  Click Bot Teams tab");
  try {
    await page.click('[role="tab"]:has-text("Bot Teams")', { timeout: 5000 });
    await page.waitForTimeout(2000);
    console.log("   ✅ Bot Teams tab clicked");
  } catch {
    console.log("   ❌ Bot Teams tab not found, trying alternatives...");
    try {
      await page.click('[role="tab"]:has-text("Flow")', { timeout: 3000 });
      console.log("   ✅ Found 'Flow' tab");
    } catch {
      console.log("   ❌ No flow tab found");
    }
  }
  await page.waitForTimeout(1000);
  await shot("fc-02-bot-teams");

  // 3. Create new flow - use keyboard shortcut or direct click
  console.log("3️⃣  Create new flow");
  try {
    // Try clicking New button directly, avoiding dropdown intercepts
    const newBtns = await page.$$('button');
    for (const btn of newBtns) {
      const text = (await btn.textContent())?.trim();
      if (text === "New" || text?.includes("New")) {
        const isVisible = await btn.isVisible();
        if (isVisible) {
          await btn.click({ force: true }); // force: true bypasses interceptors
          console.log(`   ✅ Clicked "${text}" (forced)`);
          break;
        }
      }
    }
  } catch (err) {
    console.log(`   ❌ New button error: ${err.message.slice(0, 100)}`);
  }
  await page.waitForTimeout(2000);
  await shot("fc-03-new-flow");

  // 4. Check what's on the canvas now
  console.log("4️⃣  Analyze canvas state");
  const rfExists = await page.$('.react-flow');
  console.log(`   ReactFlow: ${rfExists ? "✅" : "❌"}`);

  let nodeCount = (await page.$$('.react-flow__node')).length;
  let edgeCount = (await page.$$('.react-flow__edge')).length;
  let handleCount = (await page.$$('.react-flow__handle')).length;
  console.log(`   Nodes: ${nodeCount}, Edges: ${edgeCount}, Handles: ${handleCount}`);

  // 5. Add nodes from palette
  console.log("5️⃣  Add nodes from palette");
  // Look for clickable items in the left area
  const allButtons = await page.$$('button');
  let addedCount = 0;
  for (const btn of allButtons) {
    const text = (await btn.textContent())?.trim();
    const box = await btn.boundingBox();
    // Palette is on the left side (x < 300) and contains deployment names
    if (box && box.x < 300 && text && text.length > 3 && text.length < 40
        && !text.includes("New") && !text.includes("Layout") && !text.includes("Save")
        && !text.includes("Run") && !text.includes("Chat") && !text.includes("Delete")
        && !text.includes("Bot Teams") && !text.includes("Linked") && !text.includes("Resource")) {
      console.log(`   Adding: "${text}" (x=${box.x.toFixed(0)})`);
      await btn.click({ force: true });
      await page.waitForTimeout(500);
      addedCount++;
      if (addedCount >= 2) break;
    }
  }
  await page.waitForTimeout(1000);
  await shot("fc-05-nodes-added");

  nodeCount = (await page.$$('.react-flow__node')).length;
  handleCount = (await page.$$('.react-flow__handle')).length;
  console.log(`   After adding: ${nodeCount} nodes, ${handleCount} handles`);

  // 6. Inspect handles closely
  console.log("6️⃣  Inspect handles");
  const sources = await page.$$('.react-flow__handle.source');
  const targets = await page.$$('.react-flow__handle.target');
  console.log(`   Source handles: ${sources.length}, Target handles: ${targets.length}`);

  for (let i = 0; i < Math.min(sources.length, 2); i++) {
    const info = await sources[i].evaluate((el) => {
      const s = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        w: s.width, h: s.height, bg: s.backgroundColor, opacity: s.opacity,
        display: s.display, visibility: s.visibility, zIndex: s.zIndex,
        x: r.x.toFixed(0), y: r.y.toFixed(0), rw: r.width.toFixed(0), rh: r.height.toFixed(0),
      };
    });
    console.log(`   Source[${i}]: ${JSON.stringify(info)}`);
  }

  // 7. Try connecting
  console.log("7️⃣  Connect nodes");
  if (sources.length > 0 && targets.length > 1) {
    const srcBox = await sources[0].boundingBox();
    const tgtBox = await targets[targets.length > 1 ? 1 : 0].boundingBox();

    if (srcBox && tgtBox && srcBox.width > 0 && tgtBox.width > 0) {
      const sx = srcBox.x + srcBox.width / 2;
      const sy = srcBox.y + srcBox.height / 2;
      const tx = tgtBox.x + tgtBox.width / 2;
      const ty = tgtBox.y + tgtBox.height / 2;

      console.log(`   Drag: (${sx.toFixed(0)},${sy.toFixed(0)}) → (${tx.toFixed(0)},${ty.toFixed(0)})`);

      await page.mouse.move(sx, sy);
      await page.waitForTimeout(500);
      await shot("fc-07a-hover-source");

      await page.mouse.down();
      await page.waitForTimeout(300);

      for (let i = 1; i <= 20; i++) {
        await page.mouse.move(
          sx + (tx - sx) * (i / 20),
          sy + (ty - sy) * (i / 20)
        );
        await page.waitForTimeout(30);
      }
      await shot("fc-07b-dragging");

      await page.mouse.up();
      await page.waitForTimeout(1000);

      const newEdges = (await page.$$('.react-flow__edge')).length;
      console.log(`   Edges after: ${newEdges} (was ${edgeCount})`);
      console.log(`   Connection: ${newEdges > edgeCount ? "✅ SUCCESS" : "❌ FAILED"}`);
    } else {
      console.log(`   ❌ Handles have zero size — srcBox: ${JSON.stringify(srcBox)}, tgtBox: ${JSON.stringify(tgtBox)}`);
    }
  } else {
    console.log(`   ❌ Not enough handles (need 1+ source, 2+ target)`);
  }
  await shot("fc-07c-connected");

  // 8. Test hierarchy dropdown
  console.log("8️⃣  Test Hierarchy dropdown");
  try {
    await page.click('button:has-text("Hierarchy")', { force: true, timeout: 3000 });
    await page.waitForTimeout(1000);
    await shot("fc-08-hierarchy");
    console.log("   ✅ Opened");
    await page.click("body", { position: { x: 10, y: 10 } });
  } catch {
    console.log("   ❌ Not found");
  }

  // 9. Click a node to test config panel
  console.log("9️⃣  Test node config panel");
  const nodes = await page.$$('.react-flow__node');
  if (nodes.length > 0) {
    await nodes[0].click();
    await page.waitForTimeout(1000);
    await shot("fc-09-config-panel");
    console.log("   ✅ Node clicked");
  }

  // Final
  await shot("fc-10-final");

  console.log("\n" + "═".repeat(50));
  console.log("  RESULTS");
  console.log("═".repeat(50));
  console.log(`Nodes: ${(await page.$$('.react-flow__node')).length}`);
  console.log(`Edges: ${(await page.$$('.react-flow__edge')).length}`);
  console.log(`Handles: ${(await page.$$('.react-flow__handle')).length}`);
  console.log(`Errors: ${errors.length}`);
  errors.slice(0, 5).forEach(e => console.log(`  ❌ ${e}`));
  console.log("\n🔍 Browser open. Ctrl+C to close.\n");

  // Keep alive
  await new Promise(() => {});
}

main().catch(console.error);
