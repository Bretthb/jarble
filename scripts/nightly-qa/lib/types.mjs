/**
 * Shared types and constants for the Nightly QA system.
 */

export const TestStatus = Object.freeze({
  PASS: "pass",
  FAIL: "fail",
  WARN: "warn",
  SKIP: "skip",
});

/**
 * Create a test step result object.
 * @param {string} name — Human-readable step description
 * @param {string} status — One of TestStatus values
 * @param {object} details — Arbitrary metadata (loadTime, error, text, etc.)
 * @returns {{ name: string, status: string, details: object, timestamp: string }}
 */
export function testStep(name, status, details = {}) {
  return {
    name,
    status,
    details,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Standard viewport presets.
 */
export const Viewports = Object.freeze({
  DESKTOP: { width: 1440, height: 900 },
  TABLET: { width: 768, height: 1024 },
  MOBILE: { width: 375, height: 812 },
  MOBILE_LANDSCAPE: { width: 812, height: 375 },
});

/**
 * Max durations (ms) before a test step is flagged as WARN.
 */
export const Thresholds = Object.freeze({
  PAGE_LOAD: 5000,
  API_CALL: 3000,
  NAVIGATION: 8000,
  INTERACTION: 2000,
});

/**
 * Persona metadata registry — used by the orchestrator and reporter.
 */
export const PersonaRegistry = [
  { id: "01-new-developer",       name: "New Developer",       icon: "code",         description: "First-time user discovering the platform" },
  { id: "02-business-user",       name: "Business User",       icon: "briefcase",    description: "Non-technical user exploring dashboards and billing" },
  { id: "03-power-user",          name: "Power User",          icon: "zap",          description: "Experienced user testing chat, canvas, and history" },
  { id: "04-mobile-user",         name: "Mobile User",         icon: "smartphone",   description: "Mobile viewport testing across key flows" },
  { id: "05-stress-tester",       name: "Stress Tester",       icon: "activity",     description: "Rapid API calls, large payloads, concurrency" },
  { id: "06-accessibility",       name: "Accessibility",       icon: "eye",          description: "Keyboard navigation, ARIA, focus management" },
  { id: "07-international",       name: "International",       icon: "globe",        description: "Unicode, long text, special characters, RTL" },
  { id: "08-billing-user",        name: "Billing User",        icon: "credit-card",  description: "Pricing, checkout flow, billing portal" },
  { id: "09-marketplace-creator", name: "Marketplace Creator", icon: "shopping-bag",  description: "Browse marketplace, component and service details" },
  { id: "10-flow-builder",        name: "Flow Builder",        icon: "git-branch",   description: "Deployments page, flow canvas, flow creation" },
  { id: "11-multi-deploy",        name: "Multi Deploy",        icon: "layers",       description: "Multiple deployments, resource map, linked keys" },
  { id: "12-api-consumer",        name: "API Consumer",        icon: "terminal",     description: "Direct tRPC and REST API calls without browser" },
  { id: "13-admin-panel",        name: "Admin Panel Tester",  icon: "shield",       description: "Admin area — sidebar, data tables, audit log, system health" },
  { id: "14-deployment-config",  name: "Deployment Config",   icon: "sliders",      description: "Deployment configuration sidebar — Model, Platform, Advanced tabs" },
  { id: "15-theme-tester",       name: "Theme Tester",        icon: "palette",      description: "Theme switching, CSS variables, responsive styling" },
  { id: "16-file-knowledge",     name: "File & Knowledge",    icon: "folder",       description: "File management and knowledge panel features" },
  { id: "17-conversation-manager", name: "Conversation Manager", icon: "message-square", description: "Conversation history — sidebar, new chat, switching, localStorage" },
  { id: "18-component-gallery",  name: "Component Gallery",   icon: "layout",       description: "Canvas components — catalog, rendering, hydration" },
  { id: "19-deployment-creator", name: "Deployment Creator",  icon: "rocket",       description: "Full wizard flow — creates, verifies, and cleans up a deployment" },
  { id: "20-chat-tester",        name: "Chat Tester",         icon: "message-circle", description: "Sends messages, verifies streaming responses, tests conversation switching" },
  { id: "21-file-uploader",      name: "File Uploader",       icon: "upload",       description: "Uploads files, verifies round-trip, tests knowledge panel" },
  { id: "22-flow-runner",        name: "Flow Runner",         icon: "play",         description: "Creates, runs, duplicates, and cleans up flows" },
  { id: "23-config-editor",      name: "Config Editor",       icon: "edit",         description: "Edits deployment config, changes system prompt, inspects all tabs" },
  { id: "24-canvas-interactor",  name: "Canvas Interactor",   icon: "move",         description: "Generates canvas cards, context menus, zoom, drag, close" },
  { id: "25-chaos-monkey",       name: "Chaos Monkey",        icon: "alert-triangle", description: "Randomized adversarial testing — XSS, malformed data, unauthorized access" },
];
