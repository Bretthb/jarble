/**
 * Shared test helpers for OpenClaw rendering tests.
 *
 * Usage: const { chat, extractComponents, assertComponent, runSuite } = require('./lib/openclaw-test-helpers');
 */

const http = require('http');
const https = require('https');

// ── Configuration ─────────────────────────────────────────────────────────

const API_BASE = process.env.JARBLE_API_URL || 'http://localhost:3001';
const DEFAULT_TIMEOUT = 60_000; // 60s per prompt

// ── HTTP helpers ──────────────────────────────────────────────────────────

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.request(url, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      timeout: options.timeout || DEFAULT_TIMEOUT,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

// ── Component extraction ──────────────────────────────────────────────────

/**
 * Extract jarble_ui component blocks from an LLM response string.
 * Returns array of { component, props, layout_hint } objects.
 */
function extractComponents(response) {
  const blocks = [];
  const regex = /```jarble_ui\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(response)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      blocks.push(parsed);
    } catch (e) {
      console.warn('  ⚠ Failed to parse jarble_ui block:', e.message);
    }
  }
  return blocks;
}

// ── Assertions ────────────────────────────────────────────────────────────

class AssertionError extends Error {
  constructor(message) { super(message); this.name = 'AssertionError'; }
}

function assert(condition, message) {
  if (!condition) throw new AssertionError(message);
}

function assertComponent(block, checks = {}) {
  if (checks.component) {
    assert(
      Array.isArray(checks.component)
        ? checks.component.includes(block.component)
        : block.component === checks.component,
      `Expected component "${checks.component}", got "${block.component}"`
    );
  }
  if (checks.hasProps) {
    for (const prop of checks.hasProps) {
      assert(block.props && block.props[prop] !== undefined, `Missing prop "${prop}" on ${block.component}`);
    }
  }
  if (checks.propMatches) {
    for (const [key, pattern] of Object.entries(checks.propMatches)) {
      const val = block.props && block.props[key];
      if (pattern instanceof RegExp) {
        assert(pattern.test(String(val)), `Prop "${key}" doesn't match ${pattern}: got ${JSON.stringify(val)}`);
      } else if (typeof pattern === 'function') {
        assert(pattern(val), `Prop "${key}" failed custom check`);
      } else {
        assert(val === pattern, `Prop "${key}" expected ${JSON.stringify(pattern)}, got ${JSON.stringify(val)}`);
      }
    }
  }
  if (checks.noProps) {
    for (const prop of checks.noProps) {
      assert(!block.props || block.props[prop] === undefined, `Unexpected prop "${prop}" on ${block.component}`);
    }
  }
  if (checks.layoutHint) {
    assert(block.layout_hint === checks.layoutHint, `Expected layout_hint "${checks.layoutHint}", got "${block.layout_hint}"`);
  }
}

// ── Test runner ───────────────────────────────────────────────────────────

/**
 * Run a suite of rendering tests against a deployment.
 * Each test case: { name, prompt, checks: (components, response) => void }
 */
async function runSuite(suiteName, tests, { deploymentId, verbose = false }) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Suite: ${suiteName}`);
  console.log(`${'═'.repeat(60)}`);

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const test of tests) {
    process.stdout.write(`  ${test.name} ... `);
    try {
      // Send prompt to deployment
      const res = await fetchJson(`${API_BASE}/api/chat/${deploymentId}`, {
        method: 'POST',
        body: { message: test.prompt },
        timeout: test.timeout || DEFAULT_TIMEOUT,
      });

      if (res.status !== 200) {
        throw new Error(`API returned ${res.status}: ${JSON.stringify(res.data).substring(0, 200)}`);
      }

      const response = typeof res.data === 'string' ? res.data : (res.data.text || res.data.response || JSON.stringify(res.data));
      const components = extractComponents(response);

      if (verbose) {
        console.log(`\n    Response: ${response.substring(0, 200)}...`);
        console.log(`    Components: ${components.length}`);
      }

      // Run test checks
      await test.checks(components, response);

      console.log('✓');
      passed++;
    } catch (e) {
      console.log(`✗ ${e.message}`);
      failed++;
      failures.push({ test: test.name, error: e.message });
    }
  }

  console.log(`\n  Results: ${passed} passed, ${failed} failed, ${tests.length} total`);
  if (failures.length > 0) {
    console.log('  Failures:');
    for (const f of failures) {
      console.log(`    - ${f.test}: ${f.error}`);
    }
  }

  return { suiteName, passed, failed, total: tests.length, failures };
}

module.exports = {
  fetchJson,
  extractComponents,
  assert,
  assertComponent,
  AssertionError,
  runSuite,
  API_BASE,
  DEFAULT_TIMEOUT,
};
