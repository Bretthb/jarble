# Artifact Workspace Design

## Goal

Add a persistent workspace system where UI artifacts (spreadsheets, charts, code editors, dashboards) live on the bot's PVC as the source of truth. The frontend auto-saves edits back to the pod, restores the workspace on session start, and subscribes to live data updates — making the bot stateful for UI artifacts across sessions and devices.

## Architecture

Pod-side artifact store on the PVC (`/data/workspace/`). The bot has native filesystem access. The frontend syncs via three new API endpoints. Live data artifacts update on a configurable poll interval, with changes pushed to the frontend via SSE.

## Tech Stack

- PVC filesystem (`/data/workspace/`) for storage
- MCP tools for bot read/write access
- Express API endpoints for frontend sync
- SSE `ARTIFACT_UPDATED` events for live data push
- `useArtifactSync` React hook for auto-save + subscription

---

## PVC Directory Structure

```
/data/workspace/
├── manifest.json              # Artifact index (lightweight metadata)
├── artifacts/
│   ├── {artifact-id}.json     # Full artifact: component + props + metadata
│   ├── {artifact-id}.json
│   └── ...
```

### manifest.json

```json
{
  "version": 1,
  "artifacts": [
    {
      "id": "spreadsheet-q4-2026",
      "component": "spreadsheet",
      "title": "Q4 Revenue Data",
      "createdAt": "2026-03-04T18:00:00Z",
      "updatedAt": "2026-03-04T19:30:00Z",
      "pinned": true
    }
  ]
}
```

### Artifact File

```json
{
  "id": "spreadsheet-q4-2026",
  "component": "spreadsheet",
  "props": { "columns": [...], "data": [...] },
  "title": "Q4 Revenue Data",
  "createdAt": "2026-03-04T18:00:00Z",
  "updatedAt": "2026-03-04T19:30:00Z",
  "pinned": true,
  "source": "bot",
  "dataSource": null
}
```

Fields:
- `id` — Unique identifier (alphanumeric, hyphens, underscores, max 64 chars)
- `component` — Canvas component type (e.g. `"spreadsheet"`, `"chart"`)
- `props` — Full component props (same shape as render_ui props)
- `title` — Human-readable name
- `pinned` — If true, auto-restores on session start
- `source` — `"bot"` (created via MCP) or `"user"` (edited on frontend)
- `dataSource` — Optional live data configuration (see Live Data section)

---

## Artifact-Worthy Components

Only these components sync to the pod workspace. Everything else remains transient (localStorage only).

| Component | Why |
|-----------|-----|
| `spreadsheet` | User edits cells, formulas |
| `code_editor` | User writes/edits code |
| `data_table` | Structured data the user curates |
| `chart` | Configured visualizations |
| `sandbox` | Custom HTML/JS apps with internal state |
| `code_block` | Saved code snippets |
| `dashboard` | Multi-component layouts |
| `embed` | Configured third-party widgets |

---

## Auto-Save Sync Flow (Frontend → Pod)

```
User edits spreadsheet cell
  → canvasReducer dispatches UPDATE_CARD_PROPS
  → useArtifactSync hook detects dirty state
  → debounce 2s
  → POST /api/deployments/:id/artifact/sync
    body: { id, component, props, title }
  → API execs into pod: writes artifact JSON + updates manifest.json
  → Frontend marks artifact clean
```

Key behaviors:
- 2s debounce (longer than localStorage's 300ms — network writes are heavier)
- Full props replacement per sync (not diff/patch). Artifacts are typically <100KB.
- If pod is unreachable, frontend queues sync and retries when pod comes back. Existing localStorage persistence continues working as fallback.
- Rate limit: max 1 sync/second per deployment.

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/deployments/:id/artifact/sync` | POST | Write artifact to pod workspace |
| `/api/deployments/:id/artifact/list` | GET | Return manifest.json contents |
| `/api/deployments/:id/artifact/:artifactId` | GET | Return full artifact JSON |
| `/api/deployments/:id/artifact/:artifactId` | DELETE | Remove artifact from workspace |

All endpoints are authenticated (Auth0 bearer token) and verify deployment ownership.

Implementation: exec into pod using existing base64+node write pattern from configSync.

---

## Session Restore (Pod → Frontend)

On session start (user opens `/d/[id]`):

```
Frontend mounts
  → GET /api/deployments/:id/artifact/list
  → Receives manifest with artifact metadata
  → For each pinned artifact:
      GET /api/deployments/:id/artifact/:id
      → Hydrate canvas card with saved props
  → Canvas renders restored workspace
```

User sees their workspace from last session immediately, before sending a message.

---

## Bot Awareness

### New MCP Tools

Replace the old `save/load/list/delete_canvas_file` family:

| Tool | Purpose |
|------|---------|
| `save_artifact(id, component, props, title, pinned?)` | Save/update artifact |
| `load_artifact(id)` | Read full artifact props |
| `list_artifacts()` | Read manifest |
| `delete_artifact(id)` | Remove from workspace |

Old tools become aliases for backwards compatibility.

### Soul.md Prompt Guidance

```
## Workspace Persistence
When a user starts a conversation, check for saved artifacts with list_artifacts().
If artifacts exist, briefly acknowledge them: "Welcome back! You have 3 saved items
including your Q4 Revenue spreadsheet. Want me to pull anything up?"
Pinned artifacts are already visible on the user's canvas — don't re-render them.

When creating substantial UI components (spreadsheets, charts, dashboards),
save them as artifacts so the user can return to them later. Use descriptive
titles and pin important artifacts.
```

---

## Live Data Artifacts

An artifact can declare a `dataSource` that makes it update automatically.

### Data Source Schema

```json
{
  "dataSource": {
    "type": "file" | "skill",
    "path": "/data/feeds/aapl.json",
    "skill": "web_fetch",
    "args": { "url": "https://api.example.com/price" },
    "pollInterval": 5,
    "transform": "data.price"
  }
}
```

- `type: "file"` — Bot watches a PVC file for changes (written by skills or external processes)
- `type: "skill"` — Bot runs a skill on interval to fetch fresh data
- `pollInterval` — Seconds between updates. Min 5s, max 3600s.
- `transform` — Optional dot-path to extract data from the response

### Recommended Intervals

| Data Type | Interval |
|-----------|----------|
| Stock/crypto prices, live scores | 5s |
| Server metrics, queue lengths | 30s |
| News feeds, social mentions | 5min |
| Weather, exchange rates | 30min |
| Daily summaries, analytics | 1hr |

### Pattern A: PVC File Watch

```
Bot skill / external process writes to /data/feeds/aapl.json
  → Bot detects file change (fs.watch or poll)
  → Bot reads file, updates artifact props
  → save_artifact("stock-tracker", "chart", newProps)
  → SSE event: ARTIFACT_UPDATED { id, props }
  → Frontend re-renders chart with fresh data
```

### Pattern B: Bot-Fetched Internet Data

```
Artifact declares: dataSource.type = "skill"
  → Bot runs skill on pollInterval
  → Bot transforms response → updates artifact props
  → save_artifact(...) → SSE ARTIFACT_UPDATED → frontend re-renders
```

### Frontend Subscription

New SSE event type on the existing chat/status stream:

```
event: ARTIFACT_UPDATED
data: { "id": "stock-tracker", "props": { ... } }
```

`useArtifactSync` hook listens for these events and updates canvas card props in-place.

---

## Migration

- Existing `/data/files/` artifacts migrate to `/data/workspace/artifacts/` on first boot
- Old MCP tools (`save_canvas_file`, etc.) become aliases to new artifact tools
- Frontend `useCanvasPersistence` continues working for transient cards
- New `useArtifactSync` hook layers on top for pod-synced artifacts

---

## Live Testing Plan

5 scenarios to validate with real bots:

1. **Spreadsheet round-trip**: Create bot → ask for spreadsheet → edit cells on frontend → stop/restart pod → reopen chat → verify spreadsheet restores with edits

2. **Multi-artifact workspace**: Ask bot for chart + spreadsheet + code editor → pin all three → close browser → reopen → all three restore

3. **Bot recall**: After creating artifacts, start new conversation → bot says "you have N saved items" → ask "show me that spreadsheet" → bot loads and re-renders

4. **Cross-device**: Create artifacts on desktop → open same deployment on phone → artifacts load from pod (not browser storage)

5. **Component composition quality**: Ask bot "make me a financial dashboard" → evaluate component selection (chart + data_table + stat_grid vs. a single sandbox)

---

## What This Doesn't Include (YAGNI)

- No collaborative multi-user editing
- No version history / undo across sessions
- No artifact sharing between deployments
- No real-time collaborative cursors
- No server-side artifact validation
- No WebSocket streaming for sub-second updates (poll interval minimum 5s)
- No artifact search/indexing beyond manifest listing
