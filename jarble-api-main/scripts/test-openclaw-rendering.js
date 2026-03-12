#!/usr/bin/env node
/**
 * Broad OpenClaw Rendering Test Suite
 *
 * Tests LLM output quality across 8+ suites (36+ test cases).
 * Requires a running deployment.
 *
 * Usage:
 *   node scripts/test-openclaw-rendering.js <deploymentId> [--suite <name>] [--verbose]
 */

const { extractComponents, assert, assertComponent, runSuite } = require('./lib/openclaw-test-helpers');

// ── CLI args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const deploymentId = args.find(a => !a.startsWith('--'));
const suiteFilter = args.includes('--suite') ? args[args.indexOf('--suite') + 1] : null;
const verbose = args.includes('--verbose');

if (!deploymentId) {
  console.error('Usage: node scripts/test-openclaw-rendering.js <deploymentId> [--suite <name>] [--verbose]');
  console.error('\nSuites: sandbox-classic, sandbox-esm, sandbox-mixed, sandbox-prop-quality,');
  console.error('        sandbox-error-recovery, chart-variety, builtin-coverage, mixed-dashboards, sandpack');
  process.exit(1);
}

// ── Suite 6: Sandbox Classic Mode ─────────────────────────────────────────

const sandboxClassicTests = [
  {
    name: '6.1 Three.js rotating cube',
    prompt: 'Create a 3D rotating cube using Three.js with lighting and a dark background',
    checks: (components) => {
      assert(components.length >= 1, 'Expected at least 1 component');
      const sb = components.find(c => c.component === 'sandbox' || c.component === 'canvas');
      assert(sb, 'Expected a sandbox component');
      const hasThree = (sb.props.libraries && sb.props.libraries.some(l => /three/i.test(l)))
        || (sb.props.moduleJs && /import.*three/i.test(sb.props.moduleJs))
        || (sb.props.importMap && sb.props.importMap.three);
      assert(hasThree, 'Should reference Three.js via libraries, moduleJs, or importMap');
    },
  },
  {
    name: '6.2 D3 force-directed graph',
    prompt: 'Create a D3.js force-directed graph showing 10 connected nodes with labels',
    checks: (components) => {
      const sb = components.find(c => c.component === 'sandbox' || c.component === 'canvas');
      assert(sb, 'Expected a sandbox component');
      const hasD3 = (sb.props.libraries && sb.props.libraries.some(l => /d3/i.test(l)))
        || (sb.props.moduleJs && /import.*d3/i.test(sb.props.moduleJs));
      assert(hasD3, 'Should reference D3.js');
    },
  },
  {
    name: '6.3 Chart.js radar chart',
    prompt: 'Create a Chart.js radar chart comparing 5 skills across 3 team members',
    checks: (components) => {
      const sb = components.find(c => c.component === 'sandbox' || c.component === 'canvas' || c.component === 'chart');
      assert(sb, 'Expected a sandbox or chart component');
    },
  },
  {
    name: '6.4 Leaflet interactive map',
    prompt: 'Create a Leaflet.js map centered on New York City with 3 markers for landmarks',
    checks: (components) => {
      const sb = components.find(c => c.component === 'sandbox' || c.component === 'canvas' || c.component === 'map');
      assert(sb, 'Expected a sandbox or map component');
    },
  },
  {
    name: '6.5 p5.js particles',
    prompt: 'Create a p5.js particle system with 100 colorful bouncing particles',
    checks: (components) => {
      const sb = components.find(c => c.component === 'sandbox' || c.component === 'canvas');
      assert(sb, 'Expected a sandbox component');
    },
  },
  {
    name: '6.6 Multi-library (Three.js + GSAP)',
    prompt: 'Create a 3D scene with Three.js where a sphere animates using GSAP tweens',
    checks: (components) => {
      const sb = components.find(c => c.component === 'sandbox' || c.component === 'canvas');
      assert(sb, 'Expected a sandbox component');
    },
  },
];

// ── Suite 7: Sandbox ESM Mode ─────────────────────────────────────────────

const sandboxEsmTests = [
  {
    name: '7.1 React via ESM',
    prompt: 'Create a sandbox with React via ESM imports showing a counter component with useState',
    checks: (components) => {
      const sb = components.find(c => ['sandbox', 'canvas', 'sandpack_sandbox'].includes(c.component));
      assert(sb, 'Expected a sandbox or sandpack component');
    },
  },
  {
    name: '7.2 D3 modules',
    prompt: 'Create a sandbox using D3 ES modules (import from "d3") showing a bar chart',
    checks: (components) => {
      const sb = components.find(c => ['sandbox', 'canvas', 'sandpack_sandbox'].includes(c.component));
      assert(sb, 'Expected a sandbox component');
    },
  },
  {
    name: '7.3 Multiple ESM imports',
    prompt: 'Create a sandbox with Three.js and React using ES module imports for a 3D scene with React overlay UI',
    checks: (components) => {
      const sb = components.find(c => ['sandbox', 'canvas', 'sandpack_sandbox'].includes(c.component));
      assert(sb, 'Expected a sandbox or sandpack component');
    },
  },
  {
    name: '7.4 importMap URL validation',
    prompt: 'Create a sandbox using lodash-es with an explicit importMap entry for filtering an array',
    checks: (components) => {
      const sb = components.find(c => ['sandbox', 'canvas', 'sandpack_sandbox'].includes(c.component));
      assert(sb, 'Expected a sandbox component');
    },
  },
];

// ── Suite 8: Sandbox Mixed Mode ───────────────────────────────────────────

const sandboxMixedTests = [
  {
    name: '8.1 Three.js + React overlay',
    prompt: 'Create a Three.js 3D cube with a React overlay showing controls using ES modules',
    checks: (components) => {
      assert(components.length >= 1, 'Expected at least 1 component');
    },
  },
  {
    name: '8.2 D3 + lodash',
    prompt: 'Create a D3 chart that uses lodash to process data before visualization',
    checks: (components) => {
      assert(components.length >= 1, 'Expected at least 1 component');
    },
  },
];

// ── Suite 9: Sandbox Prop Quality ─────────────────────────────────────────

const sandboxPropQualityTests = [
  {
    name: '9.1 No scripts in html',
    prompt: 'Create a sandbox animation of a bouncing ball using canvas',
    checks: (components) => {
      const sb = components.find(c => c.component === 'sandbox' || c.component === 'canvas');
      if (sb && sb.props.html) {
        assert(!/<script/i.test(sb.props.html), 'html prop should not contain <script> tags');
      }
    },
  },
  {
    name: '9.2 Trusted CDN URLs only',
    prompt: 'Create a sandbox with Three.js showing a wireframe torus',
    checks: (components) => {
      const sb = components.find(c => c.component === 'sandbox' || c.component === 'canvas');
      if (sb && sb.props.libraries) {
        for (const lib of sb.props.libraries) {
          assert(/^https:\/\/(esm\.sh|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com)/.test(lib),
            `Library URL not from trusted CDN: ${lib}`);
        }
      }
    },
  },
  {
    name: '9.3 Height bounds',
    prompt: 'Create a full-width sandbox showing a starfield animation',
    checks: (components) => {
      const sb = components.find(c => c.component === 'sandbox' || c.component === 'canvas');
      if (sb && sb.props.height) {
        assert(sb.props.height >= 100 && sb.props.height <= 2000, `Height out of bounds: ${sb.props.height}`);
      }
    },
  },
  {
    name: '9.4 layout_hint present',
    prompt: 'Create a sandbox with a canvas-based clock animation',
    checks: (components) => {
      for (const c of components) {
        assert(c.layout_hint, `Component ${c.component} missing layout_hint`);
      }
    },
  },
];

// ── Suite 10: Sandbox Error Recovery ──────────────────────────────────────

const sandboxErrorRecoveryTests = [
  {
    name: '10.1 Handle SANDBOX_ERROR for missing lib',
    prompt: '[SANDBOX_ERROR] cardId=card-test1 error="ReferenceError: THREE is not defined" source="" line=5\nFix this sandbox error',
    checks: (_, response) => {
      assert(/jarble_ui_update/.test(response), 'Should use jarble_ui_update to fix the error');
      assert(/card-test1/.test(response), 'Should reference the error card_id');
    },
  },
  {
    name: '10.2 Handle COMPONENT_ERROR',
    prompt: '[COMPONENT_ERROR] cardId=card-test2 component=chart error="Invalid data format"\nFix the chart - use data: [{month: "Jan", sales: 100}], dataKeys: ["sales"], xAxisKey: "month"',
    checks: (_, response) => {
      assert(/jarble_ui_update/.test(response), 'Should use jarble_ui_update');
    },
  },
  {
    name: '10.3 Add interactivity via update',
    prompt: 'Create a simple counter display showing 0',
    checks: (components) => {
      assert(components.length >= 1, 'Expected at least 1 component');
    },
  },
];

// ── Suite 11: Chart Variety ───────────────────────────────────────────────

const chartVarietyTests = [
  {
    name: '11.1 Multi-series line chart',
    prompt: 'Create a line chart showing temperature data for 3 cities over 12 months with real data',
    checks: (components) => {
      const chart = components.find(c => c.component === 'chart');
      if (chart) {
        assert(chart.props.type === 'line', 'Should be line chart');
        assert(Array.isArray(chart.props.dataKeys) && chart.props.dataKeys.length >= 2, 'Should have multiple dataKeys');
      }
    },
  },
  {
    name: '11.2 Stacked bar chart',
    prompt: 'Create a stacked bar chart showing quarterly revenue by product category',
    checks: (components) => {
      const chart = components.find(c => c.component === 'chart');
      if (chart) {
        assert(chart.props.type === 'bar', 'Should be bar chart');
      }
    },
  },
  {
    name: '11.3 Pie chart',
    prompt: 'Create a pie chart showing market share of top 5 smartphone brands',
    checks: (components) => {
      const chart = components.find(c => c.component === 'chart');
      if (chart) {
        assert(chart.props.type === 'pie', 'Should be pie chart');
      }
    },
  },
  {
    name: '11.4 Area chart',
    prompt: 'Create an area chart showing website traffic over the past week',
    checks: (components) => {
      const chart = components.find(c => c.component === 'chart');
      if (chart) {
        assert(chart.props.type === 'area', 'Should be area chart');
      }
    },
  },
  {
    name: '11.5 Heatmap via sandbox',
    prompt: 'Create a heatmap showing activity by day of week and hour using D3',
    checks: (components) => {
      assert(components.length >= 1, 'Expected at least 1 component');
    },
  },
  {
    name: '11.6 Word cloud via sandbox',
    prompt: 'Create a word cloud visualization of programming language popularity using D3',
    checks: (components) => {
      assert(components.length >= 1, 'Expected at least 1 component');
    },
  },
];

// ── Suite 12: Built-in Coverage ───────────────────────────────────────────

const builtinCoverageTests = [
  {
    name: '12.1 Accordion',
    prompt: 'Create an accordion with 4 FAQ items about JavaScript',
    checks: (components) => {
      const acc = components.find(c => c.component === 'accordion');
      assert(acc, 'Expected accordion component');
      assert(Array.isArray(acc.props.items), 'Should have items array');
    },
  },
  {
    name: '12.2 Tabs',
    prompt: 'Create tabs showing Overview, Features, and Pricing for a SaaS product',
    checks: (components) => {
      const tabs = components.find(c => c.component === 'tabs');
      assert(tabs, 'Expected tabs component');
      assert(Array.isArray(tabs.props.tabs), 'Should have tabs array');
    },
  },
  {
    name: '12.3 Steps',
    prompt: 'Create a 5-step onboarding wizard showing the current step as step 3',
    checks: (components) => {
      const steps = components.find(c => c.component === 'steps');
      assert(steps, 'Expected steps component');
    },
  },
  {
    name: '12.4 Form',
    prompt: 'Create a contact form with name, email, message fields and a submit button',
    checks: (components) => {
      const form = components.find(c => c.component === 'form');
      assert(form, 'Expected form component');
      assert(Array.isArray(form.props.fields), 'Should have fields array');
    },
  },
  {
    name: '12.5 Tree',
    prompt: 'Create a file tree showing a typical React project structure',
    checks: (components) => {
      const tree = components.find(c => c.component === 'tree');
      assert(tree, 'Expected tree component');
    },
  },
  {
    name: '12.6 List',
    prompt: 'Create a list of the top 8 programming languages with descriptions',
    checks: (components) => {
      const list = components.find(c => c.component === 'list');
      assert(list, 'Expected list component');
      assert(Array.isArray(list.props.items), 'Should have items array');
    },
  },
  {
    name: '12.7 Carousel',
    prompt: 'Create a carousel showing 5 popular tourist destinations with descriptions',
    checks: (components) => {
      const carousel = components.find(c => c.component === 'carousel');
      assert(carousel, 'Expected carousel component');
    },
  },
  {
    name: '12.8 Result',
    prompt: 'Create a success result showing "Payment Processed" with subtitle "Order #12345 confirmed"',
    checks: (components) => {
      const result = components.find(c => c.component === 'result');
      assert(result, 'Expected result component');
      assert(result.props.status === 'success', 'Should be success status');
    },
  },
];

// ── Suite 13: Mixed Dashboards ────────────────────────────────────────────

const mixedDashboardTests = [
  {
    name: '13.1 Analytics dashboard',
    prompt: 'Create an analytics dashboard with: total users metric card, a line chart of daily signups this week, and a data table of top 5 referral sources',
    checks: (components) => {
      assert(components.length >= 3, 'Expected at least 3 components for a dashboard');
      const types = components.map(c => c.component);
      assert(types.some(t => ['metric_card', 'stat_grid', 'statistic'].includes(t)), 'Should have a metric component');
      assert(types.includes('chart'), 'Should have a chart');
    },
  },
  {
    name: '13.2 IoT status board',
    prompt: 'Create an IoT status board showing: 4 sensor readings as metric cards, a timeline of recent events, and an alert for a warning condition',
    checks: (components) => {
      assert(components.length >= 3, 'Expected at least 3 components');
    },
  },
  {
    name: '13.3 Portfolio with 3D',
    prompt: 'Create a portfolio showcase: a header saying "My Work", 3 metric cards for projects/clients/years, and a Three.js sandbox with a rotating 3D logo',
    checks: (components) => {
      assert(components.length >= 3, 'Expected at least 3 components');
      const hasSandbox = components.some(c => ['sandbox', 'canvas', 'sandpack_sandbox'].includes(c.component));
      assert(hasSandbox, 'Should include a sandbox for 3D');
    },
  },
];

// ── Suite 14: Sandpack ────────────────────────────────────────────────────

const sandpackTests = [
  {
    name: '14.1 React todo app',
    prompt: 'Build a React todo app with add, remove, and filter functionality using sandpack_sandbox',
    checks: (components) => {
      const sp = components.find(c => c.component === 'sandpack_sandbox');
      if (sp) {
        assert(sp.props.files, 'Should have files prop');
        const hasApp = sp.props.files['/App.tsx'] || sp.props.files['/App.js'] || sp.props.files['App.tsx'];
        assert(hasApp, 'Should have App entry file');
      }
    },
  },
  {
    name: '14.2 React Three Fiber scene',
    prompt: 'Create a React Three Fiber 3D scene with orbit controls using sandpack_sandbox',
    checks: (components) => {
      const sp = components.find(c => c.component === 'sandpack_sandbox');
      if (sp) {
        assert(sp.props.files, 'Should have files');
        if (sp.props.dependencies) {
          const depKeys = Object.keys(sp.props.dependencies);
          assert(depKeys.some(k => k.includes('fiber') || k.includes('three')), 'Should have three/fiber dependency');
        }
      }
    },
  },
  {
    name: '14.3 Multi-file dashboard',
    prompt: 'Build a multi-page React dashboard with separate component files for a sidebar, main content, and data table using sandpack_sandbox',
    checks: (components) => {
      const sp = components.find(c => c.component === 'sandpack_sandbox');
      if (sp) {
        assert(sp.props.files, 'Should have files');
        assert(Object.keys(sp.props.files).length >= 2, 'Should have multiple files');
      }
    },
  },
  {
    name: '14.4 Simple animation stays as sandbox',
    prompt: 'Create a simple bouncing ball canvas animation with no libraries',
    checks: (components) => {
      const sb = components.find(c => c.component === 'sandbox' || c.component === 'canvas');
      assert(sb, 'Simple animation should use regular sandbox, not sandpack');
    },
  },
];

// ── Suite registry ────────────────────────────────────────────────────────

const SUITES = {
  'sandbox-classic': { name: 'Sandbox Classic Mode', tests: sandboxClassicTests },
  'sandbox-esm': { name: 'Sandbox ESM Mode', tests: sandboxEsmTests },
  'sandbox-mixed': { name: 'Sandbox Mixed Mode', tests: sandboxMixedTests },
  'sandbox-prop-quality': { name: 'Sandbox Prop Quality', tests: sandboxPropQualityTests },
  'sandbox-error-recovery': { name: 'Sandbox Error Recovery', tests: sandboxErrorRecoveryTests },
  'chart-variety': { name: 'Chart Variety', tests: chartVarietyTests },
  'builtin-coverage': { name: 'Built-in Coverage', tests: builtinCoverageTests },
  'mixed-dashboards': { name: 'Mixed Dashboards', tests: mixedDashboardTests },
  'sandpack': { name: 'Sandpack', tests: sandpackTests },
};

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('OpenClaw Rendering Test Suite');
  console.log(`Deployment: ${deploymentId}`);
  console.log(`Filter: ${suiteFilter || 'all'}`);
  console.log('');

  const results = [];
  const suitesToRun = suiteFilter
    ? { [suiteFilter]: SUITES[suiteFilter] }
    : SUITES;

  if (suiteFilter && !SUITES[suiteFilter]) {
    console.error(`Unknown suite: ${suiteFilter}`);
    console.error(`Available: ${Object.keys(SUITES).join(', ')}`);
    process.exit(1);
  }

  for (const [key, suite] of Object.entries(suitesToRun)) {
    const result = await runSuite(suite.name, suite.tests, { deploymentId, verbose });
    results.push(result);
  }

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('SUMMARY');
  console.log(`${'═'.repeat(60)}`);
  let totalPassed = 0, totalFailed = 0, totalTests = 0;
  for (const r of results) {
    console.log(`  ${r.suiteName}: ${r.passed}/${r.total} passed`);
    totalPassed += r.passed;
    totalFailed += r.failed;
    totalTests += r.total;
  }
  console.log(`\n  Total: ${totalPassed}/${totalTests} passed, ${totalFailed} failed`);
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
