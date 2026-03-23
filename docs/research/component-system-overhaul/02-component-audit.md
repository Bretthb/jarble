# Report 2: Canvas Component Audit

**Agent**: component-auditor
**Status**: COMPLETE

## Inventory

- **58 total component files** in `Jarble-mvp/components/canvas/components/`
- **24 REGISTERED & PUBLIC** (bots can render these)
- **34 UNREGISTERED BUT IMPLEMENTED** (bots cannot access)
- **1 BROKEN/INCOMPLETE** (spreadsheet)

### Registered Components (24)
- **Core**: card, data_table, stat_grid, chart, form, button_group, tabs, accordion, layout, sandbox
- **Media**: image, code_block, video
- **Metrics**: metric_card, progress, gauge, key_value, header, divider, badge
- **Structure**: list, timeline, alert, code_editor

### Unregistered Hidden Gems (34)
- **13 Ant Design Specialized Charts**: radar, scatter, heatmap, waterfall, funnel, stock, sunburst, liquid, rose, tree, treemap, wordcloud, circle_packing, histogram, radial_bar
- **High-value missing**: map, carousel, image_gallery
- **5 dead code components**: box, blockquote, bullet, text_message, avatar
- **Broken**: spreadsheet (schema exists but implementation incomplete)

## Critical Gaps Identified

### High-Priority (Blocking real use cases)
- Real-time dashboard updates (charts/metrics have no live binding)
- Date/time pickers in forms
- Kanban/task boards
- File uploaders
- Rich comparison tables (pricing, feature matrices)

### Medium-Priority
- Activity feeds / social components
- Search/autocomplete fields
- Multi-step form wizards
- Dismissible notifications

## Recommendations

### Phase 1 (Quick — Register Existing)
1. Create Zod schemas for 13 Ant Design charts
2. Add to registry.ts + MCP server BUILTIN_COMPONENTS
3. Register map component
4. Fix/document spreadsheet

### Phase 2 (High-Priority Gaps)
1. Add live binding for SSE chart updates
2. Date picker field type for forms
3. Dismissible toast/snackbar component
4. File uploader (via sandbox iframe)

### Phase 3 (Medium-Priority)
1. Kanban board component
2. Rich form enhancements (conditional fields, autocomplete)
3. Activity feed / social patterns
4. Table sorting/filtering/pagination

## Key Insight
The 34 unregistered components represent **140% more visualization capability** than currently exposed to bots. Low-hanging fruit: registering map (1 hour) would unlock location-based workflows.

## Key Files
- `Jarble-mvp/components/canvas/registry.ts` — master registry
- `Jarble-mvp/components/canvas/components/` — all component files
- `jarble-api-main/src/mcp/jarble-ui-server.js` — BUILTIN_COMPONENTS list
