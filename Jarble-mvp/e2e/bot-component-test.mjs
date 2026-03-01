import { chromium } from '@playwright/test';

const DEPLOYMENT_URL = 'http://localhost:3000/d/clalxzf9r9li';

const COMPONENT_PROMPTS = [
  'Show me a result component with status "success", title "Deployment Complete" and subtitle "Your bot is now live"',
  'Render a steps component showing 3 steps: "Configure" (done), "Deploy" (current), "Connect" (pending), with current=1',
  'Show a statistic component with value 99.97, title "Uptime", suffix "%"',
  'Render a tag_cloud with tags: AI, Machine Learning, NLP, Deep Learning, Transformers, Claude, LLM',
  'Show a blockquote: "The best way to predict the future is to invent it" attributed to Alan Kay, with variant "info"',
  'Render an avatar component with name "Jane Smith" and subtitle "Senior Engineer", size "lg"',
  'Show a descriptions component with title "Server Info" and items: Host=us-east-1, Status=Running, CPU=2 cores, Memory=4GB',
  'Render a carousel with 3 slides: "Getting Started", "Configuration", "Go Live"',
];

(async () => {
  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  // Go directly to the deployment page — it will redirect to login if not authenticated
  await page.goto(DEPLOYMENT_URL);
  console.log('>> Browser open. Please log in (Google/GitHub/Email)...');
  console.log('>> After login you should land on the chat page.');

  // Wait until we see the textarea on the chat page (means login + page load completed)
  console.log('>> Waiting for chat input to appear (up to 4 minutes for login)...');
  await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 240000 });
  console.log('>> Chat input found! Starting component prompts...');
  await page.waitForTimeout(2000);

  const chatInput = page.locator('textarea').first();

  for (let i = 0; i < COMPONENT_PROMPTS.length; i++) {
    const prompt = COMPONENT_PROMPTS[i];
    console.log(`>> [${i + 1}/${COMPONENT_PROMPTS.length}] Sending: ${prompt.substring(0, 70)}...`);

    await chatInput.click();
    await chatInput.fill(prompt);
    await page.keyboard.press('Enter');

    // Wait for bot to respond
    await page.waitForTimeout(20000);

    // Screenshot
    await page.screenshot({ path: `test-results/bot-component-${i + 1}.png` });
    console.log(`>> Screenshot saved: bot-component-${i + 1}.png`);
  }

  console.log('>> All prompts sent! Browser stays open for 5 minutes.');
  await page.waitForTimeout(300000);
  await browser.close();
})();
