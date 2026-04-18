---
name: Agent Forking Flywheel — Implementation Status
description: Phase 1+2 implementation of agent forking, public leaderboard, platform credentials, resource tiers. Tracks what's built vs what's next.
type: project
---

## Agent Forking Flywheel — Built on 2026-03-19

### Phase 1 (Complete)
- **Public Leaderboard API**: `GET /api/public/leaderboard/:domainSlug` + `GET /api/public/agents/:deploymentId/profile`
- **Forkability Scoring**: `computeForkabilityScore()` in `src/utils/forkability.ts` — 0-100 score based on 7 criteria
- **Admin Curation**: `benchmarks.adminFeature` / `benchmarks.adminUnfeature` tRPC mutations

### Phase 2 (Complete)
- **`isPlatform` column** on deployments — marks platform-managed agents
- **`resourceTier` column** + `RESOURCE_TIERS` constant — small/medium/large presets
- **`llmMode: "platform"`** — agents use Jarble's own API key, not user keys
- **Platform key injection** in `openclaw.ts:getSecretEntries()` — injects `AGENT_LLM_API_KEY`
- **`deployment.platformFork`** — Admin-only tRPC mutation to fork any deployment as platform agent
- **Enforcement bypasses** — platform agents skip subscription + storage enforcement
- **`create`/`update` desync fix** — both mutations correctly set `isPlatform` when `llmMode = "platform"`

### Also Built
- **`compose_dashboard` MCP tool** + `POST /api/pod/compose` — parallel component generation (N agents concurrently)

### Phase 3 (Not Yet Built)
- Auto-fork top agents on curation
- Regression detection (sample calls, compare to parent scores)
- Canary rollout (5% → 100% traffic ramp)
- Cluster autoscaler integration

**Why:** The flywheel creates compounding quality — users build better agents, top agents get forked as platform services, platform quality rises for everyone.

**How to apply:** When building agent features, consider forkability. Agent configs should be portable (no hard coupling to user/pod). Platform agents use `AGENT_LLM_API_KEY` env var.
