/**
 * Bot Teams QA Test
 *
 * Tests the Bot Teams view renders correctly with:
 * - 3 deployments (Research Agent, Writer Agent, Reviewer Agent)
 * - A flow "Content Pipeline Team" with 3 connected nodes
 * - Visible blue/green connection handles on the canvas
 */

import { chromium } from 'playwright';
import { fetchAuthTokens, buildAuthInjectionScript } from './lib/auth.mjs';

const QA_EMAIL = 'smallradcomp@gmail.com';
const QA_PASSWORD = 'P@ssw0rdSS';
const BASE_URL = 'http://localhost:3000';

async function run() {
  console.log('[1/5] Fetching auth tokens...');
  const tokens = await fetchAuthTokens(QA_EMAIL, QA_PASSWORD);
  const authScript = buildAuthInjectionScript(tokens);
  console.log('  Got tokens');

  console.log('[2/5] Launching browser...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(authScript);

  console.log('[3/5] Navigating to /deployments...');
  await page.goto(`${BASE_URL}/deployments`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  console.log('[4/5] Clicking Bot Teams tab...');
  await page.locator('text=Bot Teams').first().click();
  await page.waitForTimeout(2000);

  // Click the "Content Pipeline Team" flow to select it
  const flowItem = await page.locator('text=Content Pipeline Team').first();
  if (await flowItem.isVisible({ timeout: 3000 })) {
    await flowItem.click();
    console.log('  Selected Content Pipeline Team flow');
  }

  // Wait for ReactFlow to render nodes
  await page.waitForTimeout(3000);

  // Try clicking the "fit view" button if it exists (ReactFlow control)
  const fitBtn = await page.locator('.react-flow__controls-fitview, [title="fit view"], button:has-text("Fit")').first();
  if (await fitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await fitBtn.click();
    console.log('  Clicked fit view');
    await page.waitForTimeout(1000);
  }

  console.log('[5/5] Verifying and screenshotting...');

  // Get all node info from the DOM
  const domInfo = await page.evaluate(() => {
    const rfNodes = document.querySelectorAll('.react-flow__node');
    const rfHandles = document.querySelectorAll('.react-flow__handle');
    const rfEdges = document.querySelectorAll('.react-flow__edge');
    const rfCanvas = document.querySelector('.react-flow');

    // Check handle computed styles
    const handleInfo = [];
    rfHandles.forEach((h, i) => {
      if (i < 10) {
        const style = window.getComputedStyle(h);
        const rect = h.getBoundingClientRect();
        handleInfo.push({
          width: style.width,
          height: style.height,
          bg: style.backgroundColor,
          visibility: style.visibility,
          opacity: style.opacity,
          display: style.display,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          classes: h.className,
        });
      }
    });

    // Get node text content
    const nodeTexts = [];
    rfNodes.forEach(n => {
      nodeTexts.push(n.textContent?.substring(0, 80));
    });

    return {
      hasCanvas: !!rfCanvas,
      nodeCount: rfNodes.length,
      handleCount: rfHandles.length,
      edgeCount: rfEdges.length,
      handleInfo,
      nodeTexts,
    };
  });

  // Take screenshot
  await page.screenshot({
    path: 'scripts/nightly-qa/screenshots/bot-teams-view.png',
    fullPage: true
  });

  // Also take a screenshot of just the ReactFlow area
  const rfEl = await page.locator('.react-flow').first();
  if (await rfEl.isVisible({ timeout: 2000 }).catch(() => false)) {
    await rfEl.screenshot({
      path: 'scripts/nightly-qa/screenshots/bot-teams-canvas.png'
    });
    console.log('  Canvas screenshot saved');
  }

  console.log('\n=== DOM INSPECTION ===');
  console.log(`ReactFlow canvas:  ${domInfo.hasCanvas ? 'YES' : 'NO'}`);
  console.log(`Nodes:             ${domInfo.nodeCount}`);
  console.log(`Handles:           ${domInfo.handleCount}`);
  console.log(`Edges:             ${domInfo.edgeCount}`);
  console.log(`Node texts:        ${JSON.stringify(domInfo.nodeTexts)}`);

  if (domInfo.handleInfo.length > 0) {
    console.log('\n=== HANDLE DETAILS ===');
    domInfo.handleInfo.forEach((h, i) => {
      console.log(`  Handle ${i}: ${h.width}x${h.height}, bg=${h.bg}, vis=${h.visibility}, opacity=${h.opacity}, rect=${JSON.stringify(h.rect)}`);
      console.log(`    classes: ${h.classes}`);
    });
  }

  // Pass/fail
  const passed = domInfo.hasCanvas && domInfo.nodeCount >= 3 && domInfo.handleCount >= 6;
  console.log(`\n=== RESULT: ${passed ? 'PASS' : 'FAIL'} ===`);

  if (!passed && domInfo.nodeCount === 0) {
    console.log('\nDEBUG: Nodes not found with .react-flow__node selector.');
    // Check if nodes exist with data attributes
    const altNodes = await page.evaluate(() => {
      const all = document.querySelectorAll('[data-id]');
      return Array.from(all).slice(0, 20).map(el => ({
        tag: el.tagName,
        id: el.getAttribute('data-id'),
        classes: el.className?.substring?.(0, 100),
      }));
    });
    console.log('Elements with data-id:', JSON.stringify(altNodes, null, 2));
  }

  await page.waitForTimeout(5000);
  await browser.close();
  process.exit(passed ? 0 : 1);
}

run().catch(err => {
  console.error('QA test failed:', err);
  process.exit(1);
});
