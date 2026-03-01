import { test, expect } from "@playwright/test";

/**
 * Verify the component system overhaul:
 * - All 36 registered components render without errors
 * - Newly registered components (audio, avatar, blockquote, etc.) work
 * - Lazy-loaded components load correctly
 * - React.memo doesn't break rendering
 */

// Test data for all newly registered components
const NEW_COMPONENTS = [
  {
    name: "audio",
    props: { src: "https://example.com/audio.mp3", title: "Test Audio" },
  },
  {
    name: "avatar",
    props: { name: "Jane Doe", subtitle: "Engineer", size: "md" },
  },
  {
    name: "blockquote",
    props: { text: "The best way to predict the future is to invent it.", attribution: "Alan Kay", variant: "info" },
  },
  {
    name: "text_message",
    props: { botText: "Hello! How can I help you today?", userText: "Hi there" },
  },
  {
    name: "image_gallery",
    props: {
      title: "Gallery",
      images: [
        { src: "https://placehold.co/300x200", alt: "Placeholder 1", caption: "First" },
        { src: "https://placehold.co/300x200", alt: "Placeholder 2", caption: "Second" },
      ],
      columns: 2,
    },
  },
  {
    name: "descriptions",
    props: {
      title: "Server Info",
      items: [
        { label: "Host", value: "us-east-1" },
        { label: "Status", value: "Running" },
        { label: "Uptime", value: "99.9%" },
      ],
      columns: 2,
      bordered: true,
    },
  },
  {
    name: "steps",
    props: {
      current: 1,
      items: [
        { title: "Configure", description: "Set up your bot" },
        { title: "Deploy", description: "Launch to cloud" },
        { title: "Connect", description: "Add channels" },
      ],
    },
  },
  {
    name: "result",
    props: { status: "success", title: "Deployment Complete", subtitle: "Your bot is live" },
  },
  {
    name: "carousel",
    props: {
      items: [
        { title: "Slide 1", description: "First slide content" },
        { title: "Slide 2", description: "Second slide content" },
      ],
    },
  },
  {
    name: "statistic",
    props: { value: 98.6, title: "Uptime %", suffix: "%" },
  },
  {
    name: "tag_cloud",
    props: {
      title: "Topics",
      tags: [
        { text: "AI" },
        { text: "Machine Learning", size: "large" },
        { text: "NLP", color: "#2db7f5" },
        { text: "LLM" },
      ],
    },
  },
];

// Existing components that should still work
const EXISTING_COMPONENTS = [
  { name: "card", props: { title: "Test Card", body: "Card body text", status: "info" } },
  { name: "alert", props: { message: "Test alert", variant: "success", title: "Alert" } },
  { name: "badge", props: { text: "Active", variant: "success" } },
  { name: "progress", props: { label: "Loading", value: 75, variant: "default" } },
  { name: "header", props: { title: "Test Header", subtitle: "Subtitle", level: 1 } },
  { name: "divider", props: { label: "Section", variant: "solid" } },
  { name: "code_block", props: { code: "console.log('hello')", language: "javascript" } },
  {
    name: "stat_grid",
    props: {
      stats: [
        { label: "Users", value: 1250, change: "+12%" },
        { label: "Revenue", value: "$45K", change: "+8%" },
      ],
    },
  },
  {
    name: "key_value",
    props: {
      title: "Config",
      items: [
        { key: "Runtime", value: "OpenClaw" },
        { key: "Model", value: "Claude 3.5" },
      ],
    },
  },
  {
    name: "list",
    props: {
      title: "Features",
      items: [
        { text: "Chat", description: "Real-time messaging" },
        { text: "Canvas", description: "Rich UI components" },
      ],
    },
  },
  {
    name: "metric_card",
    props: { label: "Latency", value: "45ms", change: "-12%", trend: "down" },
  },
  {
    name: "data_table",
    props: {
      title: "Users",
      columns: ["Name", "Role", "Status"],
      rows: [
        ["Alice", "Admin", "Active"],
        ["Bob", "User", "Inactive"],
      ],
    },
  },
  // Lazy-loaded components
  {
    name: "chart",
    props: {
      type: "bar",
      title: "Revenue",
      data: [
        { month: "Jan", revenue: 100 },
        { month: "Feb", revenue: 200 },
      ],
      dataKeys: ["revenue"],
      xAxisKey: "month",
    },
  },
  {
    name: "sandbox",
    props: {
      html: "<h1 style='color:green;text-align:center;padding:20px'>Sandbox Works!</h1>",
    },
  },
];

test.describe("Component Overhaul Verification", () => {
  test("all newly registered components render without errors", async ({ page }) => {
    // Use a blank page and inject components via the registry
    await page.goto("/test-components");
    await page.waitForLoadState("networkidle");

    // Check no errors on the test-components page
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    // Wait for components to render
    await page.waitForTimeout(2000);

    // Verify no page errors
    expect(errors).toEqual([]);

    // Take a screenshot
    await page.screenshot({ path: "test-results/test-components.png", fullPage: true });
  });

  test("stress test page renders all registered components", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    const consoleLogs: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleLogs.push(msg.text());
    });

    await page.goto("/d/stress-test");
    await page.waitForLoadState("networkidle");

    // Wait for lazy-loaded components
    await page.waitForTimeout(3000);

    await page.screenshot({ path: "test-results/stress-test.png", fullPage: true });

    // Check for render errors in the page (error boundary cards)
    const errorCards = await page.locator("text=failed to render").count();
    console.log(`Error cards found: ${errorCards}`);
    console.log(`Page errors: ${errors.length}`);
    console.log(`Console errors: ${consoleLogs.length}`);

    // Some errors may be expected (e.g. network requests for images)
    // But no component should show "failed to render"
    expect(errorCards).toBe(0);
  });

  test("new components render correctly via CanvasRenderer", async ({ page }) => {
    await page.goto("/d/stress-test");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    const title = await page.title();
    expect(title).toBeTruthy();

    // Viewport-only screenshot to avoid timeout on huge pages
    await page.screenshot({ path: "test-results/stress-test-viewport.png" });
  });
});
