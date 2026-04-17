---
description: 'Parse ROADMAP.md and dispatch feature blocks to Linear as per-assignee tickets with Claude Code prompts embedded'
---

# Dispatch Roadmap to Linear

You are splitting `ROADMAP.md` into Linear tickets and assigning them across the crew. The rest of the system (hooks, nightly sync) depends on those tickets being well-formed, so quality matters more than speed. Follow the steps below exactly.

Input (optional): $ARGUMENTS — may contain filter hints like `epic=linear-workflow`, `dry-run`, `--skip-preview`. Treat unknown tokens as narrative and ignore.

## Step 1: Collect inputs

Read these files in full:
- `ROADMAP.md`
- `.claude/crew.json`
- `CLAUDE.md` — specifically the "Ticket Quality Standards" section for the template the drafts must follow
- `.claude/rules/linear-workflow.md` — the policy for this command

If `LINEAR_API_KEY` is not set in the environment, tell the user to export it and stop.

## Step 2: Delegate planning to the `ticket-dispatcher` agent

Launch the `ticket-dispatcher` subagent (Opus) and pass it the full roadmap text, the parsed `crew.json`, and the CLAUDE.md ticket template. The agent will:

1. Parse every `### Feature:` block and produce a list of proposed ticket drafts.
2. Split any feature it judges >4h into multiple tickets (prefer several small ones over one large one).
3. Apply the assignee rules: explicit `@handle` wins, otherwise fall back to the `owns` match in `crew.json`, otherwise `defaultAssignee`.
4. For each crew member, check `listOpenIssues({ assigneeId })` via the Linear GraphQL client and warn if the dispatch would push that member past `maxOpenTicketsPerMember`.
5. Check for existing tickets with matching `{#feature-slug}` or near-identical titles — suggest updating instead of creating duplicates.
6. Embed the `## Claude Code Prompt` block inside each draft description (see template in the agent file).
7. Encode cross-feature `Depends on:` lines as blocks/blocked-by relations in the preview table.

## Step 3: Show the preview table to the user

Present a markdown table in the chat — **nothing is written to Linear yet**:

| # | Proposed title | Assignee | Size | Priority | Labels | Files | Depends on | Notes |
|---|----------------|----------|------|----------|--------|-------|-----------|-------|

Below the table, list any warnings (over-capacity assignees, possible duplicates, missing linearUserId).

## Step 4: Interactive edit loop

Wait for the user to respond. Accept commands until they say `approve all` or `cancel`:

- `N: assign=@handle` — override assignee on row N
- `N: priority=high` — change priority on row N
- `N: size=small` — change size on row N
- `N: split` — split row N into two smaller tickets; ask for titles
- `N: skip` — drop row N from the dispatch
- `merge N+M` — combine rows N and M into one ticket
- `approve all` — proceed to Step 5
- `cancel` — abort without writing anything

After each command, re-print the updated table.

## Step 5: Create the tickets in Linear

On `approve all`, call the Linear MCP (preferred) or the `createIssue` helper in `scripts/linear/graphql-client.mjs` for each draft:
1. Create the issue with title, description (including the `## Claude Code Prompt` block), assignee, priority, and labels.
2. If any draft has `Depends on: JAR-xx`, call `addBlockingRelation` after both issues exist.
3. Print the resulting `JAR-XXX — <title> — <url>` lines so the user can hand them off.

If any create fails, report which one and stop — do not silently skip. The user can re-run to retry.

## Step 6: Summarize for the user

Print a 5-line summary:
- Count of tickets created
- Count assigned per handle
- Any warnings (over-capacity, duplicates reported)
- Next suggested action (e.g. "run `/dispatch-roadmap dry-run` tomorrow to preview changes")

## Never do

- Do NOT create a ticket without the `## Claude Code Prompt` block.
- Do NOT write to Linear before the user types `approve all`.
- Do NOT create duplicates of existing JAR-* tickets that already match a feature. Suggest updating instead.
- Do NOT modify `ROADMAP.md` — the roadmap is the source, tickets are the output.
