/**
 * QA Dashboard Generator
 *
 * Reads run history and cycle logs, generates a self-contained HTML dashboard
 * with charts showing pass/fail trends, coverage growth, timing, and failure traces.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";

const LOGS_DIR = join(import.meta.dirname, "..", "logs");
const REPORTS_DIR = join(import.meta.dirname, "..", "reports");
const HISTORY_FILE = join(LOGS_DIR, "run-history.jsonl");

function readHistory() {
  if (!existsSync(HISTORY_FILE)) return [];
  return readFileSync(HISTORY_FILE, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function readAllLogs() {
  if (!existsSync(LOGS_DIR)) return [];
  return readdirSync(LOGS_DIR)
    .filter(f => f.endsWith(".json") && f !== "run-history.json")
    .map(f => {
      try { return JSON.parse(readFileSync(join(LOGS_DIR, f), "utf-8")); } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
}

function esc(s) {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function generateDashboard() {
  mkdirSync(REPORTS_DIR, { recursive: true });

  const history = readHistory();
  const logs = readAllLogs();
  const latest = logs[logs.length - 1];

  // Prepare chart data
  const chartLabels = history.map(h => new Date(h.timestamp).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
  const passData = history.map(h => h.passed || 0);
  const failData = history.map(h => h.failed || 0);
  const warnData = history.map(h => h.warned || 0);
  const durationData = history.map(h => (h.duration / 60).toFixed(1));

  // Totals
  const totalRuns = history.length;
  const totalPassed = passData.reduce((a, b) => a + b, 0);
  const totalFailed = failData.reduce((a, b) => a + b, 0);
  const totalWarned = warnData.reduce((a, b) => a + b, 0);
  const avgDuration = totalRuns ? (history.reduce((a, h) => a + h.duration, 0) / totalRuns / 60).toFixed(1) : 0;

  // Recent failures from logs
  const recentFailures = [];
  for (const log of logs.slice(-5)) {
    for (const entry of (log.entries || [])) {
      if (entry.level === "FAIL" || entry.level === "ERROR") {
        recentFailures.push({
          cycle: log.cycleId,
          time: entry.timestamp,
          phase: entry.phase,
          message: entry.message,
          error: entry.error || "",
        });
      }
    }
  }

  // Latest cycle step trace
  const latestTrace = latest ? (latest.entries || []).map(e => ({
    time: e.elapsed,
    level: e.level,
    phase: e.phase,
    message: e.message,
  })) : [];

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Jarble QA Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  :root { --bg: #0f172a; --surface: #1e293b; --border: #334155; --text: #e2e8f0; --dim: #94a3b8; --pass: #22c55e; --fail: #ef4444; --warn: #f59e0b; --info: #3b82f6; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); padding: 1.5rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.1rem; margin: 1.5rem 0 0.75rem; color: var(--dim); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; }
  .meta { color: var(--dim); font-size: 0.8rem; margin-bottom: 1.5rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; margin-bottom: 1.5rem; }
  .stat { background: var(--surface); padding: 1rem; border-radius: 0.5rem; text-align: center; border: 1px solid var(--border); }
  .stat .val { font-size: 1.75rem; font-weight: 700; }
  .stat .label { font-size: 0.75rem; color: var(--dim); margin-top: 0.25rem; }
  .stat.pass .val { color: var(--pass); }
  .stat.fail .val { color: var(--fail); }
  .stat.warn .val { color: var(--warn); }
  .stat.info .val { color: var(--info); }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; }
  .chart-box { background: var(--surface); padding: 1rem; border-radius: 0.5rem; border: 1px solid var(--border); }
  .chart-box canvas { max-height: 250px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
  th { text-align: left; padding: 0.5rem; border-bottom: 2px solid var(--border); color: var(--dim); font-weight: 500; }
  td { padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border); }
  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; }
  .badge.pass { background: #166534; color: #bbf7d0; }
  .badge.fail { background: #991b1b; color: #fecaca; }
  .badge.warn { background: #92400e; color: #fef3c7; }
  .badge.error { background: #991b1b; color: #fecaca; }
  .badge.info { background: #1e3a5f; color: #bfdbfe; }
  .badge.skip { background: #374151; color: #9ca3af; }
  .trace { background: var(--surface); border-radius: 0.5rem; border: 1px solid var(--border); padding: 1rem; max-height: 400px; overflow-y: auto; font-family: 'Fira Code', 'Cascadia Code', monospace; font-size: 0.75rem; line-height: 1.6; }
  .trace-line { display: flex; gap: 0.75rem; }
  .trace-time { color: var(--dim); min-width: 60px; }
  .trace-level { min-width: 40px; font-weight: 600; }
  .trace-level.PASS { color: var(--pass); }
  .trace-level.FAIL { color: var(--fail); }
  .trace-level.WARN { color: var(--warn); }
  .trace-level.ERROR { color: var(--fail); }
  .trace-level.INFO { color: var(--info); }
  .trace-level.SKIP { color: var(--dim); }
  .trace-phase { color: var(--dim); min-width: 70px; }
  .section { background: var(--surface); border-radius: 0.5rem; border: 1px solid var(--border); padding: 1rem; margin-bottom: 1rem; }
  @media (max-width: 768px) { .charts { grid-template-columns: 1fr; } }
</style>
</head>
<body>

<h1>Jarble QA Dashboard</h1>
<p class="meta">Generated ${new Date().toLocaleString()} | ${totalRuns} runs tracked</p>

<div class="grid">
  <div class="stat pass"><div class="val">${totalPassed}</div><div class="label">Total Passed</div></div>
  <div class="stat fail"><div class="val">${totalFailed}</div><div class="label">Total Failed</div></div>
  <div class="stat warn"><div class="val">${totalWarned}</div><div class="label">Warnings</div></div>
  <div class="stat info"><div class="val">${totalRuns}</div><div class="label">Runs</div></div>
  <div class="stat info"><div class="val">${avgDuration}m</div><div class="label">Avg Duration</div></div>
  <div class="stat ${totalFailed === 0 ? 'pass' : 'fail'}"><div class="val">${totalRuns ? ((totalPassed / (totalPassed + totalFailed + totalWarned)) * 100).toFixed(0) : 0}%</div><div class="label">Pass Rate</div></div>
</div>

<div class="charts">
  <div class="chart-box">
    <canvas id="trendChart"></canvas>
  </div>
  <div class="chart-box">
    <canvas id="durationChart"></canvas>
  </div>
</div>

<h2>Run History</h2>
<div class="section">
<table>
  <thead><tr><th>Cycle</th><th>Time</th><th>Duration</th><th>Passed</th><th>Failed</th><th>Warned</th><th>Errors</th></tr></thead>
  <tbody>
    ${history.slice().reverse().map(h => `<tr>
      <td>${esc(h.cycleId)}</td>
      <td>${new Date(h.timestamp).toLocaleString()}</td>
      <td>${(h.duration / 60).toFixed(1)}m</td>
      <td><span class="badge pass">${h.passed || 0}</span></td>
      <td>${(h.failed || 0) > 0 ? `<span class="badge fail">${h.failed}</span>` : '<span class="badge pass">0</span>'}</td>
      <td>${(h.warned || 0) > 0 ? `<span class="badge warn">${h.warned}</span>` : '0'}</td>
      <td>${(h.errorCount || 0) > 0 ? `<span class="badge error">${h.errorCount}</span>` : '0'}</td>
    </tr>`).join("")}
  </tbody>
</table>
</div>

${recentFailures.length > 0 ? `
<h2>Recent Failures & Errors</h2>
<div class="section">
<table>
  <thead><tr><th>Cycle</th><th>Time</th><th>Phase</th><th>Message</th></tr></thead>
  <tbody>
    ${recentFailures.slice(-20).reverse().map(f => `<tr>
      <td>${esc(f.cycle)}</td>
      <td>${new Date(f.time).toLocaleTimeString()}</td>
      <td><span class="badge ${f.phase === 'agent' ? 'fail' : 'error'}">${esc(f.phase)}</span></td>
      <td>${esc(f.message)}${f.error ? `<br><small style="color:var(--dim)">${esc(f.error)}</small>` : ''}</td>
    </tr>`).join("")}
  </tbody>
</table>
</div>
` : ''}

${latestTrace.length > 0 ? `
<h2>Latest Cycle Trace</h2>
<div class="trace">
  ${latestTrace.map(t => `<div class="trace-line">
    <span class="trace-time">${esc(t.time)}</span>
    <span class="trace-level ${t.level}">${t.level}</span>
    <span class="trace-phase">${esc(t.phase)}</span>
    <span>${esc(t.message)}</span>
  </div>`).join("")}
</div>
` : ''}

<script>
const labels = ${JSON.stringify(chartLabels)};
const passData = ${JSON.stringify(passData)};
const failData = ${JSON.stringify(failData)};
const warnData = ${JSON.stringify(warnData)};
const durationData = ${JSON.stringify(durationData)};

Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = '#334155';

new Chart(document.getElementById('trendChart'), {
  type: 'bar',
  data: {
    labels,
    datasets: [
      { label: 'Passed', data: passData, backgroundColor: '#22c55e', borderRadius: 3 },
      { label: 'Failed', data: failData, backgroundColor: '#ef4444', borderRadius: 3 },
      { label: 'Warned', data: warnData, backgroundColor: '#f59e0b', borderRadius: 3 },
    ]
  },
  options: {
    responsive: true,
    plugins: { title: { display: true, text: 'Pass / Fail / Warn per Cycle', color: '#e2e8f0' } },
    scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
  }
});

new Chart(document.getElementById('durationChart'), {
  type: 'line',
  data: {
    labels,
    datasets: [{
      label: 'Duration (min)',
      data: durationData,
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59,130,246,0.1)',
      fill: true,
      tension: 0.3,
      pointRadius: 4,
    }]
  },
  options: {
    responsive: true,
    plugins: { title: { display: true, text: 'Cycle Duration Over Time', color: '#e2e8f0' } },
    scales: { y: { beginAtZero: true, title: { display: true, text: 'Minutes' } } }
  }
});
</script>

<p class="meta" style="margin-top: 2rem;">Jarble Agentic QA Dashboard | <a href="https://github.com/Jarble-AI/jarble" style="color:var(--info)">GitHub</a></p>
</body>
</html>`;

  const outPath = join(REPORTS_DIR, "dashboard.html");
  writeFileSync(outPath, html);
  return outPath;
}

// CLI: generate dashboard directly
if (process.argv[1] && process.argv[1].includes("dashboard")) {
  const path = generateDashboard();
  console.log(`Dashboard generated: ${path}`);
}
