---
name: Page component routing & sandbox interactivity issues
description: Playwright testing revealed sandbox tab switching broken (bot forgets onclick handlers) and page component has no runtime routing
type: project
---

## Page Component & Sandbox Interactivity (Mar 20, 2026)

### Playwright Test Results

**Bot response pipeline works end-to-end:**
- Chat → SSE streaming → reasoning display → orchestration steps → sandbox render on canvas
- Dashboard with 3 metric cards + bar chart rendered correctly
- Settings page with tabs/forms rendered visually

**Two issues found:**

### 1. Sandbox Tab Switching Broken — Bot Forgets onclick Handlers

The bot generates `showTab(id, btn)` JS function inside the sandbox `js` prop, but the HTML buttons have NO `onclick` attributes:

```html
<!-- What the bot generates: -->
<button class="tab active">Profile</button>

<!-- What it should generate: -->
<button class="tab active" onclick="showTab('profile', this)">Profile</button>
```

**Root cause:** LLM generation quality issue, NOT a platform bug. The sandbox correctly injects and executes the JS — the functions exist globally. The bot just forgets to wire them to elements.

**Fix:** Add to `sandbox-mastery.ts` skill or JARBLE_UI_PROMPT anti-patterns:
```
SANDBOX JS WIRING: When you define JS functions (showTab, toggleSwitch, etc.),
ALWAYS add onclick/onchange handlers to the HTML elements that call them.
Functions without event handlers do nothing.
```

### 2. Native `page` Component Has No Runtime Routing

The `page` component (CanvasPage.tsx) supports 7 layout types:
- dashboard, settings, kanban, crm, landing, data_explorer, form_wizard

But tabs/navigation are **static** — `navigation.activeTab` is set at render time.
The Settings layout renders a sidebar nav but tabs are just styled divs (not clickable).
No client-side router, no URL-based navigation within a page.

**Fix options:**
1. Add state management to CanvasPage for tab switching (useState + onClick)
2. Use the `tabs` component instead (it already has interactive tab switching)
3. Keep pages static and use sandbox for interactive multi-view UIs

**Why:** The bot currently uses `sandbox` for everything interactive because it gives full JS control. The native `page` component is only useful for static layouts.

### 3. Bot Prefers Sandbox Over Native Components

Both dashboard and settings requests produced `sandbox` (iframe) components rather than native `page`, `metric_card`, `chart` etc. This is by design — the bot's prompt guides toward sandbox for complex multi-component layouts. But it means:
- Components render in isolated iframes (no theme inheritance)
- Artifacts are opaque (can't inspect/edit individual sub-components)
- Performance overhead of iframe per component

**How to apply:** Consider adding routing/interactivity to the native `page` component so the bot has a reason to use it instead of always falling back to sandbox.
