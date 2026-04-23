# scripts/

Ops, dev, and QA scripts used outside the app runtime. Anything you add here that isn't self-evident from its filename should get a one-liner below.

## Developer helpers

- **`monitor.mjs`** — Opens a Playwright Chromium window against a local dev URL (default `http://localhost:3000`), streams console errors/warnings, network failures, and page errors to stdout. Useful for catching hydration/SSR issues while iterating on the UI. Run: `node scripts/monitor.mjs [url]`.
- **`setup.sh`** — Run once after cloning on a new machine. Restores committed `.claude/` memory and installs API + frontend deps. See `CLAUDE.md` "Developer Portability".

## Build / codegen

- **`check-manifest.ts`** — CI hook that verifies `shared/component-manifest` stays in sync with the canvas components and the MCP server's component list. Run via `pnpm run check:manifest` from `Jarble-mvp/`.
- **`generate-mcp-manifest.ts`** — Emits the component metadata snapshot that the MCP server embeds. Run if you edit components in `shared/component-manifest`.

## DB / data ops (prod-touching — be careful)

- **`audit-stale-flow-deployment-ids.mjs`** — Reports `flow_deployments` rows that reference deployment IDs that no longer exist in `deployments`. Read-only.
- **`cleanup-stale-flow-deployment-ids.mjs`** — Deletes the stale rows the audit script reports. Writes to the DB. Run with `--dry-run` first.
- **`neon-cleanup.mjs`** — Drops dev Neon branches older than a threshold to keep the Neon project under its branch quota.

## MCP / agent tooling

- **`cgc-mcp.sh`**, **`jarble-debug-mcp.sh`** — Shell wrappers that launch Claude-Code-compatible MCP servers pointed at this repo, so local agents can exec tools against the running platform.
- **`generate-mcp-manifest.ts`** — See above.
- **`agent-dev/`** — Agent development helpers used when iterating on an agent runtime locally (not invoked by CI).
- **`codegraph/`** — Code-graph indexing utilities used by the codegraph MCP server.

## QA

- **`nightly-qa/`** — Overnight agentic QA system. Entry point: `node scripts/nightly-qa/overnight-agent.mjs --cycles N`. See `CLAUDE.md` "Agentic Overnight QA System".
- **`qa-teams.mjs`**, **`qa-teams-delegation.mjs`**, **`qa-teams-extensive.mjs`**, **`qa-teams-extensive/`** — Older script-based QA harnesses. Being phased out in favour of `nightly-qa/`; kept while the orchestrator absorbs remaining coverage.
- **`deployment-testing/`** — Smoke tests that exercise the deploy → start → chat → stop lifecycle end-to-end against a real Neon branch + K8s cluster.

## Linear integration

- **`linear/`** — Scripts that power the Linear-driven team workflow. Entry points: `nightly-sync.mjs` (cron), `list-crew.mjs`, `branch-status.mjs`. See `CLAUDE.md` "Team Workflow (Linear-Driven)" and `.claude/rules/linear-workflow.md`.

## Claude Code hooks

- **`claude-hooks/`** — Scripts invoked by Claude Code hooks (`SessionStart`, `Stop`, `PostToolUse`). Not meant to be run by hand. Changes here also require changes to `.claude/settings.json` and/or the hook bodies in `.claude/hooks/`.
