/**
 * Visual health checks for the Nightly QA system.
 *
 * Runs in-page analysis via page.evaluate() to detect layout problems,
 * broken images, overlapping elements, and other visual regressions
 * that aren't caught by functional tests.
 */

import { testStep, TestStatus } from "./types.mjs";

/**
 * Severity levels for visual issues.
 */
export const Severity = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

/**
 * Run visual health checks inside the page context.
 *
 * Detects 7 types of visual issues:
 *   1. Viewport overflow (horizontal scroll = broken layout)
 *   2. Overlapping interactive elements (buttons/links on top of each other)
 *   3. Empty visible sections (containers with no content)
 *   4. Text clipping (overflow:hidden cutting off text)
 *   5. Zero-size elements (things that should render but don't)
 *   6. Broken images (img with naturalWidth=0)
 *   7. Off-screen content (elements positioned way outside viewport)
 *
 * @param {import('playwright').Page} page — Playwright page instance
 * @returns {Promise<{ type: string, severity: string, detail: string }[]>}
 */
export async function checkVisualHealth(page) {
  return page.evaluate(() => {
    const issues = [];
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    // 1. Viewport overflow — horizontal scroll means broken layout
    const scrollW = document.documentElement.scrollWidth;
    if (scrollW > vw + 2) {
      issues.push({
        type: "viewport-overflow",
        severity: "high",
        detail: `Page width ${scrollW}px exceeds viewport ${vw}px (horizontal scroll detected)`,
      });
    }

    // 2. Overlapping interactive elements
    const interactives = Array.from(
      document.querySelectorAll('a, button, input, select, textarea, [role="button"], [tabindex]')
    ).filter((el) => {
      const style = getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    });

    for (let i = 0; i < interactives.length && i < 200; i++) {
      const rectA = interactives[i].getBoundingClientRect();
      if (rectA.width === 0 || rectA.height === 0) continue;
      for (let j = i + 1; j < interactives.length && j < 200; j++) {
        const rectB = interactives[j].getBoundingClientRect();
        if (rectB.width === 0 || rectB.height === 0) continue;
        // Check for significant overlap (more than 50% of the smaller element)
        const overlapX = Math.max(0, Math.min(rectA.right, rectB.right) - Math.max(rectA.left, rectB.left));
        const overlapY = Math.max(0, Math.min(rectA.bottom, rectB.bottom) - Math.max(rectA.top, rectB.top));
        const overlapArea = overlapX * overlapY;
        const smallerArea = Math.min(rectA.width * rectA.height, rectB.width * rectB.height);
        if (smallerArea > 0 && overlapArea / smallerArea > 0.5) {
          const tagA = `${interactives[i].tagName.toLowerCase()}${interactives[i].textContent?.trim().slice(0, 20) ? `("${interactives[i].textContent.trim().slice(0, 20)}")` : ""}`;
          const tagB = `${interactives[j].tagName.toLowerCase()}${interactives[j].textContent?.trim().slice(0, 20) ? `("${interactives[j].textContent.trim().slice(0, 20)}")` : ""}`;
          issues.push({
            type: "overlapping-interactive",
            severity: "high",
            detail: `${tagA} overlaps ${tagB} by ${Math.round((overlapArea / smallerArea) * 100)}%`,
          });
          // Only report up to 5 overlaps to avoid noise
          if (issues.filter((i) => i.type === "overlapping-interactive").length >= 5) break;
        }
      }
      if (issues.filter((i) => i.type === "overlapping-interactive").length >= 5) break;
    }

    // 3. Empty visible sections — containers that should have content but don't
    const sections = document.querySelectorAll("section, main, article, [role='main'], [role='region']");
    for (const section of sections) {
      const style = getComputedStyle(section);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = section.getBoundingClientRect();
      if (rect.height < 10) continue; // Skip truly collapsed sections
      const text = section.textContent?.trim() || "";
      const hasImages = section.querySelectorAll("img, svg, canvas, video").length > 0;
      if (text.length === 0 && !hasImages && rect.height > 50) {
        issues.push({
          type: "empty-section",
          severity: "medium",
          detail: `Empty <${section.tagName.toLowerCase()}> at (${Math.round(rect.left)},${Math.round(rect.top)}) size ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        });
      }
    }

    // 4. Text clipping — overflow:hidden cutting off text
    const textContainers = document.querySelectorAll("p, h1, h2, h3, h4, h5, h6, span, div, li, td, th, label");
    let clipCount = 0;
    for (const el of textContainers) {
      if (clipCount >= 5) break;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (style.overflow === "hidden" || style.overflowX === "hidden" || style.overflowY === "hidden") {
        if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) {
          // Skip elements with text-overflow: ellipsis (intentional clipping)
          if (style.textOverflow === "ellipsis") continue;
          // Skip elements with line-clamp (intentional)
          if (style.webkitLineClamp && style.webkitLineClamp !== "none") continue;
          const text = el.textContent?.trim().slice(0, 40) || "";
          if (text.length > 5) {
            issues.push({
              type: "text-clipping",
              severity: "medium",
              detail: `Text clipped in <${el.tagName.toLowerCase()}>: "${text}..." (scroll: ${el.scrollHeight}px > client: ${el.clientHeight}px)`,
            });
            clipCount++;
          }
        }
      }
    }

    // 5. Zero-size elements — things that should render but don't
    const shouldRender = document.querySelectorAll(
      'button, a, input:not([type="hidden"]), select, textarea, img, video, canvas, svg, iframe'
    );
    let zeroCount = 0;
    for (const el of shouldRender) {
      if (zeroCount >= 5) break;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        const id = el.id ? `#${el.id}` : "";
        const cls = el.className && typeof el.className === "string" ? `.${el.className.split(" ")[0]}` : "";
        issues.push({
          type: "zero-size",
          severity: "medium",
          detail: `Zero-size <${el.tagName.toLowerCase()}${id}${cls}> is visible but has 0x0 dimensions`,
        });
        zeroCount++;
      }
    }

    // 6. Broken images — img with naturalWidth=0 that has finished loading
    const images = document.querySelectorAll("img");
    for (const img of images) {
      const style = getComputedStyle(img);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (img.complete && img.naturalWidth === 0 && img.src && !img.src.startsWith("data:")) {
        issues.push({
          type: "broken-image",
          severity: "high",
          detail: `Broken image: ${img.src.slice(0, 100)}${img.alt ? ` (alt: "${img.alt}")` : ""}`,
        });
      }
    }

    // 7. Off-screen content — elements positioned way outside viewport
    const allVisible = document.querySelectorAll("button, a, input, select, form, nav, header, footer, main");
    let offscreenCount = 0;
    for (const el of allVisible) {
      if (offscreenCount >= 5) break;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      // Skip elements that use screen-reader-only patterns
      if (style.position === "absolute" && style.width === "1px" && style.height === "1px") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // Element is way off screen (more than 2x viewport dimension away)
      if (rect.right < -vw || rect.left > vw * 2 || rect.bottom < -vh || rect.top > vh * 2) {
        const tag = el.tagName.toLowerCase();
        const text = el.textContent?.trim().slice(0, 30) || "";
        issues.push({
          type: "off-screen",
          severity: "low",
          detail: `<${tag}>${text ? ` "${text}"` : ""} at (${Math.round(rect.left)},${Math.round(rect.top)}) is off-screen`,
        });
        offscreenCount++;
      }
    }

    return issues;
  });
}

/**
 * Run visual health check and return a testStep result.
 *
 * @param {import('./browser.mjs').BrowserSession} session — BrowserSession instance
 * @param {string} pageName — Label for the page being checked (e.g. "Homepage", "Pricing")
 * @returns {Promise<{ step: object, issues: object[] }>}
 */
export async function runVisualHealthCheck(session, pageName) {
  try {
    const issues = await checkVisualHealth(session.page);
    const highIssues = issues.filter((i) => i.severity === Severity.HIGH);
    const mediumIssues = issues.filter((i) => i.severity === Severity.MEDIUM);

    let status;
    if (highIssues.length > 0) {
      status = TestStatus.FAIL;
    } else if (mediumIssues.length > 0) {
      status = TestStatus.WARN;
    } else {
      status = TestStatus.PASS;
    }

    const step = testStep(
      `Visual health: ${pageName}`,
      status,
      {
        totalIssues: issues.length,
        high: highIssues.length,
        medium: mediumIssues.length,
        low: issues.length - highIssues.length - mediumIssues.length,
        issues: issues.slice(0, 10).map((i) => `[${i.severity}] ${i.type}: ${i.detail}`),
      }
    );

    return { step, issues };
  } catch (err) {
    const step = testStep(
      `Visual health: ${pageName}`,
      TestStatus.WARN,
      { error: err.message }
    );
    return { step, issues: [] };
  }
}

/**
 * Format visual issues into a readable summary string for reports.
 *
 * @param {{ type: string, severity: string, detail: string }[]} issues
 * @returns {string}
 */
export function formatVisualIssues(issues) {
  if (!issues || issues.length === 0) {
    return "No visual issues detected.";
  }

  const grouped = {};
  for (const issue of issues) {
    if (!grouped[issue.type]) grouped[issue.type] = [];
    grouped[issue.type].push(issue);
  }

  const lines = [];
  for (const [type, items] of Object.entries(grouped)) {
    const severityTag = items[0].severity.toUpperCase();
    lines.push(`[${severityTag}] ${type} (${items.length} issue${items.length > 1 ? "s" : ""}):`);
    for (const item of items) {
      lines.push(`  - ${item.detail}`);
    }
  }

  return lines.join("\n");
}
