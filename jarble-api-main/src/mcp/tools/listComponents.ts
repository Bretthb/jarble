/**
 * list_components MCP Tool — Discover available UI components (built-in + custom).
 *
 * Returns a data_table showing all components the bot can use with render_ui.
 */
import { listComponentsOnPvc } from "../../k8s/index.js";
import { BUILTIN_COMPONENTS } from "../../utils/componentResolver.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  card: "Simple card with title, subtitle, and body text",
  data_table: "Table with column headers and data rows",
  stat_grid: "Grid of metric cards with labels, values, and optional change indicators",
  key_value: "List of key-value pairs",
  code_block: "Syntax-highlighted code snippet",
  alert: "Notification banner (info, success, warning, error)",
  progress: "Progress bar with label and percentage",
  image: "Image with optional alt text and caption",
  layout: "Container that renders an array of child components",
  chart: "Bar, line, pie, or area chart (Recharts)",
  tabs: "Tabbed content with optional nested components",
  accordion: "Collapsible sections (single or multiple open)",
  badge: "Small label/tag with variant styling",
  list: "Structured list with icons, descriptions, and badges",
  timeline: "Event timeline with status indicators",
  divider: "Visual separator with optional label",
  avatar: "User avatar with name and optional image",
  blockquote: "Styled quotation with attribution",
  metric_card: "Single metric display with change indicator and sparkline",
  header: "Section heading with optional subtitle and divider",
  button_group: "Interactive action buttons with click callbacks",
  form: "Interactive input form with various field types and submit callback",
  gauge: "Gauge/speedometer chart (Ant Design)",
  radar: "Radar/spider chart for multi-axis comparison (Ant Design)",
  treemap: "Treemap visualization for hierarchical data (Ant Design)",
  funnel: "Conversion funnel chart (Ant Design)",
  waterfall: "Waterfall chart for cumulative values (Ant Design)",
  scatter: "Scatter plot for correlation analysis (Ant Design)",
  steps: "Process/wizard steps with current progress (Ant Design)",
  result: "Outcome display with status icon (Ant Design)",
  tree: "Hierarchical tree view with expand/collapse (Ant Design)",
  calendar_heatmap: "Calendar heatmap for date-based data (Ant Design)",
  descriptions: "Description list with labeled values in rows (Ant Design)",
  code_editor: "Monaco code editor with syntax highlighting",
  map: "Interactive Leaflet map with markers",
  carousel: "Image/content carousel with navigation",
  stock: "Candlestick/OHLC chart for financial data (Ant Design)",
  sankey: "Sankey flow/transfer diagram (Ant Design)",
  sunburst: "Sunburst hierarchical pie chart (Ant Design)",
  heatmap: "Heatmap grid visualization (Ant Design)",
  wordcloud: "Word cloud for text/keyword frequency (Ant Design)",
  histogram: "Histogram for distribution analysis (Ant Design)",
  box: "Box plot for statistical distribution (Ant Design)",
  liquid: "Liquid fill gauge (Ant Design)",
  rose: "Nightingale/polar area rose chart (Ant Design)",
  dual_axes: "Dual Y-axis chart for comparing two metrics (Ant Design)",
  bullet: "Bullet chart for KPI vs target comparison (Ant Design)",
  radial_bar: "Circular/radial bar chart (Ant Design)",
  venn: "Venn diagram for set overlap (Ant Design)",
  circle_packing: "Circle packing for nested hierarchy (Ant Design)",
  statistic: "Polished KPI statistic display with optional countdown (antd)",
  tag_cloud: "Colored tag collection for categorization (antd)",
  video: "Video player supporting YouTube, Vimeo, MP4, etc. (react-player)",
  image_gallery: "Multi-image grid with lightbox preview",
  audio: "HTML5 audio player",
  spreadsheet: "Editable Excel-like spreadsheet grid (fortune-sheet)",
  sandbox: "Sandboxed iframe for custom HTML/CSS/JS mini-apps — render anything",
};

export const listComponentsTool: McpTool = {
  name: "list_components",
  description:
    "List all available UI components (built-in + custom). Shows component names, types, and descriptions.",
  parameters: {
    type: "object",
    properties: {},
  },
  rendersComponent: "canvas_block",
  async execute(
    _params: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    // Gather custom components from PVC
    const customComponents = await listComponentsOnPvc(ctx.deploymentId);

    // Build rows: built-in first, then custom
    const rows: Array<[string, string, string]> = [];

    for (const name of BUILTIN_COMPONENTS) {
      rows.push([name, "built-in", BUILTIN_DESCRIPTIONS[name] || ""]);
    }

    for (const comp of customComponents) {
      rows.push([comp.name, "custom", comp.description || ""]);
    }

    const summary = `${BUILTIN_COMPONENTS.size} built-in + ${customComponents.length} custom component(s) available.`;

    return {
      success: true,
      message: summary,
      data: {
        component: "data_table",
        props: {
          title: "Available Components",
          columns: ["Name", "Type", "Description"],
          rows,
        },
      },
    };
  },
};
