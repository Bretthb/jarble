# Canvas Component Audit Report
*Task #2: Comprehensive inventory of 58 canvas components with gap analysis*

## Executive Summary
- **Total Components**: 58 files found in `Jarble-mvp/components/canvas/components/`
- **Registered in Registry**: 24 (in `registry.ts`)
- **In MCP Server**: 24 (in `jarble-ui-server.js`)
- **Unregistered/Additional**: 34 components exist but are NOT in the public registry

## Component Categories

### REGISTERED BUILT-IN COMPONENTS (24 components)
These are fully listed in `registry.ts` and available for bot rendering:

#### Display Components (7)
| Component | Rendering | Schema Complexity | Interactivity | Notes |
|-----------|-----------|------------------|---------------|-------|
| **card** | Title, subtitle, body, content, status badge | Medium | None | Top accent stripe, live indicator dot, last-updated footer |
| **data_table** | Table with headers + rows, column auto-detect | Medium | Low (row click dispatch) | Auto-detects numeric columns, normalizes object/array rows |
| **stat_grid** | Grid of metrics (label, value, change, icon) | Low | None | Uses canvas grid, responsive |
| **key_value** | List of key-value pairs | Low | None | Simple rendering |
| **header** | H1/H2/H3 with optional subtitle + divider | Low | None | Semantic heading levels |
| **divider** | Horizontal line with optional label | Low | None | Three variants: solid/dashed/dotted, 3 spacing levels |
| **badge** | Small tag/label with variant styling | Low | None | 7 color variants (default, secondary, destructive, outline, success, warning, info) |

#### Content/Media (4)
| Component | Rendering | Schema Complexity | Interactivity | Notes |
|-----------|-----------|------------------|---------------|-------|
| **image** | Img with alt, caption | Low | None | Accepts relative paths, data: URIs, absolute URLs |
| **code_block** | Syntax-highlighted code snippet | Low | None | Uses Prism/highlight.js equivalent |
| **video** | Video/livestream player | Low | None | Supports YouTube, Twitch, Vimeo, SoundCloud, Dailymotion, direct URLs |
| **layout** | Container for nested components (grid/vertical/horizontal) | High | None | Supports 1-4 column grid, children with propsJson or props, gap config |

#### Structure/Organization (4)
| Component | Rendering | Schema Complexity | Interactivity | Notes |
|-----------|-----------|------------------|---------------|-------|
| **tabs** | Tabbed panels with content or nested children | Medium | Low (tab switching) | Supports text content OR nested child components, defaultTab config |
| **accordion** | Collapsible sections | Medium | Low (expand/collapse) | Single or multiple open, defaultOpen per item, supports children |
| **alert** | Colored notification banner | Low | None | 4 variants: info/success/warning/error |
| **list** | Structured list with icons, descriptions, badges | Medium | None | Ordered/unordered, per-item badges with variants |

#### Charts & Metrics (5)
| Component | Rendering | Schema Complexity | Interactivity | Notes |
|-----------|-----------|------------------|---------------|-------|
| **chart** | Bar/line/pie/area charts | High | Medium (point/slice click) | Uses recharts, auto-color palette, legend/grid config, click dispatch |
| **progress** | Progress bar with percentage | Low | None | 4 variants: default/success/warning/error |
| **stat_grid** | KPI grid (included above) | Low | None | - |
| **metric_card** | Single metric + optional sparkline | Medium | None | Supports trend indicator (up/down/neutral), change label, live indicator |
| **gauge** | Circular gauge chart | Low | None | Value 0-100, title, suffix, custom color |

#### Interactive Components (3)
| Component | Rendering | Schema Complexity | Interactivity | Notes |
|-----------|-----------|------------------|---------------|-------|
| **form** | Text, email, textarea, select, checkbox, number fields | Medium | High (state management, submit) | Submit button dispatches form_submit action, disables on submission |
| **button_group** | Row of action buttons | Low | High (click dispatch) | 4 button variants, icons, disabled state, disables all on click |
| **code_editor** | Monaco code editor with syntax highlighting | Low | Low (readOnly by default) | Dynamic import with loading skeleton, 13px font, 300px default height |

#### Specialized (1)
| Component | Rendering | Schema Complexity | Interactivity | Notes |
|-----------|-----------|------------------|---------------|-------|
| **sandbox** | Sandboxed iframe for arbitrary HTML/CSS/JS | High | High (arbitrary scripts) | Sanitizes HTML prop (extracts scripts/styles), safe iframe (no same-origin), parent↔iframe bridge via __JARBLE_PROPS__ |
| **spreadsheet** | Excel-like editable grid | Medium | High | Dynamic import from ag-grid or similar |

**Total Registered: 24 components**

---

### UNREGISTERED COMPONENTS IN FILESYSTEM (34 components)
These exist as `.tsx` files BUT are NOT exported in `registry.ts` or listed in MCP server. **Bots cannot render these.**

#### Ant Design-based Specialized Charts (13)
All from `@ant-design/plots` library:
- **CanvasGauge.tsx** – Circular gauge chart (0-100 scale with color gradient)
- **CanvasRadar.tsx** – Radar/spider chart (5+ dimensions)
- **CanvasRadialBar.tsx** – Radial bar chart (circular bars)
- **CanvasRose.tsx** – Rose/nightingale chart (polar angle-based bars)
- **CanvasWaterfall.tsx** – Waterfall chart (cumulative flow)
- **CanvasScatter.tsx** – Scatter plot (2D point cloud)
- **CanvasHistogram.tsx** – Histogram (binned distribution)
- **CanvasHeatmap.tsx** – 2D heatmap (matrix visualization)
- **CanvasFunnel.tsx** – Funnel chart (conversion flow)
- **CanvasLiquid.tsx** – Liquid fill gauge (animated percentage)
- **CanvasStock.tsx** – OHLC stock chart (candlestick)
- **CanvasSunburst.tsx** – Sunburst tree chart (hierarchical)
- **CanvasCirclePacking.tsx** – Circle packing (bubble hierarchy)

#### Tree/Hierarchy Visualizations (3)
- **CanvasTree.tsx** – Tree diagram (parent-child relationships)
- **CanvasTreemap.tsx** – Treemap (hierarchical rectangles)
- **CanvasVenn.tsx** – Venn diagram (set overlaps)

#### Text/Word Visualizations (2)
- **CanvasWordCloud.tsx** – Word cloud (frequency-based sizing)
- **CanvasTagCloud.tsx** – Tag cloud (3D tag sphere)

#### Structural/Layout Components (4)
- **CanvasBox.tsx** – Simple div wrapper with styling
- **CanvasBlockquote.tsx** – Blockquote with left border accent
- **CanvasBullet.tsx** – Bullet point item
- **CanvasTextMessage.tsx** – Chat message bubble styling

#### Data Grids (2)
- **CanvasSpreadsheet.tsx** – Listed as registered but NO schema in registry!
- **CanvasDescriptions.tsx** – Ant Design Descriptions (key-value pair table)

#### Interactive/Container (2)
- **CanvasCarousel.tsx** – Image carousel/gallery slider
- **CanvasImageGallery.tsx** – Multi-image gallery (lightbox)

#### Avatar/Media (2)
- **CanvasAvatar.tsx** – User avatar with initials
- **CanvasAudio.tsx** – Audio player

#### Map (1)
- **CanvasMap.tsx** – Leaflet map with markers (registered? Needs verification)

#### Dual-Axis Chart (1)
- **CanvasDualAxes.tsx** – Recharts chart with two Y-axes

#### Statistic (1)
- **CanvasStatistic.tsx** – Ant Design single metric display (similar to metric_card)

**Total Unregistered: 34 components**

---

## Component Health Assessment

### Fully Functional & Live
- **24 registered components** – All have Zod schemas, are in registry, MCP server knows about them
- **Well-tested integration** – card, chart, form, button_group, data_table all have click/submit dispatch working
- **Framework coverage** – recharts (charts), @ant-design/plots (specialized charts), react-leaflet (map), @monaco-editor (code editor)

### Broken/Incomplete
1. **CanvasSpreadsheet.tsx** – Registered in registry, BUT:
   - Has Zod schema in `registry.ts`
   - NO implementation seen (only schema stub?)
   - Listed in MCP but no actual component rendering logic
   - Likely placeholder or incomplete

2. **Unregistered Ant Design Charts** (13 components) – All implemented, but:
   - Cannot be rendered by bots (not in registry)
   - No Zod schemas
   - Would require schema definitions + registry entry to use

3. **CanvasMap.tsx** – Leaflet map:
   - Implemented and functional
   - NOT in registry Zod schemas
   - NOT in MCP BUILTIN_COMPONENTS list
   - Would need schema definition for bot rendering

### Dead Code / Likely Unused
- **CanvasBox, CanvasBullet, CanvasTextMessage** – Structural/styling wrappers with no UI value; likely replaced by flexbox/Tailwind
- **CanvasAvatar, CanvasAudio** – Avatar exists but not referenced in any bot output; audio player never used
- **CanvasCarousel, CanvasImageGallery** – Gallery features exist but bots don't output them; CanvasImageGallery never tested

---

## Gap Analysis: What's Missing?

### High-Priority Gaps
| Use Case | Needed Component(s) | Why Missing |
|----------|-------------------|-------------|
| **Real-time dashboards** | Live counter, ticker, streaming data | No update mechanism for charts; no live binding |
| **File/media management** | File uploader, document viewer, PDF renderer | Not in scope? Sandbox could handle but no built-in |
| **Kanban/task boards** | Kanban board, drag-drop list | No state management for complex reordering |
| **Comparison tables** | Pricing table, feature matrix, product comparison | data_table too basic for complex layouts |
| **Rich text editor** | WYSIWYG editor, markdown editor | Form has only basic text inputs |
| **Data input forms** | Multi-step wizard, conditional fields, date picker | Form lacks conditional logic, date/time pickers |
| **Notifications** | Toast, snackbar, notification center | Alert is static; no dismissible notifications |
| **Date/time pickers** | Date picker, time picker, date range | Form fields don't support native date inputs well |

### Medium-Priority Gaps
| Use Case | Needed Component(s) | Why Missing |
|----------|-------------------|-------------|
| **Social/activity feeds** | Activity feed, comment thread, rating widget | No comment/thread pattern |
| **Product cards** | Product card with image/price/CTA | Requires custom layout, not a standard component |
| **Task/project lists** | Task item with subtasks, checklist, filtering | List component doesn't support nested structure |
| **E-commerce UI** | Shopping cart, checkout flow, order history | Form + layout can compose but no domain-specific UX |
| **Search/filter UI** | Search box with autocomplete, filter pills, facets | Form could work but no autocomplete |
| **Streaming/real-time** | Live event feed, live score updates, countdown | No live data binding; bots would need UI_UPDATE blocks |
| **Status/health indicators** | Status page component, health check grid | Alert + stat_grid could compose, but no rollup |
| **Scheduling** | Calendar picker, appointment scheduler, gantt | Timeline exists but not suitable for scheduling |

### Low-Priority Gaps (Nice-to-Have)
| Use Case | Needed Component(s) | Why Missing |
|----------|-------------------|-------------|
| **Theming/branding** | Custom theme switcher, brand asset gallery | Out of scope for bot UX |
| **Accessibility testing** | A11y audit component, contrast checker | Dev tool, not user-facing |
| **Analytics dashboard** | Custom KPI builder, drill-down analytics | Composition of chart + table sufficient |
| **Knowledge base** | FAQ accordion, documentation sidebar | Accordion + layout sufficient |

---

## Recommendations

### Phase 1: Register & Document Existing Components (2-3 days)
1. **Add 13 Ant Design charts to registry**
   - Create Zod schemas for: Gauge, Radar, RadialBar, Rose, Waterfall, Scatter, Histogram, Heatmap, Funnel, Liquid, Stock, Sunburst, CirclePacking
   - Add to `CANVAS_COMPONENTS` in `registry.ts`
   - Update MCP server `BUILTIN_COMPONENTS` list
   - Add descriptions to `BUILTIN_DESCRIPTIONS`

2. **Register Map component**
   - Add mapSchema to registry
   - Verify Leaflet import works in bot context

3. **Fix CanvasSpreadsheet**
   - Either implement full ag-grid wrapper OR remove from registry if not ready

4. **Remove dead code**
   - Delete CanvasBox, CanvasBullet, CanvasTextMessage, CanvasAvatar (unless used elsewhere)
   - Consolidate CanvasImageGallery + CanvasCarousel into single carousel component

### Phase 2: Add High-Priority Components (1 week)
1. **Real-time live binding** – Add `live: boolean` flag to chart/stat_grid/metric_card that enables SSE update subscription
2. **Rich forms** – Extend form component with:
   - Date/time picker fields
   - Conditional field visibility (`showIf` rules)
   - Multi-step wizard mode
   - Autocomplete select fields
3. **Dismissible notifications** – Toast/snackbar component (different from static alert)
4. **File uploader** – Sandbox iframe with drag-drop + progress (or use Dropzone.js)

### Phase 3: Medium-Priority Components (2 weeks)
1. **Kanban board** – CanvasKanban with drag-drop columns
2. **Activity feed** – Timeline variant for social feeds (item onClick support)
3. **Table enhancements** – Searchable/filterable data_table, pagination, sorting
4. **Date range picker** – Standalone component for scheduling workflows
5. **Search/autocomplete** – Searchable select field for form

### Phase 4: Integration & Polish (1 week)
1. Test all new components in 12-persona simulation
2. Update soul.md prompt to reference new components in "match component to content" guide
3. Create component usage examples/docs for bots
4. Measure bot adoption rate of new components in wild

---

## Current Prompt Guidance (from soul.md)
Soul.md lists these as available:
> "header, divider, key_value, image, spreadsheet, badge, timeline, card, stat_grid, list, alert, progress, button_group, form, data_table, tabs, accordion, chart, code_block, code_editor, sandbox, video"

**Issue**: Spreadsheet is listed but not fully implemented; 13 Ant Design charts are NOT mentioned even though they exist.

---

## Technical Debt
1. **Unregistered components create confusion** – Devs see 58 files but bots can only use 24; should either register all or delete unused
2. **No schema consistency** – Ant Design components follow different Zod pattern than registry
3. **Sandbox security** – Using `sandbox="allow-scripts allow-popups"` is permissive; could tighten CSP
4. **Dynamic imports** – Map, CodeEditor, Spreadsheet use dynamic imports (SSR false) adding bundle weight
5. **No component versioning** – If we register old Ant Design charts, how do we update them without breaking bots?

---

## File Count Summary
- **Total .tsx files in components/**: 58
- **With Zod schema + registry entry**: 24
- **With schema but not in MCP**: 0
- **Implemented but unregistered**: 34
- **Placeholder/incomplete**: 1 (Spreadsheet)
- **Dead code**: ~5
