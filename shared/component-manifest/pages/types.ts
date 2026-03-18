/**
 * Page System Types
 *
 * Defines types for the full-screen multi-component page layout system.
 * Pages are composed of sections, each containing child components.
 */

/** The 7 built-in page layout types */
export type PageType = "dashboard" | "settings" | "kanban" | "crm" | "landing" | "data_explorer" | "form_wizard";

/** A section within a page — contains child components */
export interface PageSectionDef {
  /** Section identifier (unique within the page) */
  id: string;
  /** Display label for the section */
  label: string;
  /** Layout hint for the section: "row" | "grid" | "sidebar" | "stack" */
  layout: "row" | "grid" | "sidebar" | "stack";
  /** Min number of children */
  minChildren?: number;
  /** Max number of children */
  maxChildren?: number;
}

/** A page template definition */
export interface PageTemplateDef {
  type: PageType;
  label: string;
  description: string;
  /** Section definitions — what sections this page type has */
  sections: PageSectionDef[];
  /** Whether the page supports tab/sidebar navigation */
  hasNavigation: boolean;
}
