# Contributing to Jarble

How we work together — humans and AI — on this codebase.

---

## Quick Start

```bash
git clone https://github.com/Jarble-AI/jarble.git
cd jarble
bash scripts/setup.sh          # Install deps, set up env files
# Fill in .env.local values from the team secrets doc
# Point DATABASE_URL at a Neon dev branch (no SQLite provider exists at runtime)
cd jarble-api-main && npm run dev        # API on :3001
cd Jarble-mvp && pnpm run dev            # Frontend on :3000
```

## Branches

Only two long-lived branches exist:

| Branch | Purpose | Deploys to |
|--------|---------|------------|
| `develop` | Active development, team testing | `dev.jarble.ai` |
| `main` | Production releases | `jarble.ai` |

Always branch from `develop`. Branch naming:

```
feature/jar-XX-short-description
fix/jar-XX-short-description
cleanup/short-description
infra/short-description
```

## Commit Messages

```
<imperative summary, under 72 chars> (JAR-XX)
```

Examples:
- `Add email validation to auth flow (JAR-12)`
- `Fix plus-sign encoding in login (JAR-15)`
- `Remove unused marketplace imports (JAR-18)`

Never commit code that doesn't build. Run the check first:
- Frontend: `cd Jarble-mvp && pnpm run check`
- API: `cd jarble-api-main && npm run typecheck`

## Pull Requests

PRs go to `develop`. Include:
- Summary of what changed and why
- `Resolves JAR-XX` to auto-link Linear
- Build verification (typecheck + test results)

---

## Working with Claude Code

Every developer on this repo uses Claude Code. The following conventions exist so Claude behaves consistently regardless of who's prompting it.

### How It Works

Claude Code reads `CLAUDE.md` and `.claude/rules/` at the start of every session. These files are the "system prompt" for the repo — they tell Claude about our architecture, patterns, conventions, and guardrails. **You don't need to explain the project to Claude every time.** It already knows.

Additionally, `.claude/settings.json` configures:
- **MCP servers** — Linear, Neon, Auth0, Playwright, Chrome DevTools, etc.
- **Hooks** — auto-format on file edit, lockfile protection, typecheck gates
- **Session hooks** — memory sync on start/stop

### The Golden Rules

1. **Be specific, not vague.** "Fix the login bug where emails with + signs cause 500 errors in auth.ts" beats "fix login".

2. **Reference the ticket.** Start with "Work on JAR-XX" — Claude will fetch the ticket details from Linear and follow the acceptance criteria.

3. **Don't re-explain the architecture.** Claude reads CLAUDE.md. You don't need to say "we use tRPC with Zod v3 on the API side" — it already knows. Focus on *what you want done*.

4. **Use skills for standard workflows.** Don't manually describe multi-step processes — use the built-in slash commands (see below).

5. **Let Claude self-review.** After implementation, Claude should run the code-reviewer agent before you push. If it doesn't do this automatically, ask: "review your changes".

6. **Don't skip the typecheck.** Hooks gate commits, but if you're iterating fast, run `/deploy-check` before pushing to catch cross-project breakage.

### Slash Commands (Skills)

These are standardized workflows. Use them instead of writing long prompts:

| Command | What It Does |
|---------|-------------|
| `/deploy-check` | Run both typechecks + both test suites (catches Zod v3/v4 split issues) |
| `/new-router` | Scaffold a tRPC router with auth, Zod v3, registration |
| `/new-platform` | Add a messaging platform (all 5 touchpoints on the harness handler) |
| `/context` | Query CodeGraphContext MCP for dependency analysis before complex tasks |
| `/qa` | Run the agentic QA system locally (uses Max subscription, no API cost) |

### Prompt Patterns That Work

**Starting a ticket:**
```
Work on JAR-34. Read the ticket, plan the approach, and check with me before coding.
```

**Bug fix:**
```
Users report 500 errors when creating deployments with special characters in the name.
Trace the issue from deployment.create in the tRPC router through to K8s resource creation.
```

**New feature:**
```
Add a "duplicate deployment" button to the dashboard. It should copy all config
except the name (append " (copy)"). Use the existing deployment.create mutation.
```

**Refactoring:**
```
The deployment router is 2200 lines. Extract the billing-related procedures
(cancel, reactivate, linkSubscription) into a new file. Don't change any behavior.
```

### Prompt Patterns That Don't Work

- "Make it better" — better how?
- "Fix the tests" — which tests? What's failing?
- "Refactor everything" — scope it down
- "Do what you think is best" — Claude will over-engineer. Be specific.
- Pasting a full error log with no context — tell Claude what you were doing when it happened

### Agents

Pre-configured agents live in `.claude/agents/`. Claude will use them automatically when relevant, but you can also invoke them directly:

| Agent | When to Use |
|-------|-------------|
| `code-reviewer` | After writing code — catches bugs, security issues, dead code |
| `jarble-api-debugger` | Tracing errors through tRPC procedures, services, K8s, SSE |
| `nextjs-frontend-debugger` | Hydration mismatches, React Query cache issues, SSE problems |
| `drizzle-db-schema` | Adding tables/columns (must update all 3 schema files) |
| `test-writer` | Writing tests for new features or debugging test failures |
| `k8s-pod-lifecycle-debugger` | Pod stuck in Pending, PVC mount failures, crash loops |
| `stripe-webhook-debugger` | Subscription not linking, webhook signature failures |
| `terraform-infra` | Hetzner/K3s infrastructure changes |
| `docs-updater` | Keeping API-ENDPOINTS.md, DEVELOPER-GUIDE.md in sync |
| `runtime-handler` | Adding Agent Harnesses, modifying config rendering, secret mapping |
| `openclaw-diagnostics` | Gateway timeouts, chat failures, model switch issues |
| `canvas-component-builder` | **Deprecated.** Jarble no longer ships canvas components — the harness owns its own webchat UI. |

### What Claude Enforces Automatically

These are handled by hooks in `.claude/settings.json` — you don't need to ask for them:

- **Auto-format** — Files are formatted after every edit
- **Lockfile protection** — Can't accidentally edit `pnpm-lock.yaml` or `package-lock.json`
- **Typecheck gate** — Checks run before commits
- **Memory sync** — Session context is saved/restored automatically

### Updating the Rules

If you find Claude repeatedly making the same mistake or missing a convention:

1. **Fix the root cause** — update `CLAUDE.md` or the relevant `.claude/rules/` file
2. **Don't just tell Claude in chat** — that only lasts one session
3. **Commit the rule change** — so every developer benefits

Example: if Claude keeps adding `console.log` to production code, add a rule to `.claude/rules/` rather than telling it "don't add console.log" every session.

---

## Package Managers

This is a common gotcha:

| Directory | Package Manager | Lockfile |
|-----------|----------------|----------|
| `Jarble-mvp/` | **pnpm** | `pnpm-lock.yaml` |
| `jarble-api-main/` | **npm** | `package-lock.json` |

Never use npm in the frontend or pnpm in the API. The lockfile hook will block it.

## Database Changes

The platform runs on **Postgres only**, via Neon. MySQL and SQLite providers were removed in commit `388018b`. The single source of truth for the schema is:

- `jarble-api-main/src/db/schema.pg.ts`

When adding tables or columns:

1. Edit `schema.pg.ts`.
2. Hand-write the migration `.sql` file under `drizzle-pg/` with the next sequential number — production applies via `src/db/migrate.pg.ts` on pod start, not `drizzle-kit migrate`.
3. Mirror the column in the unit-test SQLite mirror (`src/__tests__/helpers/testSchema.sqlite.ts` AND the raw `CREATE TABLE` block in `src/__tests__/helpers/testDb.ts`). The mirror is for Vitest only — it is not a production provider.
4. Apply locally via `npx tsx src/db/migrate.pg.ts` against a Neon dev branch.

Use the `drizzle-db-schema` agent — it knows the pattern.

## Security

Before any commit:
- No hardcoded secrets (API keys, passwords, tokens)
- All user inputs validated (Zod on the API, which uses v3)
- No `console.log` in production code
- Error messages don't leak sensitive data

**Production secrets never exist on developer machines.** They live in K8s secrets and GitHub Actions secrets only.

## Questions?

- Check `CLAUDE.md` for architecture details
- Check `docs/DEVELOPER-GUIDE.md` for a plain-English walkthrough
- Check `docs/API-ENDPOINTS.md` for the full API reference
- Ask in the team channel
