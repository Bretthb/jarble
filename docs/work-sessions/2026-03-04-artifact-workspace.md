# Work Session: Artifact Workspace Implementation

**Date:** 2026-03-04
**Branch:** `UI-Tambo-ALL`
**Status:** 9/10 tasks complete — live testing remaining

---

## What Was Built

A persistent workspace system where UI artifacts (charts, spreadsheets, code editors, etc.) live on the bot's PVC as source of truth. The frontend auto-saves edits back to the pod, restores workspace on session start, and subscribes to live data updates via SSE.

## Commits (oldest → newest)

```
44d4dd0 docs: add artifact workspace design for persistent bot UI state
91729e4 docs: add artifact workspace + marketplace testing implementation plan
27b9a75 feat: add artifact store module with CRUD + migration + tests
1809867 fix(mcp): artifact store — atomic writes, manifest recovery, dataSource validation
78a84aa feat(mcp): add artifact workspace tools + migrate legacy canvas files
9eba08b fix(mcp): validate dataSource type + remove legacy tool definitions from TOOLS array
57bdf57 feat(api): add artifact CRUD endpoints for frontend workspace sync
304cce1 feat: add workspace persistence guidance to soul.md prompt
acd59f4 feat: add useArtifactSync hook, wire into chat page, handle ARTIFACT_UPDATED events
30f26d4 fix: address code quality issues in useArtifactSync hook
```

## Files Created/Modified

### New Files
| File | Purpose |
|------|---------|
| `jarble-api-main/src/mcp/artifactStore.ts` | Core artifact CRUD module (save, load, list, delete, migrate) |
| `jarble-api-main/src/mcp/__tests__/artifactTools.test.ts` | 44 tests for artifact store |
| `jarble-api-main/src/routes/artifact.ts` | Express router: 4 endpoints (list, get, sync, delete) |
| `jarble-api-main/src/routes/__tests__/artifact.test.ts` | 23 tests for API endpoints |
| `Jarble-mvp/hooks/useArtifactSync.ts` | Frontend hook: auto-save + session restore |
| `Jarble-mvp/hooks/__tests__/useArtifactSync.test.ts` | 30 tests for hook utilities |
| `docs/plans/2026-03-04-artifact-workspace.md` | Full implementation plan |

### Modified Files
| File | Change |
|------|--------|
| `jarble-api-main/src/mcp/jarble-ui-server.js` | 4 artifact tools + migration + legacy aliases |
| `jarble-api-main/src/index.ts` | Registered `artifactRouter` |
| `jarble-api-main/src/utils/eventTypes.ts` | Added `CUSTOM_ARTIFACT_UPDATED` constant |
| `jarble-api-main/src/routes/tamboAgent.ts` | Emit `ARTIFACT_UPDATED` alongside card updates |
| `jarble-api-main/src/runtimes/handlers/openclaw.ts` | Workspace persistence guidance in soul.md |
| `Jarble-mvp/app/d/[id]/page.tsx` | Wire `useArtifactSync` hook |
| `Jarble-mvp/hooks/useCanvasChat.ts` | `jarble.artifact.updated` SSE handler |

## Test Counts
- **Backend:** 536 tests (22 files) — all passing
- **Frontend:** 319 tests (12 files) — all passing
- **Total:** 855 tests

## Architecture Summary

```
Bot Pod (PVC /data/workspace/)
├── manifest.json              ← Fast index of all artifacts
└── artifacts/
    └── {id}.json              ← Full artifact (component + props + metadata)

MCP Tools (jarble-ui-server.js):
  save_artifact, load_artifact, list_artifacts, delete_artifact
  + legacy aliases: save_canvas_file → save_artifact, etc.

API Endpoints (artifact.ts):
  GET  /api/deployments/:id/artifact/list        ← manifest
  GET  /api/deployments/:id/artifact/:artifactId ← full artifact
  POST /api/deployments/:id/artifact/sync        ← upsert from frontend
  DELETE /api/deployments/:id/artifact/:artifactId

SSE Event:
  CUSTOM "jarble.artifact.updated" → UPDATE_CARD_PROPS in useCanvasChat

Frontend Hook (useArtifactSync):
  - Session restore: fetch manifest → hydrate pinned artifacts
  - Auto-save: 2s debounced sync of artifact-worthy cards
  - Artifact-worthy: spreadsheet, code_editor, data_table, chart, sandbox, code_block, embed
```

## Remaining: Live Testing (Task 10+11)

See full test plan in `docs/plans/2026-03-04-artifact-workspace.md` (Tasks 10-11).

### Quick Start
```bash
# Terminal 1 — API
cd jarble-api-main && npm run dev:test

# Terminal 2 — Frontend
cd Jarble-mvp && npm run dev
```

### Test Checklist
- [ ] **Artifact round-trip**: Bot creates spreadsheet → edit cell → refresh → data persists from pod
- [ ] **Bot session awareness**: New chat → bot calls `list_artifacts` → mentions saved items
- [ ] **Pin + auto-restore**: Pin a chart → close tab → reopen → chart appears without chat
- [ ] **Cross-device**: Create artifacts in Chrome → open in Firefox → loads from pod
- [ ] **Component composition**: Ask for dashboard → bot uses appropriate component types
- [ ] **Marketplace validation**: Install package → bot uses new components (if marketplace has content)

### What to Watch For
- DevTools Network: `GET /artifact/list` on page load, `POST /artifact/sync` after edits
- SSE events: `jarble.artifact.updated` in EventSource messages
- Console: `[Jarble:ArtifactSync]` log messages in dev mode
- MCP tools: Bot should use `save_artifact` / `list_artifacts` (not old `save_canvas_file`)

## Uncommitted Changes (pre-existing, not part of this work)
These files have unstaged changes from before this session — don't accidentally commit them:
- `Jarble-mvp/components/canvas/sandbox/SandboxControls.tsx`
- `Jarble-mvp/components/workspace/DashboardCanvas.tsx`
- `Jarble-mvp/components/workspace/SimpleCanvasGrid.tsx`
- `Jarble-mvp/components/workspace/canvasReducer.ts`
- `Jarble-mvp/hooks/__tests__/useCanvasPersistence.test.ts`
- `Jarble-mvp/hooks/useCanvasPersistence.ts`
- `shared/component-manifest/components/spreadsheet.ts`
- `shared/component-manifest/derive/promptText.ts`
