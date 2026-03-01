/**
 * Component Manifest Types
 *
 * Defines the shape of a component manifest entry — the single source of truth
 * for component metadata across frontend, API, MCP server, and prompt generation.
 */

export type LayoutHintType = "full-width" | "half" | "third" | "compact" | "auto";

export type ComponentCategory = "display" | "chart" | "interactive" | "media" | "specialized";

export type LoadingStrategy = "static" | "dynamic";

export interface ComponentManifestEntry {
  /** Canonical component name (e.g. "chart", "data_table") */
  name: string;
  /** Human-readable description shown in list_components */
  description: string;
  /** One-line prop documentation for prompt reference and component_reference tool */
  reference: string;
  /** Component category for grouping in the reference tool */
  category: ComponentCategory;
  /** Layout defaults */
  layout: {
    /** Suggested column span for the dashboard grid */
    defaultHint: LayoutHintType;
    /** Default pixel size for canvas cards */
    defaultSize: { w: number; h: number };
  };
  /** Whether component is dynamically imported (lazy-loaded) on the frontend */
  loading: LoadingStrategy;
  /** Whether component is expensive to render (sandbox, map, code_editor) */
  expensive: boolean;
  /** Alternative names the LLM might use (e.g. "graph" for "chart") */
  aliases: string[];
  /** If this component can be split into individual cards */
  splittable?: { into: string; propsKey: string };
  /** Searchable tags */
  tags: string[];
  /** Whether this is a built-in component (vs. user-defined custom component) */
  builtin: boolean;
  /** Rendering order in dashboard (1=first, 10=last). Used by the prompt to guide emission order. */
  renderOrder: number;
  /** Extra guidance for the LLM prompt about when to use this component */
  promptGuidance?: string;
}
