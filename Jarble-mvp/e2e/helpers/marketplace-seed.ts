/**
 * Marketplace E2E Test Data Seeder
 *
 * Seeds the SQLite DB with comprehensive marketplace test data for live E2E tests.
 * Includes components across tiers/categories, services for all 3 hosting models,
 * and cross-deployment install scenarios.
 *
 * Usage: call seedMarketplaceData() in test.beforeAll(), cleanMarketplaceData() in test.afterAll()
 */

import path from "node:path";

// Resolve the DB path relative to the monorepo root
const DB_PATH = path.resolve(__dirname, "../../../jarble-api-main/local.db");

// ── Test Data Constants ──────────────────────────────────────────────────

export const TEST_USER_ID = "xEoIkJ6-VSwd"; // existing test user
export const TEST_CREATOR_ID = "cp_test001"; // existing creator profile

export const DEPLOYMENT_1 = "3vt3ej3hj1oi"; // test1
export const DEPLOYMENT_2 = "42puqb1asrdx"; // test2

// Prefix all E2E-seeded IDs to distinguish from manually created data
const E2E = "e2e_";

// ── Components ───────────────────────────────────────────────────────────

export const COMPONENTS = {
  clock: {
    id: `${E2E}cmp_clock`,
    name: "live-clock",
    displayName: "Live Clock Widget",
    description: "A real-time analog/digital clock with timezone support and customizable themes",
    botDescription: "Use live-clock to display a real-time clock with timezone support",
    tier: "sandbox",
    category: "utility",
    tags: '["clock","time","widget","realtime"]',
    pricingModel: "free",
    priceUsdCents: 0,
    exampleProps: JSON.stringify({
      html: '<div id="clock"></div>',
      css: "#clock { font-size: 48px; font-family: monospace; text-align: center; padding: 40px; }",
      js: "setInterval(() => { document.getElementById('clock').textContent = new Date().toLocaleTimeString(); }, 1000);",
      title: "{{title}}",
    }),
  },
  todoList: {
    id: `${E2E}cmp_todo`,
    name: "todo-list",
    displayName: "Smart Todo List",
    description: "A productivity todo list with drag-and-drop, priorities, and due dates",
    botDescription: null,
    tier: "template",
    category: "utility",
    tags: '["productivity","todo","list"]',
    pricingModel: "free",
    priceUsdCents: 0,
    exampleProps: JSON.stringify({
      layout: [
        { component: "list", props: { title: "{{title}}", items: "{{items}}", ordered: true } },
      ],
    }),
  },
  liveChart: {
    id: `${E2E}cmp_chart`,
    name: "live-data-chart",
    displayName: "Live Data Chart",
    description: "Real-time updating chart with WebSocket support and multiple series",
    botDescription: "Use live-data-chart for real-time data visualization",
    tier: "sandbox",
    category: "visualization",
    tags: '["chart","realtime","data","visualization"]',
    pricingModel: "paid",
    priceUsdCents: 499,
    exampleProps: JSON.stringify({
      html: '<canvas id="chart"></canvas>',
      css: "canvas { width: 100%; height: 300px; }",
      js: "// chart rendering code",
      title: "{{title}}",
    }),
  },
  contactForm: {
    id: `${E2E}cmp_form`,
    name: "smart-contact-form",
    displayName: "Smart Contact Form",
    description: "AI-powered contact form with validation, spam detection, and auto-response",
    botDescription: null,
    tier: "template",
    category: "form",
    tags: '["form","contact","validation"]',
    pricingModel: "free",
    priceUsdCents: 0,
    exampleProps: JSON.stringify({
      layout: [
        {
          component: "form",
          props: {
            title: "{{title}}",
            fields: [
              { name: "name", label: "Name", type: "text", required: true },
              { name: "email", label: "Email", type: "email", required: true },
              { name: "message", label: "Message", type: "textarea", required: true },
            ],
            submitLabel: "Send",
          },
        },
      ],
    }),
  },
  imageSlider: {
    id: `${E2E}cmp_slider`,
    name: "image-carousel-pro",
    displayName: "Image Carousel Pro",
    description: "Professional image carousel with thumbnails, zoom, and touch gestures",
    botDescription: "Use image-carousel-pro for professional image galleries",
    tier: "sandbox",
    category: "media",
    tags: '["image","carousel","gallery","media"]',
    pricingModel: "paid",
    priceUsdCents: 299,
    exampleProps: JSON.stringify({
      html: '<div id="carousel"></div>',
      css: "#carousel { width: 100%; height: 400px; }",
      js: "// carousel code",
      title: "{{title}}",
    }),
  },
} as const;

// ── Component Versions ───────────────────────────────────────────────────

export const VERSIONS = Object.fromEntries(
  Object.entries(COMPONENTS).map(([key, comp]) => [
    key,
    {
      id: `${E2E}ver_${key}`,
      componentId: comp.id,
      version: "1.0.0",
      changelog: "Initial release",
      packageUrl: `local://e2e/${comp.name}.json`,
      packageSizeBytes: 2048,
      manifestHash: `sha256-e2e-${key}`,
      status: "published",
    },
  ]),
);

// ── Services ─────────────────────────────────────────────────────────────

export const SERVICES = {
  selfHosted: {
    id: `${E2E}pkg_selfhosted`,
    name: "productivity-toolkit",
    displayName: "Productivity Toolkit",
    description: "Complete productivity bundle with clock, todo list, and contact form. Self-hosted on your own pod.",
    hostingModel: "self_hosted",
    instructionSnippet:
      "When users ask about productivity tools, offer the live-clock for time management, todo-list for task tracking, and smart-contact-form for team communication.",
    remoteApiEndpoint: null,
    remoteApiConfig: null,
    status: "published",
    pricingModel: "free",
    priceUsdCents: 0,
    totalInstalls: 5,
    remoteHealth: "unknown",
    // Links to: clock, todoList, contactForm components + Web Search, Calculator skills
  },
  remote: {
    id: `${E2E}pkg_remote`,
    name: "cloud-analytics-api",
    displayName: "Cloud Analytics API",
    description: "Cloud-hosted analytics service with real-time dashboards and data visualization. All processing runs on our servers.",
    hostingModel: "remote",
    instructionSnippet:
      "For analytics requests, use the live-data-chart component. Data is fetched from the Cloud Analytics API automatically.",
    remoteApiEndpoint: "https://api.analytics.example.com/v1",
    remoteApiConfig: JSON.stringify({
      version: "1.0.0",
      endpoint: "https://api.analytics.example.com/v1",
      healthEndpoint: "https://api.analytics.example.com/health",
      auth: { type: "api_key", headerName: "X-API-Key" },
      skills: [{ name: "Data Query" }, { name: "Report Generator" }],
      rateLimits: { requestsPerMinute: 60, requestsPerDay: 10000 },
    }),
    status: "published",
    pricingModel: "paid",
    priceUsdCents: 999,
    totalInstalls: 12,
    remoteHealth: "healthy",
    // Links to: liveChart component + Web Search skill
  },
  hybrid: {
    id: `${E2E}pkg_hybrid`,
    name: "media-studio-suite",
    displayName: "Media Studio Suite",
    description: "Hybrid media service - image processing runs in the cloud, UI components render locally on your pod.",
    hostingModel: "hybrid",
    instructionSnippet:
      "For image-related requests, use image-carousel-pro for display. Heavy image processing is handled by the cloud API.",
    remoteApiEndpoint: "https://media.studio.example.com/api",
    remoteApiConfig: JSON.stringify({
      version: "1.0.0",
      endpoint: "https://media.studio.example.com/api",
      healthEndpoint: "https://media.studio.example.com/health",
      auth: { type: "bearer", headerName: "Authorization" },
      skills: [{ name: "Image Processing" }],
      rateLimits: { requestsPerMinute: 30 },
    }),
    status: "published",
    pricingModel: "freemium",
    priceUsdCents: 0,
    totalInstalls: 8,
    remoteHealth: "healthy",
    // Links to: imageSlider, clock components + Weather skill
  },
} as const;

// Service → Component links
export const SERVICE_COMPONENTS = [
  // selfHosted: clock, todoList, contactForm
  { packageId: SERVICES.selfHosted.id, componentId: COMPONENTS.clock.id },
  { packageId: SERVICES.selfHosted.id, componentId: COMPONENTS.todoList.id },
  { packageId: SERVICES.selfHosted.id, componentId: COMPONENTS.contactForm.id },
  // remote: liveChart
  { packageId: SERVICES.remote.id, componentId: COMPONENTS.liveChart.id },
  // hybrid: imageSlider, clock
  { packageId: SERVICES.hybrid.id, componentId: COMPONENTS.imageSlider.id },
  { packageId: SERVICES.hybrid.id, componentId: COMPONENTS.clock.id },
];

// Service → Skill links (using existing skill IDs from the DB seed)
export const SERVICE_SKILLS = [
  // selfHosted: Web Search, Calculator
  { packageId: SERVICES.selfHosted.id, skillId: "_Se1q7mSjr_0TBLy0BQRe" },
  { packageId: SERVICES.selfHosted.id, skillId: "8nNnZX5dw_IGRf6fYEpN4" },
  // remote: Web Search
  { packageId: SERVICES.remote.id, skillId: "_Se1q7mSjr_0TBLy0BQRe" },
  // hybrid: Weather
  { packageId: SERVICES.hybrid.id, skillId: "A0eH0RGNLyie9Gfi0DxYa" },
];

// ── Seed & Cleanup Functions ─────────────────────────────────────────────

let _db: any = null;

function getDb() {
  if (!_db) {
    // Dynamic import from jarble-api-main's node_modules - better-sqlite3 is a native module
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require(path.resolve(__dirname, "../../../jarble-api-main/node_modules/better-sqlite3"));
    _db = new Database(DB_PATH);
  }
  return _db;
}

export function seedMarketplaceData() {
  const db = getDb();
  const now = new Date().toISOString();

  // Insert components
  const insertComp = db.prepare(`
    INSERT OR REPLACE INTO marketplace_components
    (id, creator_id, name, display_name, description, bot_description, tier, category, tags,
     props_schema, example_props, pricing_model, price_usd_cents, current_version,
     status, total_installs, average_rating, rating_count, published_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, '1.0.0', 'published', 1, NULL, 0, ?, ?, ?)
  `);

  for (const comp of Object.values(COMPONENTS)) {
    insertComp.run(
      comp.id, TEST_USER_ID, comp.name, comp.displayName, comp.description,
      comp.botDescription, comp.tier, comp.category, comp.tags,
      comp.exampleProps, comp.pricingModel, comp.priceUsdCents,
      now, now, now,
    );
  }

  // Insert component versions
  const insertVer = db.prepare(`
    INSERT OR REPLACE INTO component_versions
    (id, component_id, version, changelog, package_url, package_size_bytes, manifest_hash, status, download_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);

  for (const ver of Object.values(VERSIONS)) {
    insertVer.run(ver.id, ver.componentId, ver.version, ver.changelog, ver.packageUrl, ver.packageSizeBytes, ver.manifestHash, ver.status, now);
  }

  // Insert services
  const insertSvc = db.prepare(`
    INSERT OR REPLACE INTO marketplace_packages
    (id, creator_id, name, display_name, description, hosting_model, instruction_snippet,
     remote_api_endpoint, remote_api_config, status, pricing_model, price_usd_cents,
     total_installs, avg_rating, remote_health, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
  `);

  for (const svc of Object.values(SERVICES)) {
    insertSvc.run(
      svc.id, TEST_CREATOR_ID, svc.name, svc.displayName, svc.description,
      svc.hostingModel, svc.instructionSnippet,
      svc.remoteApiEndpoint, svc.remoteApiConfig,
      svc.status, svc.pricingModel, svc.priceUsdCents,
      svc.totalInstalls, svc.remoteHealth,
      now, now,
    );
  }

  // Insert service ↔ component links
  const insertSvcComp = db.prepare(`
    INSERT OR REPLACE INTO package_components (package_id, component_id)
    VALUES (?, ?)
  `);
  for (const link of SERVICE_COMPONENTS) {
    insertSvcComp.run(link.packageId, link.componentId);
  }

  // Insert service ↔ skill links
  const insertSvcSkill = db.prepare(`
    INSERT OR REPLACE INTO package_skills (package_id, skill_id)
    VALUES (?, ?)
  `);
  for (const link of SERVICE_SKILLS) {
    insertSvcSkill.run(link.packageId, link.skillId);
  }

  console.log("[E2E Seed] Seeded marketplace data: 5 components, 3 services (self-hosted, remote, hybrid)");
}

export function cleanMarketplaceData() {
  const db = getDb();

  // Clean in reverse dependency order
  db.prepare(`DELETE FROM package_skills WHERE package_id LIKE '${E2E}%'`).run();
  db.prepare(`DELETE FROM package_components WHERE package_id LIKE '${E2E}%'`).run();
  db.prepare(`DELETE FROM package_installs WHERE package_id LIKE '${E2E}%'`).run();
  db.prepare(`DELETE FROM component_installs WHERE component_id LIKE '${E2E}%'`).run();
  db.prepare(`DELETE FROM component_versions WHERE id LIKE '${E2E}%'`).run();
  db.prepare(`DELETE FROM marketplace_packages WHERE id LIKE '${E2E}%'`).run();
  db.prepare(`DELETE FROM marketplace_components WHERE id LIKE '${E2E}%'`).run();

  console.log("[E2E Seed] Cleaned E2E marketplace data");
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
