/**
 * Data Formatting Skill — correct prop formats for common components
 *
 * This skill helps the bot produce valid props on the first try,
 * reducing autoFix corrections and rendering errors.
 */

export const DATA_FORMATTING_SKILL = {
  name: "data-formatting",
  description:
    "Data format cheat sheet — recharts data, data_table rows, map center, form options, timeline events, stat_grid stats",
  content: `## Data Formatting Cheat Sheet

### Chart Data (recharts format)
\`\`\`json
{
  "type": "bar",
  "title": "Revenue by Quarter",
  "data": [
    {"quarter": "Q1", "revenue": 250000, "target": 200000},
    {"quarter": "Q2", "revenue": 310000, "target": 280000}
  ],
  "dataKeys": ["revenue", "target"],
  "xAxisKey": "quarter",
  "showLegend": true,
  "showGrid": true
}
\`\`\`
- \`data\`: array of flat objects — every object has the SAME keys
- \`dataKeys\`: numeric fields to plot (NOT the label field). Values MUST be raw numbers (not "$182.50")
- \`xAxisKey\`: the category/label field (string values)
- Chart types: \`bar\`, \`line\`, \`pie\`, \`area\` ONLY
- For multi-series: add multiple entries to \`dataKeys\`
- For stacked: add \`"stacked": true\`
- **NEVER** use Chart.js format (\`labels\` + \`datasets\`)

#### Stock / Financial Data
\`\`\`json
{
  "type": "area",
  "title": "AAPL — 30 Day",
  "data": [
    {"date": "2024-11-01", "close": 225.91},
    {"date": "2024-11-04", "close": 222.72}
  ],
  "dataKeys": ["close"],
  "xAxisKey": "date"
}
\`\`\`
- Use \`"area"\` or \`"line"\` for price charts (never bar/pie)
- Plot only 1-2 numeric fields — e.g. \`["close"]\` or \`["close", "volume"]\`. Do NOT include open/high/low unless asked
- All values must be raw numbers: ✅ \`182.5\` ❌ \`"$182.50"\`
- Dates as ISO strings for xAxisKey — the chart auto-formats them

### data_table Rows (2D arrays, not objects)
\`\`\`json
{
  "title": "Top Customers",
  "columns": ["Customer", "Revenue", "Growth"],
  "rows": [
    ["Acme Corp", "$420K", "+15%"],
    ["Globex Inc", "$380K", "+8%"],
    ["Wayne Ent", "$310K", "+22%"]
  ]
}
\`\`\`
- \`rows\`: array of arrays — each inner array matches column order
- Values can be strings or numbers
- **NEVER** use objects: \`[{"Customer": "Acme"}]\` is WRONG

### metric_card
\`\`\`json
{
  "label": "Monthly Revenue",
  "value": "$1.2M",
  "change": "+15%",
  "changeLabel": "vs last month",
  "sparkline": [800, 920, 1050, 1100, 1150, 1200]
}
\`\`\`
- Use \`label\` (NOT \`name\` or \`title\`)
- \`value\` is a string (pre-formatted)
- \`change\` includes sign: "+15%" or "-3%"
- \`sparkline\` is a number array for mini-chart

### stat_grid (5+ metrics)
\`\`\`json
{
  "stats": [
    {"label": "Revenue", "value": "$1.2M", "change": "+15%"},
    {"label": "Users", "value": "12,847", "change": "+23%"},
    {"label": "Conversion", "value": "3.2%", "change": "-0.5%"},
    {"label": "Churn", "value": "2.1%", "change": "-0.3%"}
  ]
}
\`\`\`
- Use \`stats\` array (NOT \`items\` or \`data\`)
- Each stat uses \`label\` (NOT \`name\`)

### timeline
\`\`\`json
{
  "title": "Project Timeline",
  "events": [
    {"label": "Planning", "description": "Requirements gathered", "timestamp": "Jan 2024", "status": "completed"},
    {"label": "Development", "description": "Core features", "timestamp": "Mar 2024", "status": "active"},
    {"label": "Launch", "timestamp": "May 2024", "status": "pending"}
  ]
}
\`\`\`
- Use \`events\` array (NOT \`items\` or \`data\`)
- Status values: \`completed\`, \`active\`, \`pending\`

### map
\`\`\`json
{
  "center": [48.8566, 2.3522],
  "zoom": 12,
  "markers": [
    {"lat": 48.8566, "lng": 2.3522, "label": "Paris"}
  ]
}
\`\`\`
- \`center\` is a \`[lat, lng]\` tuple (NOT an object)
- Markers use \`lat\`, \`lng\`, \`label\`

### form
\`\`\`json
{
  "title": "Contact Form",
  "fields": [
    {"name": "email", "label": "Email", "type": "email", "required": true},
    {"name": "role", "label": "Role", "type": "select", "options": ["Engineer", "Designer", "Manager"]},
    {"name": "message", "label": "Message", "type": "textarea"}
  ],
  "submitLabel": "Send"
}
\`\`\`
- Select options: flat strings (NOT \`{label, value}\` objects)
- Use \`submitLabel\` (NOT \`submitText\`)

### alert
\`\`\`json
{"title": "Deploy Complete", "message": "v2.3.1 is live", "variant": "success"}
\`\`\`
- Use \`message\` (NOT \`description\` or \`content\`)
- Variants: \`info\`, \`success\`, \`warning\`, \`destructive\` (NOT \`error\`, \`danger\`, \`primary\`)

### Layout Hints
Always set \`layout_hint\` on every component:
- \`"full-width"\`: headers, wide tables, sandboxes, maps
- \`"half"\`: charts, timelines, tabs, accordions
- \`"third"\`: metric_cards, badges, alerts, progress bars
- \`"compact"\`: dividers, avatars`,
};
