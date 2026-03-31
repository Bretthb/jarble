/**
 * Component Library - Seed data for composite UI templates.
 *
 * These ~25 composite definitions are written to each deployment's PVC at
 * `/data/components/{name}.json` during the initial deploy. The bot discovers
 * them via `list_components`, renders them via `render_ui`, and can modify
 * or extend them via `define_component`.
 *
 * Each component uses only the 9 built-in primitives:
 *   card, data_table, stat_grid, key_value, code_block, alert, progress, image, layout
 *
 * Names follow: /^[a-z][a-z0-9_]{0,63}$/
 */

export interface ComponentSeed {
  name: string;
  description: string;
  layout: Array<{ component: string; props: Record<string, unknown> }>;
}

export const COMPONENT_LIBRARY: ComponentSeed[] = [
  // ── Business / CRM ──────────────────────────────────────────────────

  {
    name: "dashboard",
    description: "Dashboard with metrics and data table",
    layout: [
      { component: "stat_grid", props: { stats: "{{stats}}" } },
      { component: "data_table", props: { title: "{{table_title}}", columns: "{{columns}}", rows: "{{rows}}" } },
    ],
  },
  {
    name: "report_card",
    description: "Summary report with title, key metrics, and notes",
    layout: [
      { component: "card", props: { title: "{{title}}", subtitle: "{{subtitle}}" } },
      { component: "stat_grid", props: { stats: "{{stats}}" } },
      { component: "card", props: { body: "{{notes}}" } },
    ],
  },
  {
    name: "invoice",
    description: "Invoice with line items, totals, and payment status",
    layout: [
      { component: "card", props: { title: "Invoice #{{invoice_number}}", subtitle: "{{date}}" } },
      { component: "key_value", props: { title: "Bill To", items: "{{bill_to}}" } },
      { component: "data_table", props: { title: "Line Items", columns: "{{columns}}", rows: "{{rows}}" } },
      { component: "stat_grid", props: { stats: "{{totals}}" } },
      { component: "alert", props: { variant: "{{status_variant}}", title: "Payment Status", message: "{{status_message}}" } },
    ],
  },
  {
    name: "contact_card",
    description: "Contact or customer card with details and notes",
    layout: [
      { component: "card", props: { title: "{{name}}", subtitle: "{{company}}" } },
      { component: "key_value", props: { title: "Contact Info", items: "{{contact_info}}" } },
      { component: "card", props: { body: "{{notes}}" } },
    ],
  },
  {
    name: "sales_pipeline",
    description: "Sales pipeline with stage metrics and deal table",
    layout: [
      { component: "card", props: { title: "{{pipeline_name}}", subtitle: "{{period}}" } },
      { component: "stat_grid", props: { stats: "{{stage_stats}}" } },
      { component: "progress", props: { label: "Pipeline Progress", value: "{{progress_pct}}" } },
      { component: "data_table", props: { title: "Active Deals", columns: "{{columns}}", rows: "{{rows}}" } },
    ],
  },

  // ── Monitoring / Ops ────────────────────────────────────────────────

  {
    name: "status_report",
    description: "Status update with alert banner and key-value details",
    layout: [
      { component: "alert", props: { title: "{{alert_title}}", message: "{{alert_message}}", variant: "{{variant}}" } },
      { component: "key_value", props: { title: "{{details_title}}", items: "{{items}}" } },
    ],
  },
  {
    name: "metrics_overview",
    description: "Metrics overview with progress bars and stats",
    layout: [
      { component: "stat_grid", props: { stats: "{{stats}}" } },
      { component: "progress", props: { label: "{{progress_label}}", value: "{{progress_value}}" } },
    ],
  },
  {
    name: "system_health",
    description: "System health dashboard with status, metrics, and recent incidents",
    layout: [
      { component: "alert", props: { variant: "{{health_variant}}", title: "System Status", message: "{{health_message}}" } },
      { component: "stat_grid", props: { stats: "{{metrics}}" } },
      { component: "data_table", props: { title: "Recent Incidents", columns: "{{columns}}", rows: "{{rows}}" } },
    ],
  },
  {
    name: "incident_report",
    description: "Incident report with severity, timeline, and resolution",
    layout: [
      { component: "alert", props: { variant: "{{severity_variant}}", title: "{{incident_title}}", message: "{{summary}}" } },
      { component: "key_value", props: { title: "Incident Details", items: "{{details}}" } },
      { component: "data_table", props: { title: "Timeline", columns: "{{timeline_columns}}", rows: "{{timeline_rows}}" } },
      { component: "card", props: { title: "Resolution", body: "{{resolution}}" } },
    ],
  },
  {
    name: "resource_monitor",
    description: "Resource utilization monitor with gauges and breakdown",
    layout: [
      { component: "card", props: { title: "{{resource_name}}", subtitle: "{{period}}" } },
      { component: "progress", props: { label: "CPU", value: "{{cpu_pct}}" } },
      { component: "progress", props: { label: "Memory", value: "{{memory_pct}}" } },
      { component: "progress", props: { label: "Storage", value: "{{storage_pct}}" } },
      { component: "stat_grid", props: { stats: "{{stats}}" } },
    ],
  },

  // ── Dev / Engineering ───────────────────────────────────────────────

  {
    name: "code_review",
    description: "Code snippet with context card and notes",
    layout: [
      { component: "card", props: { title: "{{title}}", subtitle: "{{file_path}}" } },
      { component: "code_block", props: { code: "{{code}}", language: "{{language}}", title: "{{code_title}}" } },
      { component: "alert", props: { message: "{{notes}}", variant: "info" } },
    ],
  },
  {
    name: "api_reference",
    description: "API endpoint reference with method, URL, params, and example",
    layout: [
      { component: "card", props: { title: "{{method}} {{endpoint}}", subtitle: "{{description}}" } },
      { component: "key_value", props: { title: "Parameters", items: "{{params}}" } },
      { component: "code_block", props: { title: "Example Request", language: "{{language}}", code: "{{example}}" } },
      { component: "code_block", props: { title: "Response", language: "json", code: "{{response}}" } },
    ],
  },
  {
    name: "changelog",
    description: "Changelog entry with version, date, and categorized changes",
    layout: [
      { component: "card", props: { title: "{{version}}", subtitle: "{{date}}" } },
      { component: "data_table", props: { title: "Changes", columns: "{{columns}}", rows: "{{rows}}" } },
    ],
  },
  {
    name: "error_report",
    description: "Error report with stack trace, context, and suggested fix",
    layout: [
      { component: "alert", props: { variant: "error", title: "{{error_title}}", message: "{{error_message}}" } },
      { component: "code_block", props: { title: "Stack Trace", language: "text", code: "{{stack_trace}}" } },
      { component: "key_value", props: { title: "Context", items: "{{context}}" } },
      { component: "card", props: { title: "Suggested Fix", body: "{{suggestion}}" } },
    ],
  },

  // ── Content ─────────────────────────────────────────────────────────

  {
    name: "profile_card",
    description: "User or entity profile with key-value details",
    layout: [
      { component: "card", props: { title: "{{name}}", subtitle: "{{role}}" } },
      { component: "key_value", props: { items: "{{details}}" } },
    ],
  },
  {
    name: "newsletter",
    description: "Newsletter section with headline, body, and highlights",
    layout: [
      { component: "card", props: { title: "{{headline}}", subtitle: "{{date}}" } },
      { component: "card", props: { body: "{{body}}" } },
      { component: "stat_grid", props: { stats: "{{highlights}}" } },
    ],
  },
  {
    name: "event_summary",
    description: "Event summary with details, agenda, and attendees",
    layout: [
      { component: "card", props: { title: "{{event_name}}", subtitle: "{{date_time}}" } },
      { component: "key_value", props: { title: "Event Details", items: "{{details}}" } },
      { component: "data_table", props: { title: "Agenda", columns: "{{agenda_columns}}", rows: "{{agenda_rows}}" } },
    ],
  },
  {
    name: "faq_entry",
    description: "FAQ entry with question and detailed answer",
    layout: [
      { component: "card", props: { title: "{{question}}" } },
      { component: "card", props: { body: "{{answer}}" } },
    ],
  },

  // ── Data / Analytics ────────────────────────────────────────────────

  {
    name: "comparison",
    description: "Side-by-side comparison with stats and data table",
    layout: [
      { component: "card", props: { title: "{{title}}", body: "{{description}}" } },
      { component: "stat_grid", props: { stats: "{{stats}}" } },
      { component: "data_table", props: { title: "{{table_title}}", columns: "{{columns}}", rows: "{{rows}}" } },
    ],
  },
  {
    name: "task_tracker",
    description: "Task or project tracker with progress and data table",
    layout: [
      { component: "card", props: { title: "{{project_name}}", subtitle: "{{status}}" } },
      { component: "progress", props: { label: "Completion", value: "{{completion_pct}}" } },
      { component: "data_table", props: { title: "Tasks", columns: "{{columns}}", rows: "{{rows}}" } },
    ],
  },
  {
    name: "survey_results",
    description: "Survey results with response stats and breakdown table",
    layout: [
      { component: "card", props: { title: "{{survey_name}}", subtitle: "{{response_count}} responses" } },
      { component: "stat_grid", props: { stats: "{{summary_stats}}" } },
      { component: "data_table", props: { title: "Breakdown", columns: "{{columns}}", rows: "{{rows}}" } },
    ],
  },
  {
    name: "leaderboard",
    description: "Leaderboard with rankings and highlight stats",
    layout: [
      { component: "card", props: { title: "{{title}}", subtitle: "{{period}}" } },
      { component: "data_table", props: { title: "Rankings", columns: "{{columns}}", rows: "{{rows}}" } },
      { component: "stat_grid", props: { stats: "{{highlight_stats}}" } },
    ],
  },

  // ── Project Management ──────────────────────────────────────────────

  {
    name: "sprint_board",
    description: "Sprint board with velocity stats, task breakdown, and burndown",
    layout: [
      { component: "card", props: { title: "Sprint {{sprint_number}}", subtitle: "{{date_range}}" } },
      { component: "stat_grid", props: { stats: "{{velocity_stats}}" } },
      { component: "progress", props: { label: "Sprint Progress", value: "{{progress_pct}}" } },
      { component: "data_table", props: { title: "Tasks", columns: "{{columns}}", rows: "{{rows}}" } },
    ],
  },
  {
    name: "risk_register",
    description: "Risk register with severity overview and risk table",
    layout: [
      { component: "card", props: { title: "Risk Register", subtitle: "{{project_name}}" } },
      { component: "stat_grid", props: { stats: "{{severity_stats}}" } },
      { component: "data_table", props: { title: "Risks", columns: "{{columns}}", rows: "{{rows}}" } },
    ],
  },
  {
    name: "meeting_notes",
    description: "Meeting notes with attendees, discussion points, and action items",
    layout: [
      { component: "card", props: { title: "{{meeting_title}}", subtitle: "{{date}}" } },
      { component: "key_value", props: { title: "Details", items: "{{meeting_details}}" } },
      { component: "card", props: { title: "Notes", body: "{{notes}}" } },
      { component: "data_table", props: { title: "Action Items", columns: "{{action_columns}}", rows: "{{action_rows}}" } },
    ],
  },
];
