/**
 * Browser monitor — opens localhost:3000 in Playwright Chromium,
 * logs all console messages, network errors, and page errors to stdout.
 * Run: node scripts/monitor.mjs
 */
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:3000";
const logs = [];

function ts() {
  return new Date().toISOString().slice(11, 23);
}

function log(type, msg) {
  const line = `[${ts()}] [${type}] ${msg}`;
  logs.push(line);
  console.log(line);
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// Console messages
page.on("console", (msg) => {
  const type = msg.type(); // log, warn, error, info
  if (type === "error" || type === "warn") {
    log(`CONSOLE:${type.toUpperCase()}`, msg.text());
  }
});

// Page errors (uncaught exceptions)
page.on("pageerror", (err) => {
  log("PAGE_ERROR", `${err.name}: ${err.message}`);
});

// Network failures
page.on("requestfailed", (req) => {
  log("NET_FAIL", `${req.method()} ${req.url()} — ${req.failure()?.errorText || "unknown"}`);
});

// Response errors (4xx/5xx)
page.on("response", (res) => {
  if (res.status() >= 400) {
    log("HTTP_ERR", `${res.status()} ${res.url()}`);
  }
});

// Navigation
page.on("framenavigated", (frame) => {
  if (frame === page.mainFrame()) {
    log("NAV", frame.url());
  }
});

log("START", `Opening ${BASE}`);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
log("READY", "Page loaded — monitoring. Browse freely, I'm watching.");

// Keep alive — dump summary every 60s
setInterval(() => {
  const errors = logs.filter((l) => l.includes("ERROR") || l.includes("FAIL") || l.includes("PAGE_ERROR"));
  log("HEARTBEAT", `${logs.length} events, ${errors.length} errors so far`);
}, 60_000);

// Handle graceful shutdown
process.on("SIGINT", async () => {
  log("STOP", "Shutting down monitor");
  await browser.close();
  process.exit(0);
});
