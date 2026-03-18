/**
 * Page Composition Skill — guidance for building full-screen page layouts
 *
 * Teaches the bot how to use `render_page` to create multi-section
 * page layouts (dashboards, kanban boards, CRM, settings panels, etc.)
 */

export const PAGE_COMPOSITION_SKILL = {
  name: "page-composition",
  description:
    "Guide for building full-screen page layouts with render_page — page types, sections, composition patterns",
  content: `## Page Composition Guide

### Overview
\`render_page\` creates full-screen multi-section layouts. Pages auto-open in a fullscreen overlay (chat stays visible on the left). Users can UNGROUP a page back to individual canvas cards.

### Page Types & Sections

#### dashboard
KPI overview + analytics. Sections:
- \`header\` (row) — 1-2 components: header, breadcrumbs
- \`kpi_row\` (row) — 1-6 components: metric_card, statistic
- \`charts\` (grid) — 1-6 components: chart (bar, line, area, pie)
- \`tables\` (stack) — 0-4 components: data_table, spreadsheet

\`\`\`json
{
  "type": "dashboard",
  "title": "Sales Dashboard",
  "subtitle": "Q1 2025 Overview",
  "sections": {
    "header": [{"component": "header", "props": {"title": "Sales Dashboard", "subtitle": "Q1 2025"}}],
    "kpi_row": [
      {"component": "metric_card", "props": {"label": "Revenue", "value": "$1.2M", "change": "+15%"}},
      {"component": "metric_card", "props": {"label": "Orders", "value": "3,847", "change": "+8%"}},
      {"component": "metric_card", "props": {"label": "Conversion", "value": "3.2%", "change": "-0.5%"}}
    ],
    "charts": [
      {"component": "chart", "props": {"type": "area", "title": "Revenue Trend", "data": [{"month": "Jan", "revenue": 380000}], "dataKeys": ["revenue"], "xAxisKey": "month"}}
    ],
    "tables": [
      {"component": "data_table", "props": {"title": "Top Deals", "columns": ["Deal", "Value", "Stage"], "rows": [["Acme Corp", "$120K", "Closing"]]}}
    ]
  }
}
\`\`\`

#### settings
Config panel with sidebar nav. Sections:
- \`sidebar_nav\` (sidebar) — 1 component: list or button_group for navigation
- \`content_area\` (stack) — 1-10 components: form, card, accordion, key_value

\`\`\`json
{
  "type": "settings",
  "title": "Account Settings",
  "sections": {
    "sidebar_nav": [{"component": "list", "props": {"items": [{"text": "Profile"}, {"text": "Billing"}, {"text": "Notifications"}]}}],
    "content_area": [
      {"component": "form", "props": {"title": "Profile", "fields": [{"name": "name", "label": "Full Name", "type": "text"}], "submitLabel": "Save"}}
    ]
  },
  "navigation": {"tabs": ["Profile", "Billing", "Notifications"]}
}
\`\`\`

#### kanban
Task/project board. Sections:
- \`header\` (row) — 1-2 components: header, button_group
- \`columns\` (row) — 2-8 components: each is a list or card representing a column

\`\`\`json
{
  "type": "kanban",
  "title": "Sprint Board",
  "sections": {
    "header": [{"component": "header", "props": {"title": "Sprint 14", "subtitle": "Mar 1-15"}}],
    "columns": [
      {"component": "list", "props": {"title": "To Do", "items": [{"text": "Auth flow", "badge": "P1"}]}},
      {"component": "list", "props": {"title": "In Progress", "items": [{"text": "Dashboard", "badge": "P2"}]}},
      {"component": "list", "props": {"title": "Done", "items": [{"text": "API setup", "badge": "P3"}]}}
    ]
  }
}
\`\`\`

#### crm
Contact management. Sections:
- \`header\` (row) — 1-2 components
- \`summary\` (row) — 1-6 metric_cards
- \`contacts\` (grid) — 1-4 components: data_table, list, card
- \`activity\` (stack) — 0-4 components: timeline, list

#### landing
Marketing page. Sections:
- \`hero\` (stack) — 1-3 components: header, image, card
- \`features\` (grid) — 1-8 components: card, metric_card
- \`testimonials\` (row) — 0-6 components: blockquote, card
- \`cta\` (stack) — 1-2 components: card, button_group, form

#### data_explorer
Data browsing. Sections:
- \`filters\` (sidebar) — 1-4 components: form, list, button_group
- \`data_view\` (stack) — 1-4 components: data_table, spreadsheet, chart
- \`detail\` (stack) — 0-4 components: key_value, descriptions, card

#### form_wizard
Multi-step form. Sections:
- \`steps\` (row) — 1 component: steps (step indicator)
- \`form_area\` (stack) — 1-6 components: form, card, alert
- \`actions\` (row) — 1-3 components: button_group

### Composition Rules
1. **Section IDs must match** the template's section definitions
2. **Each section** contains an array of standard components (chart, data_table, metric_card, etc.)
3. **Section layout** determines arrangement: "row" = horizontal, "grid" = 2-3 col grid, "sidebar" = narrow left panel, "stack" = vertical
4. **Navigation** — only \`settings\` uses \`navigation.tabs\` by default, but any page can add it
5. **Respect min/max children** for each section

### When to Use Pages vs Individual Cards
- **Use \`render_page\`** for: dashboards, admin panels, settings, kanban boards, multi-step workflows, CRM views, landing pages
- **Use individual \`render_ui\`** for: single visualizations, quick answers, one-off components
- **Rule of thumb**: if you need 4+ related components that form a cohesive view, use a page`,
};
