/**
 * Professional HTML report generator for the Nightly QA system.
 *
 * Produces a single self-contained HTML file with:
 *   - Executive summary dashboard
 *   - Per-persona test result sections
 *   - Embedded base64 screenshots
 *   - Console and network error tables
 *   - Performance metrics
 *   - Collapsible detail sections
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { TestStatus, PersonaRegistry } from "./types.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = resolve(__dirname, "..", "reports");

/**
 * Convert a PNG file to a base64 data URI.
 */
function screenshotToBase64(filename) {
  try {
    const fullPath = resolve(REPORT_DIR, filename);
    const buf = readFileSync(fullPath);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Escape HTML special characters.
 */
function esc(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Status badge HTML.
 */
function badge(status) {
  const map = {
    [TestStatus.PASS]: { label: "PASS", cls: "badge-pass" },
    [TestStatus.FAIL]: { label: "FAIL", cls: "badge-fail" },
    [TestStatus.WARN]: { label: "WARN", cls: "badge-warn" },
    [TestStatus.SKIP]: { label: "SKIP", cls: "badge-skip" },
  };
  const b = map[status] || { label: status, cls: "badge-skip" };
  return `<span class="badge ${b.cls}">${b.label}</span>`;
}

/**
 * Icon SVG for persona cards.
 */
function personaIcon(iconName) {
  const icons = {
    code: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    briefcase: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
    zap: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    smartphone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`,
    activity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    "credit-card": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
    "shopping-bag": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
    "git-branch": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`,
    layers: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
    terminal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  };
  return icons[iconName] || icons.code;
}

/**
 * Generate the full HTML report.
 *
 * @param {{ persona: string, description?: string, steps: object[], browser?: object, error?: string }[]} results
 * @param {string} date — YYYY-MM-DD
 * @param {string} reportDir — Output directory
 * @returns {Promise<string>} Path to the generated HTML file
 */
export async function generateReport(results, date, reportDir) {
  // --- Aggregate stats ---
  let totalPass = 0;
  let totalFail = 0;
  let totalWarn = 0;
  let totalSkip = 0;
  let totalScreenshots = 0;
  let totalConsoleErrors = 0;
  let totalNetworkErrors = 0;

  for (const r of results) {
    for (const s of r.steps || []) {
      if (s.status === TestStatus.PASS) totalPass++;
      else if (s.status === TestStatus.FAIL) totalFail++;
      else if (s.status === TestStatus.WARN) totalWarn++;
      else totalSkip++;
    }
    if (r.browser) {
      totalScreenshots += r.browser.screenshots?.length || 0;
      totalConsoleErrors += r.browser.errors?.length || 0;
      totalNetworkErrors += r.browser.networkErrors?.length || 0;
    }
  }

  const totalSteps = totalPass + totalFail + totalWarn + totalSkip;
  const passRate = totalSteps > 0 ? ((totalPass / totalSteps) * 100).toFixed(1) : "0.0";
  const overallStatus = totalFail > 0 ? "FAIL" : totalWarn > 0 ? "WARN" : "PASS";
  const overallColor = totalFail > 0 ? "#ef4444" : totalWarn > 0 ? "#f59e0b" : "#22c55e";

  // --- Build persona sections ---
  const personaSections = results.map((r) => buildPersonaSection(r)).join("\n");

  // --- Assemble HTML ---
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Jarble Nightly QA Report — ${esc(date)}</title>
  <style>
    /* ===== Reset & Base ===== */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      line-height: 1.6;
      min-height: 100vh;
    }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* ===== Layout ===== */
    .container { max-width: 1280px; margin: 0 auto; padding: 24px 32px; }
    .header {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border-bottom: 1px solid #334155;
      padding: 32px 0;
    }
    .header-inner {
      max-width: 1280px; margin: 0 auto; padding: 0 32px;
      display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;
    }
    .header h1 {
      font-size: 28px; font-weight: 700; color: #f8fafc;
      display: flex; align-items: center; gap: 12px;
    }
    .header h1 .logo {
      width: 36px; height: 36px; background: linear-gradient(135deg, #6366f1, #8b5cf6);
      border-radius: 8px; display: flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 800; color: white;
    }
    .header-meta { font-size: 14px; color: #94a3b8; text-align: right; }
    .header-meta .overall-badge {
      display: inline-block; padding: 4px 16px; border-radius: 20px;
      font-weight: 700; font-size: 13px; letter-spacing: 0.5px;
      background: ${overallColor}22; color: ${overallColor}; border: 1px solid ${overallColor}44;
    }

    /* ===== Dashboard Cards ===== */
    .dashboard {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px; margin: 32px 0;
    }
    .stat-card {
      background: #1e293b; border: 1px solid #334155; border-radius: 12px;
      padding: 20px 24px; text-align: center; transition: transform 0.15s, box-shadow 0.15s;
    }
    .stat-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
    .stat-card .stat-value { font-size: 36px; font-weight: 800; line-height: 1.2; }
    .stat-card .stat-label { font-size: 13px; color: #94a3b8; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-card.pass .stat-value { color: #22c55e; }
    .stat-card.fail .stat-value { color: #ef4444; }
    .stat-card.warn .stat-value { color: #f59e0b; }
    .stat-card.info .stat-value { color: #60a5fa; }

    /* ===== Pass Rate Bar ===== */
    .pass-rate-bar {
      background: #1e293b; border: 1px solid #334155; border-radius: 12px;
      padding: 20px 24px; margin-bottom: 32px;
    }
    .pass-rate-bar .bar-label { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
    .pass-rate-bar .bar-track { height: 12px; background: #334155; border-radius: 6px; overflow: hidden; display: flex; }
    .pass-rate-bar .bar-pass { background: #22c55e; height: 100%; transition: width 0.5s ease; }
    .pass-rate-bar .bar-warn { background: #f59e0b; height: 100%; transition: width 0.5s ease; }
    .pass-rate-bar .bar-fail { background: #ef4444; height: 100%; transition: width 0.5s ease; }

    /* ===== Persona Sections ===== */
    .persona-section {
      background: #1e293b; border: 1px solid #334155; border-radius: 12px;
      margin-bottom: 24px; overflow: hidden;
    }
    .persona-header {
      padding: 20px 24px; cursor: pointer; display: flex; align-items: center;
      gap: 16px; user-select: none; border-bottom: 1px solid transparent;
      transition: background 0.15s;
    }
    .persona-header:hover { background: #1e293b88; }
    .persona-header.open { border-bottom-color: #334155; }
    .persona-icon {
      width: 40px; height: 40px; border-radius: 10px; display: flex;
      align-items: center; justify-content: center; flex-shrink: 0;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
    }
    .persona-icon svg { width: 20px; height: 20px; color: white; }
    .persona-title { flex: 1; }
    .persona-title h3 { font-size: 16px; font-weight: 600; color: #f8fafc; }
    .persona-title .persona-desc { font-size: 13px; color: #94a3b8; }
    .persona-stats { display: flex; gap: 12px; font-size: 13px; font-weight: 600; }
    .persona-stats .ps-pass { color: #22c55e; }
    .persona-stats .ps-fail { color: #ef4444; }
    .persona-stats .ps-warn { color: #f59e0b; }
    .chevron { width: 20px; height: 20px; color: #64748b; transition: transform 0.2s; flex-shrink: 0; }
    .persona-header.open .chevron { transform: rotate(180deg); }
    .persona-body { display: none; padding: 24px; }
    .persona-header.open + .persona-body { display: block; }
    .persona-error { background: #7f1d1d33; border: 1px solid #ef444444; border-radius: 8px; padding: 12px 16px; color: #fca5a5; margin-bottom: 16px; font-family: monospace; font-size: 13px; }

    /* ===== Test Steps Table ===== */
    .steps-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    .steps-table th {
      text-align: left; padding: 10px 12px; font-size: 11px; font-weight: 600;
      color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px;
      border-bottom: 1px solid #334155; background: #0f172a44;
    }
    .steps-table td { padding: 10px 12px; font-size: 14px; border-bottom: 1px solid #1e293b; }
    .steps-table tr:hover td { background: #0f172a44; }
    .steps-table .step-details { font-size: 12px; color: #94a3b8; font-family: monospace; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* ===== Badges ===== */
    .badge {
      display: inline-block; padding: 2px 10px; border-radius: 12px;
      font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
    }
    .badge-pass { background: #22c55e22; color: #22c55e; border: 1px solid #22c55e44; }
    .badge-fail { background: #ef444422; color: #ef4444; border: 1px solid #ef444444; }
    .badge-warn { background: #f59e0b22; color: #f59e0b; border: 1px solid #f59e0b44; }
    .badge-skip { background: #64748b22; color: #64748b; border: 1px solid #64748b44; }

    /* ===== Sub-sections (screenshots, errors, network) ===== */
    .sub-section { margin-bottom: 24px; }
    .sub-section h4 {
      font-size: 14px; font-weight: 600; color: #cbd5e1; margin-bottom: 12px;
      display: flex; align-items: center; gap: 8px;
    }
    .sub-section h4 .count {
      background: #334155; color: #94a3b8; font-size: 11px; padding: 1px 8px;
      border-radius: 10px; font-weight: 600;
    }

    /* ===== Screenshots Grid ===== */
    .screenshot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
    .screenshot-card {
      background: #0f172a; border: 1px solid #334155; border-radius: 8px; overflow: hidden;
    }
    .screenshot-card img { width: 100%; height: auto; display: block; border-bottom: 1px solid #334155; }
    .screenshot-card .screenshot-info { padding: 10px 14px; }
    .screenshot-card .screenshot-name { font-size: 13px; font-weight: 600; color: #f8fafc; }
    .screenshot-card .screenshot-meta { font-size: 11px; color: #64748b; margin-top: 2px; }

    /* ===== Error / Network Tables ===== */
    .error-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .error-table th {
      text-align: left; padding: 8px 10px; font-size: 11px; font-weight: 600;
      color: #94a3b8; text-transform: uppercase; border-bottom: 1px solid #334155;
      background: #0f172a44;
    }
    .error-table td {
      padding: 8px 10px; border-bottom: 1px solid #1e293b; font-family: monospace;
      font-size: 12px; max-width: 500px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .error-table tr:hover td { background: #0f172a44; }
    .error-table .status-400 { color: #f59e0b; }
    .error-table .status-500 { color: #ef4444; }

    /* ===== Performance ===== */
    .perf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
    .perf-item {
      background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 12px 16px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .perf-item .perf-name { font-size: 12px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
    .perf-item .perf-value { font-size: 14px; font-weight: 700; }
    .perf-fast { color: #22c55e; }
    .perf-medium { color: #f59e0b; }
    .perf-slow { color: #ef4444; }

    /* ===== Footer ===== */
    .footer { text-align: center; padding: 32px 0; color: #475569; font-size: 13px; border-top: 1px solid #1e293b; margin-top: 48px; }

    /* ===== Collapsible ===== */
    .collapsible-trigger {
      cursor: pointer; user-select: none; display: flex; align-items: center; gap: 6px;
    }
    .collapsible-trigger .toggle-icon { font-size: 10px; color: #64748b; transition: transform 0.2s; }
    .collapsible-content { display: none; }
    .collapsible-trigger.expanded .toggle-icon { transform: rotate(90deg); }
    .collapsible-trigger.expanded + .collapsible-content { display: block; }

    /* ===== Nav ===== */
    .persona-nav {
      display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 32px;
    }
    .persona-nav a {
      background: #1e293b; border: 1px solid #334155; border-radius: 8px;
      padding: 6px 14px; font-size: 13px; color: #94a3b8; transition: all 0.15s;
    }
    .persona-nav a:hover { background: #334155; color: #f8fafc; text-decoration: none; }
    .persona-nav a.has-failures { border-color: #ef444466; color: #fca5a5; }

    /* ===== Print ===== */
    @media print {
      body { background: white; color: #111; }
      .persona-body { display: block !important; }
      .stat-card { border: 1px solid #ddd; }
    }
  </style>
</head>
<body>

<div class="header">
  <div class="header-inner">
    <h1>
      <div class="logo">J</div>
      Nightly QA Report
    </h1>
    <div class="header-meta">
      <div class="overall-badge">${overallStatus}</div>
      <div style="margin-top:6px">${esc(date)} &middot; ${esc(new Date().toLocaleTimeString())}</div>
      <div style="font-size:12px;color:#64748b">Jarble Platform &middot; ${results.length} personas</div>
    </div>
  </div>
</div>

<div class="container">
  <!-- Dashboard -->
  <div class="dashboard">
    <div class="stat-card pass"><div class="stat-value">${totalPass}</div><div class="stat-label">Passed</div></div>
    <div class="stat-card fail"><div class="stat-value">${totalFail}</div><div class="stat-label">Failed</div></div>
    <div class="stat-card warn"><div class="stat-value">${totalWarn}</div><div class="stat-label">Warnings</div></div>
    <div class="stat-card info"><div class="stat-value">${totalScreenshots}</div><div class="stat-label">Screenshots</div></div>
    <div class="stat-card info"><div class="stat-value">${totalConsoleErrors}</div><div class="stat-label">Console Errors</div></div>
    <div class="stat-card info"><div class="stat-value">${totalNetworkErrors}</div><div class="stat-label">Network Errors</div></div>
  </div>

  <!-- Pass Rate Bar -->
  <div class="pass-rate-bar">
    <div class="bar-label">
      <span>Pass Rate</span>
      <span><strong>${passRate}%</strong> (${totalPass} / ${totalSteps})</span>
    </div>
    <div class="bar-track">
      <div class="bar-pass" style="width:${totalSteps > 0 ? (totalPass / totalSteps) * 100 : 0}%"></div>
      <div class="bar-warn" style="width:${totalSteps > 0 ? (totalWarn / totalSteps) * 100 : 0}%"></div>
      <div class="bar-fail" style="width:${totalSteps > 0 ? (totalFail / totalSteps) * 100 : 0}%"></div>
    </div>
  </div>

  <!-- Persona Quick Nav -->
  <div class="persona-nav">
    ${results.map((r, i) => {
      const hasFail = (r.steps || []).some((s) => s.status === TestStatus.FAIL) || r.error;
      return `<a href="#persona-${i}" class="${hasFail ? "has-failures" : ""}">${esc(r.persona)}</a>`;
    }).join("\n    ")}
  </div>

  <!-- Persona Sections -->
  ${personaSections}

  <div class="footer">
    Generated by Jarble Nightly QA &middot; ${esc(new Date().toISOString())}
  </div>
</div>

<script>
  // Toggle persona sections
  document.querySelectorAll('.persona-header').forEach(h => {
    h.addEventListener('click', () => {
      h.classList.toggle('open');
    });
  });
  // Toggle collapsible sub-sections
  document.querySelectorAll('.collapsible-trigger').forEach(t => {
    t.addEventListener('click', () => {
      t.classList.toggle('expanded');
    });
  });
  // Auto-open sections with failures
  document.querySelectorAll('.persona-header[data-has-fail="true"]').forEach(h => {
    h.classList.add('open');
  });
</script>
</body>
</html>`;

  const reportPath = resolve(reportDir, `${date}.html`);
  writeFileSync(reportPath, html, "utf-8");

  // Also write JSON sidecar
  const jsonPath = resolve(reportDir, `${date}.json`);
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        date,
        summary: { totalPass, totalFail, totalWarn, totalSkip, totalScreenshots, totalConsoleErrors, totalNetworkErrors, passRate },
        results,
      },
      null,
      2
    ),
    "utf-8"
  );

  return reportPath;
}

/**
 * Build HTML for a single persona section.
 */
function buildPersonaSection(result, index) {
  const { persona, description, steps = [], browser, error } = result;
  const registry = PersonaRegistry.find((p) => p.name === persona);
  const icon = registry ? personaIcon(registry.icon) : personaIcon("code");
  const desc = description || registry?.description || "";

  const passCount = steps.filter((s) => s.status === TestStatus.PASS).length;
  const failCount = steps.filter((s) => s.status === TestStatus.FAIL).length;
  const warnCount = steps.filter((s) => s.status === TestStatus.WARN).length;
  const hasFail = failCount > 0 || !!error;

  const chevronSvg = `<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;

  // --- Steps table ---
  let stepsHtml = "";
  if (steps.length > 0) {
    stepsHtml = `
    <table class="steps-table">
      <thead><tr><th>Status</th><th>Step</th><th>Details</th><th>Time</th></tr></thead>
      <tbody>
        ${steps
          .map(
            (s) => `
          <tr>
            <td>${badge(s.status)}</td>
            <td>${esc(s.name)}</td>
            <td class="step-details">${esc(
              s.details
                ? Object.entries(s.details)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(", ")
                : ""
            )}</td>
            <td style="color:#64748b;font-size:12px">${esc(s.timestamp?.slice(11, 19) || "")}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
  }

  // --- Screenshots ---
  let screenshotsHtml = "";
  if (browser?.screenshots?.length > 0) {
    screenshotsHtml = `
    <div class="sub-section">
      <h4 class="collapsible-trigger expanded">
        <span class="toggle-icon">&#9654;</span>
        Screenshots <span class="count">${browser.screenshots.length}</span>
      </h4>
      <div class="collapsible-content">
        <div class="screenshot-grid">
          ${browser.screenshots
            .map((ss) => {
              const b64 = screenshotToBase64(ss.path);
              const imgTag = b64
                ? `<img src="${b64}" alt="${esc(ss.name)}" loading="lazy" />`
                : `<div style="padding:20px;color:#64748b;text-align:center">Screenshot not found: ${esc(ss.path)}</div>`;
              return `
              <div class="screenshot-card">
                ${imgTag}
                <div class="screenshot-info">
                  <div class="screenshot-name">${esc(ss.name)}</div>
                  <div class="screenshot-meta">${esc(ss.page)} &middot; ${esc(ss.timestamp?.slice(11, 19) || "")}</div>
                </div>
              </div>`;
            })
            .join("")}
        </div>
      </div>
    </div>`;
  }

  // --- Console Errors ---
  let consoleErrorsHtml = "";
  if (browser?.errors?.length > 0) {
    consoleErrorsHtml = `
    <div class="sub-section">
      <h4 class="collapsible-trigger">
        <span class="toggle-icon">&#9654;</span>
        Console Errors <span class="count">${browser.errors.length}</span>
      </h4>
      <div class="collapsible-content">
        <table class="error-table">
          <thead><tr><th>Type</th><th>Message</th><th>URL</th><th>Time</th></tr></thead>
          <tbody>
            ${browser.errors
              .map(
                (e) => `
              <tr>
                <td><span class="badge badge-fail">${esc(e.type)}</span></td>
                <td>${esc(e.text)}</td>
                <td>${esc(e.url)}</td>
                <td>${esc(e.timestamp?.slice(11, 19) || "")}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  // --- Network Errors ---
  let networkErrorsHtml = "";
  if (browser?.networkErrors?.length > 0) {
    networkErrorsHtml = `
    <div class="sub-section">
      <h4 class="collapsible-trigger">
        <span class="toggle-icon">&#9654;</span>
        Network Errors <span class="count">${browser.networkErrors.length}</span>
      </h4>
      <div class="collapsible-content">
        <table class="error-table">
          <thead><tr><th>Method</th><th>URL</th><th>Status</th><th>Error</th><th>Time</th></tr></thead>
          <tbody>
            ${browser.networkErrors
              .map(
                (e) => `
              <tr>
                <td>${esc(e.method)}</td>
                <td>${esc(e.url)}</td>
                <td class="${(e.status || 0) >= 500 ? "status-500" : "status-400"}">${esc(e.status || "")}</td>
                <td>${esc(e.error)}</td>
                <td>${esc(e.timestamp?.slice(11, 19) || "")}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  // --- Performance Metrics ---
  let perfHtml = "";
  if (browser?.performanceMetrics?.length > 0) {
    perfHtml = `
    <div class="sub-section">
      <h4 class="collapsible-trigger">
        <span class="toggle-icon">&#9654;</span>
        Performance <span class="count">${browser.performanceMetrics.length}</span>
      </h4>
      <div class="collapsible-content">
        <div class="perf-grid">
          ${browser.performanceMetrics
            .map((m) => {
              const cls = m.value < 1000 ? "perf-fast" : m.value < 3000 ? "perf-medium" : "perf-slow";
              return `
              <div class="perf-item">
                <span class="perf-name" title="${esc(m.name)}">${esc(m.name.replace(/^navigate:/, ""))}</span>
                <span class="perf-value ${cls}">${m.value}ms</span>
              </div>`;
            })
            .join("")}
        </div>
      </div>
    </div>`;
  }

  return `
  <div class="persona-section" id="persona-${PersonaRegistry.findIndex((p) => p.name === persona)}">
    <div class="persona-header${hasFail ? " open" : ""}" data-has-fail="${hasFail}">
      <div class="persona-icon">${icon}</div>
      <div class="persona-title">
        <h3>${esc(persona)}</h3>
        <div class="persona-desc">${esc(desc)}</div>
      </div>
      <div class="persona-stats">
        ${passCount > 0 ? `<span class="ps-pass">${passCount} passed</span>` : ""}
        ${failCount > 0 ? `<span class="ps-fail">${failCount} failed</span>` : ""}
        ${warnCount > 0 ? `<span class="ps-warn">${warnCount} warn</span>` : ""}
      </div>
      ${chevronSvg}
    </div>
    <div class="persona-body">
      ${error ? `<div class="persona-error">CRASH: ${esc(error)}</div>` : ""}
      ${stepsHtml}
      ${screenshotsHtml}
      ${consoleErrorsHtml}
      ${networkErrorsHtml}
      ${perfHtml}
    </div>
  </div>`;
}
