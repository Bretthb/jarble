/**
 * Page Templates
 *
 * The 7 built-in page layout templates. Each defines the sections
 * and their layout behavior for a specific page type.
 */

import type { PageType, PageTemplateDef } from "./types.js";

export const PAGE_TEMPLATES: Record<PageType, PageTemplateDef> = {
  dashboard: {
    type: "dashboard",
    label: "Dashboard",
    description: "KPI overview with charts and tables — ideal for analytics and monitoring",
    sections: [
      { id: "header", label: "Header", layout: "row", minChildren: 1, maxChildren: 2 },
      { id: "kpi_row", label: "KPIs", layout: "row", minChildren: 1, maxChildren: 6 },
      { id: "charts", label: "Charts", layout: "grid", minChildren: 1, maxChildren: 6 },
      { id: "tables", label: "Tables", layout: "stack", minChildren: 0, maxChildren: 4 },
    ],
    hasNavigation: false,
  },

  settings: {
    type: "settings",
    label: "Settings",
    description: "Configuration panel with sidebar navigation and content area",
    sections: [
      { id: "sidebar_nav", label: "Navigation", layout: "sidebar", minChildren: 1, maxChildren: 1 },
      { id: "content_area", label: "Content", layout: "stack", minChildren: 1, maxChildren: 10 },
    ],
    hasNavigation: true,
  },

  kanban: {
    type: "kanban",
    label: "Kanban Board",
    description: "Task or project board with draggable columns — ideal for workflow management",
    sections: [
      { id: "header", label: "Header", layout: "row", minChildren: 1, maxChildren: 2 },
      { id: "columns", label: "Columns", layout: "row", minChildren: 2, maxChildren: 8 },
    ],
    hasNavigation: false,
  },

  crm: {
    type: "crm",
    label: "CRM",
    description: "Contact management with summary metrics, contact grid, and activity feed",
    sections: [
      { id: "header", label: "Header", layout: "row", minChildren: 1, maxChildren: 2 },
      { id: "summary", label: "Summary", layout: "row", minChildren: 1, maxChildren: 6 },
      { id: "contacts", label: "Contacts", layout: "grid", minChildren: 1, maxChildren: 4 },
      { id: "activity", label: "Activity", layout: "stack", minChildren: 0, maxChildren: 4 },
    ],
    hasNavigation: false,
  },

  landing: {
    type: "landing",
    label: "Landing Page",
    description: "Marketing or informational page with hero, features, testimonials, and CTA",
    sections: [
      { id: "hero", label: "Hero", layout: "stack", minChildren: 1, maxChildren: 3 },
      { id: "features", label: "Features", layout: "grid", minChildren: 1, maxChildren: 8 },
      { id: "testimonials", label: "Testimonials", layout: "row", minChildren: 0, maxChildren: 6 },
      { id: "cta", label: "Call to Action", layout: "stack", minChildren: 1, maxChildren: 2 },
    ],
    hasNavigation: false,
  },

  data_explorer: {
    type: "data_explorer",
    label: "Data Explorer",
    description: "Data browsing interface with filters sidebar, main data view, and detail panel",
    sections: [
      { id: "filters", label: "Filters", layout: "sidebar", minChildren: 1, maxChildren: 4 },
      { id: "data_view", label: "Data View", layout: "stack", minChildren: 1, maxChildren: 4 },
      { id: "detail", label: "Detail", layout: "stack", minChildren: 0, maxChildren: 4 },
    ],
    hasNavigation: false,
  },

  form_wizard: {
    type: "form_wizard",
    label: "Form Wizard",
    description: "Multi-step form with step indicator, form area, and action buttons",
    sections: [
      { id: "steps", label: "Steps", layout: "row", minChildren: 1, maxChildren: 1 },
      { id: "form_area", label: "Form", layout: "stack", minChildren: 1, maxChildren: 6 },
      { id: "actions", label: "Actions", layout: "row", minChildren: 1, maxChildren: 3 },
    ],
    hasNavigation: false,
  },
};
