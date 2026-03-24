# Agentic Overnight QA System

An AI-agent-driven testing system that autonomously tests, debugs, and fixes the Jarble platform overnight. Unlike traditional test scripts with hardcoded selectors, this system uses Claude Code subagents that dynamically decide what to test by reading the codebase, interact with the app via accessibility trees (not CSS selectors), and self-heal when the UI changes.

## How It Works

```
overnight-agent.mjs (Node.js loop — runs all night)
  │
  └─→ claude -p --agent qa-orchestrator (headless Claude Code, each cycle)
        │
        ├── Phase 1: Discovery
        │   Reads git diff → what changed since last run
        │   Reads CLAUDE.md → what the platform does
        │   Reads agent memory → what was tested before, what failed
        │
        ├── Phase 2: Test Plan
        │   Generates 5-15 dynamic test goals per cycle
        │   Priority: changed code > regression watchlist > coverage gaps > routine
        │
        ├── Phase 3: Dispatch Agents
        │   ├── qa-explorer-ui  → browses the app via Playwright MCP
        │   ├── qa-api-tester   → tests tRPC endpoints via curl
        │   └── qa-chaos        → adversarial/security testing
        │
        ├── Phase 4: Collect Results
        │
        ├── Phase 5: Heal Failures
        │   qa-healer investigates bugs, applies fixes in a git worktree,
        │   creates draft PRs (never auto-merges)
        │
        ├── Phase 6: Report
        │   qa-reporter generates HTML report + GitHub issues
        │
        └── Phase 7: Update Memory
            Coverage map, failure patterns, flaky areas — persists across runs
```

## Quick Start

### 1. Start Dev Servers

```bash
# Terminal 1 — API (port 3001)
cd jarble-api-main && npm run dev:test

# Terminal 2 — Frontend (port 3000)
cd Jarble-mvp && npm run dev
```

### 2. Set Up Auth

Create `scripts/nightly-qa/.env`:
```bash
# Option A (Recommended): M2M app — no user credentials, auto-refreshes
QA_M2M_CLIENT_ID=6vVAEy1PUtcBN8505727h3RERYP6IMsk
QA_M2M_CLIENT_SECRET=<your M2M client secret from Auth0>

# Option B: email/password for auto-refresh
# QA_EMAIL=your-test-email@example.com
# QA_PASSWORD=your-test-password

# Option C: static JWT token (expires after ~24h, not recommended for overnight)
# QA_AUTH_TOKEN=<your Auth0 JWT token>
```

**Option A (Recommended)**: Use the "Jarble (Test Application)" M2M app. The runner fetches a fresh token before every cycle via client credentials grant. No user account needed, never expires. To get the client secret: Auth0 Dashboard → Applications → "Jarble (Test Application)" → Settings → Client Secret.

**Option B**: Use `QA_EMAIL` + `QA_PASSWORD` with the password grant. Requires enabling the Password grant type in Auth0.

**Option C**: Paste a static JWT from your browser. Works for quick tests but expires after ~24 hours.

**Auth0 M2M Setup (Option A)**: The M2M app must be authorized to access the `https://api.jarble.ai` API. In Auth0 Dashboard → Applications → APIs → your API → Machine to Machine Applications → authorize "Jarble (Test Application)".

### 3. Run

```bash
# Single test cycle (good for testing)
node scripts/nightly-qa/overnight-agent.mjs --cycles 1 --verbose

# Overnight run (default: 45min intervals, $200 budget cap)
node scripts/nightly-qa/overnight-agent.mjs

# Focus on a specific area
node scripts/nightly-qa/overnight-agent.mjs --focus "deployment wizard"

# Custom interval and budget
node scripts/nightly-qa/overnight-agent.mjs --interval 30 --max-budget 30 --nightly-budget 150
```

### 4. Check Results

- **Reports**: `scripts/nightly-qa/reports/` (HTML + JSON)
- **Fix PRs**: Check GitHub for draft PRs labeled `qa-auto-fix`
- **Issues**: Check GitHub for issues labeled `qa-nightly`
- **Memory**: `.claude/agent-memory/qa/` for accumulated knowledge

## CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--interval <min>` | 45 | Minutes between cycles |
| `--focus <area>` | (none) | Focus testing on a specific area |
| `--max-budget <usd>` | 50 | Max API cost per cycle |
| `--nightly-budget <usd>` | 200 | Max total cost for the night |
| `--base-url <url>` | http://localhost:3000 | Frontend URL |
| `--api-url <url>` | http://localhost:3001 | API URL |
| `--cycles <n>` | unlimited | Max number of cycles to run |
| `--verbose` | false | Show full Claude Code output |

## Agents

### qa-orchestrator (Opus)
The brain. Reads git diffs, CLAUDE.md, and agent memory to decide what to test. Generates test goals dynamically and spawns specialist agents. Never tests things itself — only coordinates.

### qa-explorer-ui (Opus)
Browser testing agent. Uses Playwright MCP to navigate the running app. Interacts via the **accessibility tree** (roles, names, refs) instead of CSS selectors. This means:
- If a button label changes from "Deploy" to "Launch", the agent still finds it
- If the page layout changes, the agent adapts by reading what's actually there
- No test scripts to maintain — the agent understands intent

### qa-api-tester (Sonnet)
Tests tRPC endpoints and REST routes directly via curl. Discovers available procedures by reading router files. Tests auth enforcement, CRUD operations, input validation, error handling, and response times.

### qa-chaos (Sonnet)
Adversarial testing: XSS payloads, SQL injection, prototype pollution, path traversal, race conditions, and rapid UI interactions. Reports security vulnerabilities with severity levels (CRITICAL/HIGH/MEDIUM/LOW).

### qa-healer (Opus)
Autonomous bug fixer. Receives failure reports, investigates root causes, and classifies issues:
- **REAL_BUG** → applies fix in a git worktree, runs typecheck + tests, creates draft PR
- **FLAKY_AREA** → records in memory, skips
- **EXPECTED_CHANGE** → updates test expectations in memory
- **ENVIRONMENT_ISSUE** → suggests restart
- **SKIP** → cannot determine cause

**Guard rails**: Never modifies package.json, schema files, auth code, or infra. Max 50 lines per fix. Always uses git worktree (never touches running dev server). PRs are always draft.

### qa-reporter (Sonnet)
Generates self-contained HTML reports with a dark-theme dashboard, per-goal results, healer outcomes, and coverage data. Creates GitHub issues for unfixed bugs (checks for duplicates first).

## How It Grows Automatically

The system discovers new features without any script updates:

| You Add... | Agent Detects Via... | What Happens |
|------------|---------------------|--------------|
| New page (`app/analytics/page.tsx`) | `git diff` shows new file | Explorer navigates to `/analytics` |
| New tRPC router | New import in `src/trpc/index.ts` | API tester reads router, tests procedures |
| New canvas component | New `Canvas*.tsx` file | Explorer triggers it via chat |
| New wizard step | Changes in `wizardStepConfig.ts` | Explorer runs the wizard |
| Any untested route | Coverage gap in memory | Orchestrator prioritizes it next cycle |

## Memory System

Persistent knowledge in `.claude/agent-memory/qa/`:

| File | Purpose |
|------|---------|
| `MEMORY.md` | Index with stats and key findings |
| `coverage.md` | What routes/endpoints were tested, when, pass/fail |
| `failure-patterns.md` | Recurring issues and their root causes |
| `flaky-areas.md` | Intermittent failures agents should expect |
| `regression-watchlist.md` | Fixed bugs being monitored for regression |
| `last-run.md` | Most recent run details for continuity |

Memory persists across sessions via git hooks (session-end syncs to `.claude/memory/`).

## Architecture Decisions

### Why Playwright MCP instead of hardcoded Playwright scripts?
Traditional E2E tests use CSS selectors (`button.submit-btn`, `#deploy-form`). When UI changes, selectors break. Playwright MCP exposes the **accessibility tree** — agents find elements by their semantic role and name (`button "Deploy"`, `textbox "Deployment name"`). This is inherently self-healing.

### Why Claude Code subagents instead of a test framework?
Test frameworks execute static scripts. Subagents **reason** about what they're seeing. If a page shows an unexpected error, a test script fails with "element not found." An agent reads the error, takes a screenshot, and reports what went wrong. It can also adapt and try alternative paths.

### Why git worktree for the healer?
The healer needs to modify code and run typecheck/tests without disrupting the running dev servers. A git worktree creates an isolated copy of the repo at `/tmp/jarble-qa-fix`. The main working directory (where `tsx watch` and `next dev` run) is never touched.

### Why sequential agent execution?
Claude Code subagents share the Playwright MCP browser instance. Running them in parallel would cause conflicts. The orchestrator runs agents one at a time — this is reliable and keeps each agent's context clean.

## File Structure

```
scripts/nightly-qa/
├── overnight-agent.mjs       # Overnight runner loop
├── overnight.mjs             # Legacy runner (static personas)
├── orchestrator.mjs          # Legacy orchestrator (static personas)
├── README.md                 # This file
├── .env                      # Auth tokens (gitignored)
├── .qa-state.json            # Run state (gitignored)
├── .qa-lock                  # Cycle lock file (gitignored)
├── reports/                  # Generated reports (gitignored)
├── lib/                      # Legacy helpers
│   ├── auth.mjs              # Auth0 token injection
│   ├── browser.mjs           # Playwright browser session
│   ├── apiClient.mjs         # API client
│   ├── reporter.mjs          # HTML report generator
│   └── types.mjs             # Types and constants
└── personas/                 # Legacy static persona scripts (25 files)

.claude/agents/
├── qa-orchestrator.md        # QA brain
├── qa-explorer-ui.md         # Browser testing agent
├── qa-api-tester.md          # API testing agent
├── qa-chaos.md               # Adversarial testing agent
├── qa-healer.md              # Bug fixer agent
└── qa-reporter.md            # Report generator agent

.claude/agent-memory/qa/
├── MEMORY.md                 # Index
├── coverage.md               # Coverage tracking
├── failure-patterns.md       # Known failures
├── flaky-areas.md            # Intermittent issues
├── regression-watchlist.md   # Monitored fixes
└── last-run.md               # Last run state
```

## Cost Estimation

Each cycle spawns 3-6 Claude Code subagents (Opus + Sonnet). Typical costs:
- **Single cycle**: $5-20 depending on how many goals
- **Full overnight** (8 hours, 10 cycles): $50-150
- Budget caps prevent runaway costs (`--max-budget` per cycle, `--nightly-budget` total)

## Troubleshooting

**"Servers not reachable"**: Start both dev servers before running the overnight script.

**"No QA_AUTH_TOKEN found"**: Create `scripts/nightly-qa/.env` with your Auth0 JWT token.

**"Auth token is expired"**: Get a fresh token from the browser after logging in. For long overnight runs, consider using Auth0 M2M tokens which have longer lifetimes.

**"Another QA cycle is running"**: A previous cycle didn't clean up its lock file. Delete `scripts/nightly-qa/.qa-lock`.

**"Cycle timed out"**: A cycle exceeded the 30-minute limit. This usually means the orchestrator spawned too many test goals. Use `--focus` to narrow scope.

**Healer created a bad PR**: All healer PRs are drafts. Review before merging. The healer never modifies critical files (schema, auth, infra).
