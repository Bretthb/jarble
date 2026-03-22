#!/usr/bin/env node
/**
 * OpenClaw Prompt Quality Test Suite
 *
 * Sends structured test prompts to a live deployment via POST /debug/deployment/:id/chat
 * and scores the responses for component selection, prop quality, layout hints, and edge cases.
 *
 * Usage:
 *   node scripts/test-openclaw-prompts.js [deploymentId] [--suite <name>] [--verbose]
 *
 * Requires: API running on localhost:3001 with K8s access to the deployment pod.
 */

const DEPLOYMENT_ID = process.argv[2] || "uv95yd6bfr9q";
const API_BASE = process.env.API_BASE || "http://localhost:3001";
const VERBOSE = process.argv.includes("--verbose") || process.argv.includes("-v");
const SUITE_FILTER = (() => {
  const idx = process.argv.indexOf("--suite");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function chat(message, sessionKey) {
  const url = `${API_BASE}/debug/deployment/${DEPLOYMENT_ID}/chat`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sessionKey }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Chat failed (${res.status}): ${body}`);
  }
  return res.json();
}

function extractComponents(result) {
  const blocks = result.uiBlocks || [];
  const components = [];
  for (const b of blocks) {
    const comp = {
      component: b.component,
      props: b.props || {},
      // Parser outputs camelCase layoutHint, bot writes snake_case layout_hint
      layout_hint: b.layoutHint || b.layout_hint || b.props?.layout_hint || null,
    };
    components.push(comp);
    // Also extract children from layout components (bot often nests inside layout)
    if (b.component === "layout" && Array.isArray(b.props?.children)) {
      for (const child of b.props.children) {
        components.push({
          component: child.component,
          props: child.props || {},
          layout_hint: null, // children inside layout don't have layout hints
          _nested: true,
        });
      }
    }
  }
  return components;
}

function hasComponent(components, name) {
  return components.some(c => c.component === name);
}

function componentTypes(components) {
  return components.map(c => c.component);
}

// Scoring: pass/fail/warn
const PASS = "PASS";
const FAIL = "FAIL";
const WARN = "WARN";

function score(condition, passMsg, failMsg) {
  return condition ? { status: PASS, msg: passMsg } : { status: FAIL, msg: failMsg };
}

function warn(condition, msg) {
  return condition ? { status: PASS, msg: "OK" } : { status: WARN, msg };
}

// ── Test Suites ──────────────────────────────────────────────────────────────

const CANVAS_STATE = "[CANVAS_STATE] cards=[] gridCols=3";

const suites = {
  // ── Suite 1: Self-Awareness ──
  "self-awareness": [
    {
      id: "1.1",
      name: "Capabilities overview",
      message: `${CANVAS_STATE}\nWhat can you do? Give me a brief overview of your capabilities.`,
      check(result, comps) {
        const text = (result.text || "").toLowerCase();
        return [
          score(text.includes("ui") || text.includes("component") || text.includes("canvas") || text.includes("render"),
            "Mentions UI rendering", "Does NOT mention UI/canvas/component rendering"),
          score(text.includes("search") || text.includes("web") || text.includes("research"),
            "Mentions search/research", "Does NOT mention search capabilities"),
        ];
      },
    },
    {
      id: "1.2",
      name: "MCP tool inventory",
      message: `${CANVAS_STATE}\nList ALL MCP tools you have access to. Be thorough - list every single one.`,
      check(result) {
        const text = (result.text || "").toLowerCase();
        const toolMentions = [
          "render_ui", "component_reference", "skill_reference", "list_components",
          "web_search", "web_fetch", "set_theme",
          "save_artifact", "load_artifact", "list_artifact",
        ];
        const found = toolMentions.filter(t => text.includes(t.toLowerCase()));
        return [
          score(found.length >= 5, `Found ${found.length}/10 key tools`, `Only found ${found.length}/10 key tools: ${found.join(", ")}`),
          score(text.includes("skill_reference"), "Mentions skill_reference", "Does NOT mention skill_reference"),
        ];
      },
    },
    {
      id: "1.3",
      name: "Rendering skills awareness",
      message: `${CANVAS_STATE}\nWhat rendering skills or guides do you have? How can you help me build dashboards?`,
      check(result) {
        const text = (result.text || "").toLowerCase();
        const skills = ["component-rendering", "sandbox-mastery", "generative-ui", "platform-awareness", "dashboard-composition"];
        const found = skills.filter(s => text.includes(s));
        return [
          score(found.length >= 2, `Mentions ${found.length}/5 skills`, `Only mentions ${found.length}/5 skills`),
          score(text.includes("skill_reference") || text.includes("skill"), "References skill system", "Does NOT reference skill system"),
        ];
      },
    },
    {
      id: "1.4",
      name: "Component count",
      message: `${CANVAS_STATE}\nHow many built-in UI components do you have? Name them all.`,
      check(result) {
        const text = (result.text || "").toLowerCase();
        const knownComponents = [
          "chart", "data_table", "metric_card", "stat_grid", "card", "alert",
          "tabs", "accordion", "timeline", "form", "button_group", "code_block",
          "sandbox", "map", "embed", "list", "steps", "progress", "badge",
        ];
        const found = knownComponents.filter(c => text.includes(c));
        return [
          score(found.length >= 15, `Names ${found.length}/19 key components`, `Only names ${found.length}/19 key components`),
          score(text.includes("37") || text.includes("38") || text.includes("35") || text.includes("36") || found.length >= 20,
            "Knows approximate count (35-38)", "Doesn't know approximate component count"),
        ];
      },
    },
    {
      id: "1.5",
      name: "No canvas = text only",
      message: "What's the weather like today?",
      check(result, comps) {
        return [
          score(comps.length === 0, "Zero uiBlocks (correct)", `Rendered ${comps.length} uiBlocks without canvas state`),
          score((result.text || "").length > 20, "Has text response", "No text response"),
        ];
      },
    },
  ],

  // ── Suite 2: Component Selection ──
  "component-selection": [
    {
      id: "2.1",
      name: "Revenue comparison → bar chart",
      message: `${CANVAS_STATE}\nShow me a comparison of revenue by 4 regions: North America $4.2M, Europe $3.1M, Asia Pacific $2.8M, Latin America $1.5M`,
      check(result, comps) {
        const types = componentTypes(comps);
        return [
          score(comps.length >= 1, `Rendered ${comps.length} component(s)`, "No components rendered"),
          score(hasComponent(comps, "chart"), "Uses chart component", `Uses ${types.join(", ")} instead of chart`),
          score(!hasComponent(comps, "sandbox"), "Does NOT use sandbox", "Uses sandbox (should use chart)"),
          warn(comps.some(c => c.component === "chart" && c.props?.type === "bar"),
            "Chart type should be 'bar' for comparison"),
        ];
      },
    },
    {
      id: "2.2",
      name: "Monthly trend → line chart",
      message: `${CANVAS_STATE}\nShow me the monthly active user trend over the last 6 months: Jan 8200, Feb 9100, Mar 9800, Apr 10500, May 11200, Jun 12847`,
      check(result, comps) {
        const types = componentTypes(comps);
        const chartComp = comps.find(c => c.component === "chart");
        return [
          score(hasComponent(comps, "chart"), "Uses chart component", `Uses ${types.join(", ")} instead of chart`),
          score(!hasComponent(comps, "sandbox"), "Does NOT use sandbox", "Uses sandbox (should use chart)"),
          warn(chartComp && (chartComp.props?.type === "line" || chartComp.props?.type === "area"),
            `Chart type is "${chartComp?.props?.type}" — should be line or area for trends`),
        ];
      },
    },
    {
      id: "2.3",
      name: "Employee roster → data_table",
      message: `${CANVAS_STATE}\nShow me an employee roster: Alice (Engineering, Senior), Bob (Marketing, Lead), Carol (Design, Junior), Dave (Engineering, Mid), Eve (Sales, Senior)`,
      check(result, comps) {
        const types = componentTypes(comps);
        return [
          score(hasComponent(comps, "data_table") || hasComponent(comps, "spreadsheet"),
            "Uses data_table or spreadsheet", `Uses ${types.join(", ")} instead of data_table`),
          score(!hasComponent(comps, "sandbox"), "Does NOT use sandbox", "Uses sandbox (should use data_table)"),
        ];
      },
    },
    {
      id: "2.4",
      name: "4 KPIs → metric_card or stat_grid",
      message: `${CANVAS_STATE}\nShow me 4 key metrics: Revenue $1.2M (+15%), Users 12,847 (+23%), Conversion 3.2% (-0.5%), Churn 2.1% (-0.3%)`,
      check(result, comps) {
        const types = componentTypes(comps);
        const hasMetrics = hasComponent(comps, "metric_card") || hasComponent(comps, "stat_grid");
        return [
          score(hasMetrics, "Uses metric_card or stat_grid", `Uses ${types.join(", ")} instead of metric_card/stat_grid`),
          score(!hasComponent(comps, "data_table"), "Does NOT use data_table for KPIs", "Uses data_table for KPIs (should use metric_card/stat_grid)"),
        ];
      },
    },
    {
      id: "2.5",
      name: "Simple bar chart (critical sandbox test)",
      message: `${CANVAS_STATE}\nCreate a simple bar chart showing Q1-Q4 sales: Q1 $250K, Q2 $310K, Q3 $280K, Q4 $420K`,
      check(result, comps) {
        return [
          score(hasComponent(comps, "chart"), "Uses chart component", "Does NOT use chart component"),
          score(!hasComponent(comps, "sandbox"), "Does NOT use sandbox (critical)", "CRITICAL: Uses sandbox for a simple bar chart"),
        ];
      },
    },
    {
      id: "2.6",
      name: "Map request",
      message: `${CANVAS_STATE}\nShow Paris on a map`,
      check(result, comps) {
        const types = componentTypes(comps);
        const hasMap = hasComponent(comps, "map") || hasComponent(comps, "embed");
        return [
          score(hasMap, "Uses map or embed component", `Uses ${types.join(", ")} instead of map/embed`),
          score(!hasComponent(comps, "sandbox"), "Does NOT use sandbox", "Uses sandbox (should use map/embed)"),
        ];
      },
    },
    {
      id: "2.7",
      name: "Code display → code_block",
      message: `${CANVAS_STATE}\nShow me a Python fibonacci function`,
      check(result, comps) {
        const types = componentTypes(comps);
        const hasCode = hasComponent(comps, "code_block") || hasComponent(comps, "code_editor");
        return [
          score(hasCode, "Uses code_block or code_editor", `Uses ${types.join(", ")} instead of code_block/code_editor`),
          score(!hasComponent(comps, "sandbox"), "Does NOT use sandbox", "Uses sandbox (should use code_block)"),
        ];
      },
    },
  ],

  // ── Suite 3: Prop Quality ──
  "prop-quality": [
    {
      id: "3.1",
      name: "Chart data format (recharts, not Chart.js)",
      message: `${CANVAS_STATE}\nShow a bar chart of website traffic: Mon 1200, Tue 1500, Wed 1100, Thu 1800, Fri 2000`,
      check(result, comps) {
        const chart = comps.find(c => c.component === "chart");
        if (!chart) return [{ status: FAIL, msg: "No chart component found" }];
        const p = chart.props;
        return [
          score(Array.isArray(p.data), "data is array (recharts format)", "data is NOT array"),
          score(!p.labels && !p.datasets, "No Chart.js labels/datasets", "Has Chart.js format (labels/datasets)"),
          score(Array.isArray(p.dataKeys), "Has dataKeys array", "Missing dataKeys"),
          score(typeof p.xAxisKey === "string", "Has xAxisKey string", "Missing xAxisKey"),
        ];
      },
    },
    {
      id: "3.2",
      name: "data_table rows format (2D arrays)",
      message: `${CANVAS_STATE}\nShow a table of the top 3 programming languages: Python (29.9%, general purpose), JavaScript (17.4%, web), Java (16.8%, enterprise)`,
      check(result, comps) {
        const table = comps.find(c => c.component === "data_table");
        if (!table) return [{ status: FAIL, msg: "No data_table component found" }];
        const rows = table.props.rows;
        return [
          score(Array.isArray(rows), "rows is array", "rows is NOT array"),
          score(rows && rows.length > 0 && Array.isArray(rows[0]),
            "rows[0] is array (correct 2D format)", "rows[0] is object (wrong format — should be 2D array)"),
          score(Array.isArray(table.props.columns), "Has columns array", "Missing columns"),
        ];
      },
    },
    {
      id: "3.3",
      name: "Alert variant enums",
      message: `${CANVAS_STATE}\nShow me 3 alerts: a success message "Deploy complete", a warning "Disk 85% full", and an error "Build failed"`,
      check(result, comps) {
        const alerts = comps.filter(c => c.component === "alert");
        if (alerts.length === 0) return [{ status: FAIL, msg: "No alert components found" }];
        const validVariants = new Set(["default", "secondary", "destructive", "outline", "info", "success", "warning"]);
        const badVariants = alerts.filter(a => a.props.variant && !validVariants.has(a.props.variant));
        return [
          score(alerts.length >= 2, `Found ${alerts.length} alerts`, `Only ${alerts.length} alert(s)`),
          score(badVariants.length === 0,
            "All variants are valid", `Invalid variants: ${badVariants.map(a => a.props.variant).join(", ")}`),
          score(alerts.every(a => a.props.message), "All alerts have message field", "Some alerts missing 'message' field"),
        ];
      },
    },
    {
      id: "3.4",
      name: "metric_card field names",
      message: `${CANVAS_STATE}\nShow a single metric card: Monthly Revenue $1.2M, up 15% from last month`,
      check(result, comps) {
        const mc = comps.find(c => c.component === "metric_card" || c.component === "stat_grid");
        if (!mc) return [{ status: FAIL, msg: "No metric_card or stat_grid found" }];
        if (mc.component === "metric_card") {
          return [
            score(mc.props.label !== undefined, "Has 'label' field", "Missing 'label' (has 'name' or 'title' instead?)"),
            score(!mc.props.name, "Does NOT use 'name'", "Uses wrong field 'name' instead of 'label'"),
            score(mc.props.change !== undefined, "Has 'change' field", "Missing 'change' field"),
          ];
        }
        // stat_grid
        const stats = mc.props.stats || [];
        return [
          score(stats.length > 0, "Has stats array", "Empty stats array"),
          score(stats[0]?.label !== undefined, "Stats use 'label'", "Stats missing 'label'"),
        ];
      },
    },
    {
      id: "3.5",
      name: "Timeline field names",
      message: `${CANVAS_STATE}\nShow a timeline of a project: Jan - Planning (completed), Feb - Design (completed), Mar - Development (active), Apr - Testing (pending), May - Launch (pending)`,
      check(result, comps) {
        const tl = comps.find(c => c.component === "timeline");
        if (!tl) return [{ status: FAIL, msg: "No timeline component found" }];
        return [
          score(Array.isArray(tl.props.events), "Uses 'events' field", "Does NOT use 'events' (uses 'items' or 'data' instead?)"),
          score(!tl.props.items, "Does NOT use 'items'", "Uses wrong field 'items' instead of 'events'"),
          score(!tl.props.data, "Does NOT use 'data'", "Uses wrong field 'data' instead of 'events'"),
        ];
      },
    },
  ],

  // ── Suite 4: Dashboard Composition ──
  "dashboard-composition": [
    {
      id: "4.1",
      name: "Full sales dashboard (order + layout hints)",
      message: `${CANVAS_STATE}\nBuild me a sales dashboard: 4 KPIs (Revenue $1.2M +15%, Deals 342 +8%, Win Rate 68% -2%, Avg Deal $3.5K +12%), a monthly revenue trend chart, and a top customers table (Acme $420K, Globex $380K, Wayne $310K)`,
      check(result, comps) {
        const types = componentTypes(comps);
        const hasKpi = hasComponent(comps, "metric_card") || hasComponent(comps, "stat_grid");
        const hasChart = hasComponent(comps, "chart");
        const hasTable = hasComponent(comps, "data_table");
        const withHints = comps.filter(c => c.layout_hint);
        return [
          score(comps.length >= 3, `${comps.length} components (need 3+)`, `Only ${comps.length} component(s)`),
          score(hasKpi, "Has KPI components", "Missing KPIs"),
          score(hasChart, "Has chart", "Missing chart"),
          score(hasTable, "Has data_table", "Missing data_table"),
          warn(withHints.length >= 2, `Only ${withHints.length}/${comps.length} have layout_hint`),
        ];
      },
    },
    {
      id: "4.2",
      name: "User breakdown (data consistency + pie chart)",
      message: `${CANVAS_STATE}\nShow a user breakdown: 50K total users. Free tier: 35K (70%), Pro tier: 12K (24%), Enterprise: 3K (6%). Use a pie chart.`,
      check(result, comps) {
        const chart = comps.find(c => c.component === "chart");
        return [
          score(comps.length >= 1, `${comps.length} component(s)`, "No components"),
          score(!!chart, "Has chart component", "Missing chart"),
          warn(chart && chart.props?.type === "pie", `Chart type is "${chart?.props?.type}" — should be pie`),
        ];
      },
    },
    {
      id: "4.3",
      name: "Bitcoin overview (density control)",
      message: `${CANVAS_STATE}\nGive me a Bitcoin overview with these metrics: Price $67,234, 24h Change +2.3%, Market Cap $1.32T, Volume $28.5B, Dominance 52.1%, All-Time High $73,750, ATH Date Mar 2024, Supply 19.6M, Max Supply 21M, Hash Rate 580 EH/s, Block Height 835,000, Avg Fee $4.20`,
      check(result, comps) {
        const metricCards = comps.filter(c => c.component === "metric_card");
        const statGrids = comps.filter(c => c.component === "stat_grid");
        return [
          score(comps.length >= 1, `${comps.length} component(s)`, "No components"),
          warn(metricCards.length <= 4, `${metricCards.length} separate metric_cards — should use stat_grid for 12 metrics`),
          score(statGrids.length >= 1 || metricCards.length <= 6,
            "Uses stat_grid or reasonable metric_card count", "Too many separate metric_cards (should consolidate into stat_grid)"),
        ];
      },
    },
    {
      id: "4.4",
      name: "Status page (layout hints variety)",
      message: `${CANVAS_STATE}\nBuild a system status page: 3 alerts (API healthy, DB degraded, CDN warning), a recent incidents timeline, and a services table showing uptime`,
      check(result, comps) {
        const withHints = comps.filter(c => c.layout_hint);
        return [
          score(comps.length >= 3, `${comps.length} components`, `Only ${comps.length} component(s)`),
          score(hasComponent(comps, "alert") || hasComponent(comps, "result"),
            "Has alert/result components", "Missing status indicators"),
          warn(withHints.length >= Math.floor(comps.length / 2),
            `Only ${withHints.length}/${comps.length} components have layout_hint`),
        ];
      },
    },
  ],

  // ── Suite 5: Edge Cases ──
  "edge-cases": [
    {
      id: "5.1",
      name: "Knowledge question (mostly text)",
      message: `${CANVAS_STATE}\nTell me about React hooks — what are the most important ones and when to use them?`,
      check(result, comps) {
        return [
          score((result.text || "").length > 100, "Has substantial text", "Text too short"),
          warn(comps.length <= 2, `${comps.length} components — should be mostly text for a knowledge question`),
        ];
      },
    },
    {
      id: "5.2",
      name: "Ambiguous prompt (should clarify)",
      message: `${CANVAS_STATE}\nPython`,
      check(result, comps) {
        return [
          score((result.text || "").length > 20, "Has text response", "No meaningful text"),
          warn(comps.length <= 3, `${comps.length} components — should not render a full dashboard for "Python"`),
        ];
      },
    },
    {
      id: "5.3",
      name: "Greeting (text only)",
      message: `${CANVAS_STATE}\nHi! How are you?`,
      check(result, comps) {
        return [
          score(comps.length === 0, "Zero uiBlocks (correct)", `Rendered ${comps.length} uiBlocks for a greeting`),
          score((result.text || "").length > 5, "Has text response", "No text response"),
        ];
      },
    },
    {
      id: "5.4",
      name: "Error recovery (COMPONENT_ERROR)",
      message: `${CANVAS_STATE}\n[COMPONENT_ERROR] cardId=card-test123 component=chart error="Missing required prop: dataKeys"`,
      check(result) {
        const updates = result.uiUpdates || [];
        const comps = result.uiBlocks || [];
        return [
          score(updates.length >= 1 || (result.rawText || "").includes("jarble_ui_update"),
            "Responds with jarble_ui_update (fix)", "Does NOT respond with a fix (jarble_ui_update)"),
          warn(comps.length === 0, `Rendered ${comps.length} NEW components — should only update existing card`),
        ];
      },
    },
  ],
};

// ── Runner ────────────────────────────────────────────────────────────────────

async function runTest(test) {
  const sessionKey = `test-${test.id}-${Date.now()}`;
  const startTime = Date.now();

  try {
    const result = await chat(test.message, sessionKey);
    const elapsed = Date.now() - startTime;
    const comps = extractComponents(result);
    const checks = test.check(result, comps);

    return {
      id: test.id,
      name: test.name,
      elapsed,
      components: comps.map(c => `${c.component}${c.layout_hint ? ` [${c.layout_hint}]` : ""}`),
      blockCount: comps.length,
      textLength: (result.text || "").length,
      updateCount: (result.uiUpdates || []).length,
      checks,
      rawText: VERBOSE ? (result.text || "").slice(0, 500) : undefined,
      rawBlocks: VERBOSE ? comps : undefined,
    };
  } catch (err) {
    return {
      id: test.id,
      name: test.name,
      elapsed: Date.now() - startTime,
      components: [],
      blockCount: 0,
      textLength: 0,
      updateCount: 0,
      checks: [{ status: FAIL, msg: `Error: ${err.message}` }],
    };
  }
}

async function runSuite(suiteName, tests) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  Suite: ${suiteName}`);
  console.log(`${"═".repeat(70)}`);

  const results = [];
  for (const test of tests) {
    process.stdout.write(`  [${test.id}] ${test.name}... `);
    const result = await runTest(test);
    results.push(result);

    const passCount = result.checks.filter(c => c.status === PASS).length;
    const failCount = result.checks.filter(c => c.status === FAIL).length;
    const warnCount = result.checks.filter(c => c.status === WARN).length;
    const elapsed = `${(result.elapsed / 1000).toFixed(1)}s`;

    if (failCount > 0) {
      console.log(`FAIL (${elapsed}) — ${result.checks.filter(c => c.status === FAIL).map(c => c.msg).join("; ")}`);
    } else if (warnCount > 0) {
      console.log(`WARN (${elapsed}) — ${result.checks.filter(c => c.status === WARN).map(c => c.msg).join("; ")}`);
    } else {
      console.log(`PASS (${elapsed})`);
    }

    if (VERBOSE) {
      console.log(`    Components: [${result.components.join(", ")}]`);
      console.log(`    Text: ${result.textLength} chars, Blocks: ${result.blockCount}, Updates: ${result.updateCount}`);
      for (const check of result.checks) {
        const icon = check.status === PASS ? "✓" : check.status === FAIL ? "✗" : "⚠";
        console.log(`    ${icon} ${check.msg}`);
      }
    }
  }

  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`OpenClaw Prompt Quality Test Suite`);
  console.log(`Deployment: ${DEPLOYMENT_ID}`);
  console.log(`API: ${API_BASE}`);
  console.log(`Filter: ${SUITE_FILTER || "all"}`);
  console.log(`Verbose: ${VERBOSE}`);

  // Verify connectivity
  try {
    const healthCheck = await fetch(`${API_BASE}/debug/deployment/${DEPLOYMENT_ID}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "ping", sessionKey: "test-health" }),
    });
    if (!healthCheck.ok) {
      const body = await healthCheck.text();
      console.error(`\nFailed to reach deployment: ${healthCheck.status} — ${body}`);
      process.exit(1);
    }
    console.log("Connectivity: OK\n");
  } catch (err) {
    console.error(`\nFailed to connect to API: ${err.message}`);
    process.exit(1);
  }

  const allResults = [];
  const suitesToRun = SUITE_FILTER
    ? { [SUITE_FILTER]: suites[SUITE_FILTER] }
    : suites;

  if (SUITE_FILTER && !suites[SUITE_FILTER]) {
    console.error(`Unknown suite: ${SUITE_FILTER}. Available: ${Object.keys(suites).join(", ")}`);
    process.exit(1);
  }

  for (const [suiteName, tests] of Object.entries(suitesToRun)) {
    const results = await runSuite(suiteName, tests);
    allResults.push(...results);
  }

  // ── Summary ──
  console.log(`\n${"═".repeat(70)}`);
  console.log("  SUMMARY");
  console.log(`${"═".repeat(70)}`);

  let totalPass = 0, totalFail = 0, totalWarn = 0;

  for (const r of allResults) {
    for (const c of r.checks) {
      if (c.status === PASS) totalPass++;
      else if (c.status === FAIL) totalFail++;
      else totalWarn++;
    }
  }

  const total = totalPass + totalFail + totalWarn;
  const passRate = total > 0 ? ((totalPass / total) * 100).toFixed(1) : "0.0";

  console.log(`  Tests: ${allResults.length}`);
  console.log(`  Checks: ${total} (${totalPass} pass, ${totalFail} fail, ${totalWarn} warn)`);
  console.log(`  Pass rate: ${passRate}%`);
  console.log();

  // Failures detail
  const failures = allResults.filter(r => r.checks.some(c => c.status === FAIL));
  if (failures.length > 0) {
    console.log("  FAILURES:");
    for (const r of failures) {
      for (const c of r.checks) {
        if (c.status === FAIL) {
          console.log(`    [${r.id}] ${r.name}: ${c.msg}`);
        }
      }
    }
    console.log();
  }

  // Warnings detail
  const warnings = allResults.filter(r => r.checks.some(c => c.status === WARN));
  if (warnings.length > 0) {
    console.log("  WARNINGS:");
    for (const r of warnings) {
      for (const c of r.checks) {
        if (c.status === WARN) {
          console.log(`    [${r.id}] ${r.name}: ${c.msg}`);
        }
      }
    }
    console.log();
  }

  // Layout hint stats
  const allComps = allResults.flatMap(r =>
    (r.rawBlocks || r.components || []).map(c => typeof c === "string" ? { layout_hint: c.includes("[") } : c)
  );
  const withHints = allComps.filter(c => c.layout_hint);
  console.log(`  Layout hints: ${withHints.length}/${allComps.length} components have layout_hint`);
  console.log();

  // Exit code
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
