# Canvas Component Inventory (58 Components)

## REGISTERED & PUBLIC (24/58) ✅
Bots can render these. Listed in registry.ts + MCP server.

```
DISPLAY (7):
  ✅ card              - Simple card with title, status, live indicator
  ✅ data_table        - Table with auto-detect columns
  ✅ stat_grid         - KPI grid layout
  ✅ key_value         - Key-value list
  ✅ header            - H1/H2/H3 heading
  ✅ divider           - Horizontal line
  ✅ badge             - Tag/label

MEDIA (4):
  ✅ image             - Img with alt/caption
  ✅ code_block        - Syntax-highlighted code
  ✅ video             - YouTube/Twitch/Vimeo/etc
  ✅ layout            - Nested component container

STRUCTURE (4):
  ✅ tabs              - Tabbed panels
  ✅ accordion         - Collapsible sections
  ✅ alert             - Colored notification banner
  ✅ list              - Structured list with icons/badges

CHARTS & METRICS (5):
  ✅ chart             - Bar/line/pie/area (recharts)
  ✅ metric_card       - Single metric with sparkline
  ✅ progress          - Progress bar
  ✅ gauge             - Circular gauge (0-100)
  ✅ stat_grid         - (Counted above)

INTERACTIVE (3):
  ✅ form              - Text/email/textarea/select/checkbox/number fields
  ✅ button_group      - Action buttons with click dispatch
  ✅ code_editor       - Monaco read-only code viewer

SPECIALIZED (1):
  ✅ sandbox           - Iframe for custom HTML/CSS/JS

ALIASES:
  ✅ canvas            - Alias for sandbox
```

---

## UNREGISTERED BUT IMPLEMENTED (34/58) ❌
Files exist but bots CANNOT render these. Need schema + registry entry.

```
ANT DESIGN SPECIALIZED CHARTS (13):
  ❌ CanvasGauge.tsx           - Gauge chart (duplicate of registered gauge?)
  ❌ CanvasRadar.tsx           - Radar/spider chart
  ❌ CanvasRadialBar.tsx       - Circular bar chart
  ❌ CanvasRose.tsx            - Rose/nightingale chart
  ❌ CanvasWaterfall.tsx       - Waterfall chart
  ❌ CanvasScatter.tsx         - Scatter plot
  ❌ CanvasHistogram.tsx       - Histogram/distribution
  ❌ CanvasHeatmap.tsx         - 2D heatmap
  ❌ CanvasFunnel.tsx          - Funnel/conversion chart
  ❌ CanvasLiquid.tsx          - Liquid fill gauge
  ❌ CanvasStock.tsx           - OHLC stock/candlestick
  ❌ CanvasSunburst.tsx        - Sunburst tree chart
  ❌ CanvasCirclePacking.tsx   - Circle packing bubble chart

TREE/HIERARCHY (3):
  ❌ CanvasTree.tsx            - Tree diagram
  ❌ CanvasTreemap.tsx         - Hierarchical rectangles
  ❌ CanvasVenn.tsx            - Venn diagram

TEXT/WORD (2):
  ❌ CanvasWordCloud.tsx       - Word cloud
  ❌ CanvasTagCloud.tsx        - 3D tag cloud

STRUCTURAL (4):
  ❌ CanvasBox.tsx             - Div wrapper (likely dead code)
  ❌ CanvasBlockquote.tsx      - Blockquote (likely dead code)
  ❌ CanvasBullet.tsx          - Bullet point (likely dead code)
  ❌ CanvasTextMessage.tsx     - Chat bubble (likely dead code)

DATA GRIDS (2):
  ❌ CanvasSpreadsheet.tsx     - ag-grid wrapper (BROKEN: schema exists but no real impl?)
  ❌ CanvasDescriptions.tsx    - Ant Design key-value table

MEDIA/GALLERY (3):
  ❌ CanvasCarousel.tsx        - Image slider
  ❌ CanvasImageGallery.tsx    - Multi-image gallery
  ❌ CanvasAudio.tsx           - Audio player

OTHER (2):
  ❌ CanvasMap.tsx             - Leaflet map with markers (SHOULD be registered!)
  ❌ CanvasDualAxes.tsx        - Two Y-axis chart
  ❌ CanvasStatistic.tsx       - Single metric (duplicate of metric_card?)
  ❌ CanvasAvatar.tsx          - User avatar (likely dead code)
```

---

## COMPONENT STATUS MATRIX

| Component | File | Registry | Schema | MCP | Works? | Priority |
|-----------|------|----------|--------|-----|--------|----------|
| card | ✅ | ✅ | ✅ | ✅ | ✅ | Core |
| data_table | ✅ | ✅ | ✅ | ✅ | ✅ | Core |
| stat_grid | ✅ | ✅ | ✅ | ✅ | ✅ | Core |
| chart | ✅ | ✅ | ✅ | ✅ | ✅ | Core |
| form | ✅ | ✅ | ✅ | ✅ | ✅ | Core |
| button_group | ✅ | ✅ | ✅ | ✅ | ✅ | Core |
| tabs | ✅ | ✅ | ✅ | ✅ | ✅ | Core |
| accordion | ✅ | ✅ | ✅ | ✅ | ✅ | Core |
| list | ✅ | ✅ | ✅ | ✅ | ✅ | High |
| timeline | ✅ | ✅ | ✅ | ✅ | ✅ | High |
| progress | ✅ | ✅ | ✅ | ✅ | ✅ | High |
| alert | ✅ | ✅ | ✅ | ✅ | ✅ | High |
| gauge | ✅ | ✅ | ✅ | ✅ | ✅ | Medium |
| image | ✅ | ✅ | ✅ | ✅ | ✅ | Core |
| code_block | ✅ | ✅ | ✅ | ✅ | ✅ | High |
| code_editor | ✅ | ✅ | ✅ | ✅ | ✅ | Medium |
| sandbox | ✅ | ✅ | ✅ | ✅ | ✅ | Core |
| video | ✅ | ✅ | ✅ | ✅ | ✅ | Medium |
| header | ✅ | ✅ | ✅ | ✅ | ✅ | Low |
| divider | ✅ | ✅ | ✅ | ✅ | ✅ | Low |
| badge | ✅ | ✅ | ✅ | ✅ | ✅ | Low |
| key_value | ✅ | ✅ | ✅ | ✅ | ✅ | Medium |
| layout | ✅ | ✅ | ✅ | ✅ | ✅ | Core |
| metric_card | ✅ | ✅ | ✅ | ✅ | ✅ | High |
| | | | | | |
| map | ✅ | ❌ | ❌ | ❌ | ✅ | High |
| radar | ✅ | ❌ | ❌ | ❌ | ✅ | Medium |
| scatter | ✅ | ❌ | ❌ | ❌ | ✅ | Medium |
| heatmap | ✅ | ❌ | ❌ | ❌ | ✅ | Medium |
| waterfall | ✅ | ❌ | ❌ | ❌ | ✅ | Medium |
| funnel | ✅ | ❌ | ❌ | ❌ | ✅ | High |
| liquid | ✅ | ❌ | ❌ | ❌ | ✅ | Low |
| stock | ✅ | ❌ | ❌ | ❌ | ✅ | High |
| sunburst | ✅ | ❌ | ❌ | ❌ | ✅ | Medium |
| tree | ✅ | ❌ | ❌ | ❌ | ✅ | Medium |
| wordcloud | ✅ | ❌ | ❌ | ❌ | ✅ | Low |
| carousel | ✅ | ❌ | ❌ | ❌ | ✅ | Medium |
| image_gallery | ✅ | ❌ | ❌ | ❌ | ✅ | Low |
| descriptions | ✅ | ❌ | ❌ | ❌ | ✅ | Low |
| spreadsheet | ✅ | ✅ | ✅ | ✅ | ? | Unknown |
| | | | | | |
| box | ✅ | ❌ | ❌ | ❌ | ✅ | Dead |
| blockquote | ✅ | ❌ | ❌ | ❌ | ✅ | Dead |
| bullet | ✅ | ❌ | ❌ | ❌ | ✅ | Dead |
| text_message | ✅ | ❌ | ❌ | ❌ | ✅ | Dead |
| avatar | ✅ | ❌ | ❌ | ❌ | ✅ | Dead |
| audio | ✅ | ❌ | ❌ | ❌ | ✅ | Low |
| radial_bar | ✅ | ❌ | ❌ | ❌ | ✅ | Medium |
| rose | ✅ | ❌ | ❌ | ❌ | ✅ | Low |
| histogram | ✅ | ❌ | ❌ | ❌ | ✅ | Medium |
| circle_packing | ✅ | ❌ | ❌ | ❌ | ✅ | Low |
| dual_axes | ✅ | ❌ | ❌ | ❌ | ✅ | Medium |
| statistic | ✅ | ❌ | ❌ | ❌ | ✅ | Low |
| venn | ✅ | ❌ | ❌ | ❌ | ✅ | Low |
| treemap | ✅ | ❌ | ❌ | ❌ | ✅ | Medium |
| calendar_heatmap | ✅ | ❌ | ❌ | ❌ | ✅ | Low |

---

## Breakdown by Capability

### LIVE/REAL-TIME CAPABLE
- chart (point/slice click only, no streaming updates)
- form (submit dispatch)
- button_group (click dispatch)
- data_table (row click dispatch)
- sandbox (arbitrary JS, could listen for updates)

**Gap**: No components have true SSE live binding; updates require full re-render via UI_UPDATE blocks.

### INTERACTIVE/STATEFUL
- form (state management for fields)
- button_group (click state)
- tabs (active tab state)
- accordion (open/close state)
- code_editor (read-only, no editing)
- sandbox (full interactivity possible)

**Gap**: No nested interactivity; no conditional show/hide; no cascading form fields.

### DISPLAY-ONLY
- card, stat_grid, key_value, header, divider, badge
- image, code_block, video
- list, timeline, progress, alert
- metric_card
- All Ant Design charts (radar, scatter, etc.)

---

## Next Steps
1. **Register 13 Ant Design charts** (quick wins: 1 day)
2. **Register map** (1 hour)
3. **Verify spreadsheet works** (2 hours)
4. **Delete dead code** (1 hour)
5. **Add missing use-case components** (2 weeks):
   - Real-time live binding for chart/stat_grid
   - Rich form with date picker, conditional fields
   - Dismissible toast/snackbar
   - File uploader (sandbox iframe)
   - Kanban board
