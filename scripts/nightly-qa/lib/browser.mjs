/**
 * Playwright browser session wrapper for the Nightly QA system.
 *
 * Captures screenshots, console logs, network errors, and performance metrics
 * in a structured format that feeds directly into the HTML reporter.
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = resolve(__dirname, "..", "reports");

export class BrowserSession {
  /**
   * @param {string} personaName — Identifier used in screenshot filenames
   * @param {object} options
   * @param {{ width: number, height: number }} [options.viewport]
   * @param {boolean} [options.isMobile]
   * @param {string} [options.locale]
   * @param {string} [options.timezoneId]
   * @param {string} [options.colorScheme]
   */
  constructor(personaName, options = {}) {
    this.personaName = personaName;
    this.viewport = options.viewport || { width: 1440, height: 900 };
    this.isMobile = options.isMobile ?? this.viewport.width < 768;
    this.locale = options.locale || "en-US";
    this.timezoneId = options.timezoneId || "America/New_York";
    this.colorScheme = options.colorScheme || "light";

    /** @type {{ name: string, path: string, timestamp: string, page: string }[]} */
    this.screenshots = [];
    /** @type {{ type: string, text: string, timestamp: string, url: string }[]} */
    this.consoleLogs = [];
    /** @type {{ method: string, url: string, status?: number, error: string, timestamp: string }[]} */
    this.networkErrors = [];
    /** @type {{ method: string, url: string, status: number, duration: number|null, timestamp: string }[]} */
    this.networkRequests = [];
    /** @type {{ name: string, value: number, timestamp: string }[]} */
    this.performanceMetrics = [];

    this.browser = null;
    this.context = null;
    this.page = null;
  }

  /**
   * Launch browser and wire up listeners.
   */
  async start() {
    if (!existsSync(REPORT_DIR)) {
      mkdirSync(REPORT_DIR, { recursive: true });
    }

    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      viewport: this.viewport,
      isMobile: this.isMobile,
      hasTouch: this.isMobile,
      locale: this.locale,
      timezoneId: this.timezoneId,
      colorScheme: this.colorScheme,
    });
    this.page = await this.context.newPage();

    // --- Console capture ---
    this.page.on("console", (msg) => {
      this.consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
        timestamp: new Date().toISOString(),
        url: this.page.url(),
      });
    });

    // --- Uncaught page errors ---
    this.page.on("pageerror", (err) => {
      this.consoleLogs.push({
        type: "page_error",
        text: `${err.name}: ${err.message}`,
        timestamp: new Date().toISOString(),
        url: this.page.url(),
      });
    });

    // --- Failed requests ---
    this.page.on("requestfailed", (req) => {
      this.networkErrors.push({
        method: req.method(),
        url: req.url(),
        error: req.failure()?.errorText || "unknown",
        timestamp: new Date().toISOString(),
      });
    });

    // --- All responses (track errors and timing) ---
    this.page.on("response", (res) => {
      const timing = res.request().timing();
      this.networkRequests.push({
        method: res.request().method(),
        url: res.url(),
        status: res.status(),
        duration: timing ? Math.round(timing.responseEnd - timing.requestStart) : null,
        timestamp: new Date().toISOString(),
      });
      if (res.status() >= 400) {
        this.networkErrors.push({
          method: res.request().method(),
          url: res.url(),
          status: res.status(),
          error: `HTTP ${res.status()}`,
          timestamp: new Date().toISOString(),
        });
      }
    });
  }

  /**
   * Take a screenshot and register it.
   * @param {string} name — Descriptive label (e.g. "homepage", "login-page")
   * @returns {Promise<string>} Absolute path to the screenshot file
   */
  async screenshot(name) {
    const sanitized = name.replace(/[^a-z0-9_-]/gi, "_");
    const filename = `${this.personaName}-${sanitized}-${Date.now()}.png`;
    const fullPath = resolve(REPORT_DIR, filename);
    await this.page.screenshot({ path: fullPath, fullPage: false });
    this.screenshots.push({
      name,
      path: filename,
      timestamp: new Date().toISOString(),
      page: this.page.url(),
    });
    return fullPath;
  }

  /**
   * Navigate and record load time as a performance metric.
   * @param {string} url
   * @param {object} [options] — Playwright goto options
   * @returns {Promise<number>} Load time in ms
   */
  async navigate(url, options = {}) {
    const start = Date.now();
    await this.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
      ...options,
    });
    const loadTime = Date.now() - start;
    this.performanceMetrics.push({
      name: `navigate:${url}`,
      value: loadTime,
      timestamp: new Date().toISOString(),
    });
    return loadTime;
  }

  /**
   * Wait for a selector with timing metric.
   * @param {string} selector
   * @param {object} [options]
   * @returns {Promise<number>} Time to appear in ms
   */
  async waitForVisible(selector, options = {}) {
    const start = Date.now();
    await this.page.waitForSelector(selector, {
      state: "visible",
      timeout: 15000,
      ...options,
    });
    const elapsed = Date.now() - start;
    this.performanceMetrics.push({
      name: `visible:${selector}`,
      value: elapsed,
      timestamp: new Date().toISOString(),
    });
    return elapsed;
  }

  /**
   * Safe text extraction — returns null instead of throwing.
   * @param {string} selector
   * @returns {Promise<string|null>}
   */
  async safeTextContent(selector) {
    try {
      const el = await this.page.$(selector);
      if (!el) return null;
      return await el.textContent();
    } catch {
      return null;
    }
  }

  /**
   * Safe element count.
   * @param {string} selector
   * @returns {Promise<number>}
   */
  async countElements(selector) {
    try {
      return (await this.page.$$(selector)).length;
    } catch {
      return 0;
    }
  }

  /**
   * Check if a selector exists on the page.
   * @param {string} selector
   * @returns {Promise<boolean>}
   */
  async exists(selector) {
    try {
      return (await this.page.$(selector)) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Close browser and free resources.
   */
  async cleanup() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Ignore close errors
      }
    }
  }

  /**
   * Return structured report data for this session.
   */
  getReport() {
    return {
      persona: this.personaName,
      screenshots: this.screenshots,
      consoleLogs: this.consoleLogs,
      networkErrors: this.networkErrors,
      networkRequests: this.networkRequests,
      performanceMetrics: this.performanceMetrics,
      errors: this.consoleLogs.filter(
        (l) => l.type === "error" || l.type === "page_error"
      ),
    };
  }
}
