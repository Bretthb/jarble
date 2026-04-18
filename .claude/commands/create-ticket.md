---
description: 'Create a single Linear ticket from an ad-hoc description. Auto-assigns via crew.json owns, adds collaborators from owns overlap, embeds a Claude Code Prompt block. Use when you notice a bug or small feature that is not already in ROADMAP.md.'
---

# Create Linear Ticket

The user wants to create a single ad-hoc Linear ticket. Input: $ARGUMENTS

This is the single-ticket counterpart to `/dispatch-roadmap`. Output tickets must match the same structure (Claude Code Prompt block, collaborators, crew-based assignment) so the rest of the system — SessionStart hook, Stop hook, nightly sync, branch naming — treats them identically.

## Step 1: Collect inputs

Read:
- `.claude/crew.json` — assignee + collaborator resolution
- `CLAUDE.md` — "Ticket Quality Standards" section for the template
- `.claude/rules/linear-workflow.md` — workflow policy

If `LINEAR_API_KEY` is not set in the environment, tell the user to export it and stop.

## Step 2: Understand the request

From `$ARGUMENTS`, determine:

- **Type** — exactly one of: `bug` | `feature` | `improvement` | `infrastructure`.
- **Title** — specific and actionable. Bad: "Fix login". Good: "Fix plus-sign encoding in login form so '+' in email is not stripped before Auth0 handoff".
- **Area** — the single closest match from the crew's `owns` areas: `infrastructure` | `flow-engine` | `runtime` | `organization-management` | `database-content` | `frontend` | `design` | or a new area that should be added to `crew.json`.
- **Scope paragraph** — one-paragraph what + where (module, route, file).
- **Acceptance criteria** — 2–5 testable checkboxable items.
- **Files likely touched** — best-guess list, grounded in the next step.
- **Priority** — default `medium`; bump to `high` or `urgent` only if the input says so or the issue is plainly a production breaker.

If the input is too vague to determine any of these, ask one round of clarifying questions before drafting. Never fabricate acceptance criteria.

## Step 3: Research context

- Read 1–3 relevant source files to ground the Scope paragraph and the Files list. Do not skip this — a ticket with made-up file paths is worse than no ticket.
- Search Linear via `list_issues` for near-duplicate titles (same team, same intent). If you find a match with ≥80% title similarity or obvious subject overlap, tell the user and ask whether to update the existing ticket (using `save_issue` with `id:`) rather than create a new one.

## Step 4: Resolve assignee and collaborators

**Assignee:**
- If `$ARGUMENTS` contains `@handle`, use it.
- Otherwise, match the Area from Step 2 to each crew member's `owns` list in `crew.json`; pick the closest.
- Otherwise, fall back to `defaultAssignee`.
- If the resolved crew member has empty `linearUserId`, warn (the ticket create will fail on that field).

**Collaborators:**
- If the user named collaborators in `$ARGUMENTS`, use them.
- Otherwise, auto-derive: every other crew member whose `owns` shares at least one area with the assignee's `owns`. Cap at 2.
- If empty, omit the `## Collaborators` section entirely.

## Step 5: Draft the ticket

Use this exact structure (headings verbatim — the SessionStart hook parses `Acceptance criteria`; do not rename):

```
## Scope
<Scope paragraph from Step 2>

## Context
<why this matters — user impact, where it surfaced, any related prior work>

## Acceptance Criteria
- [ ] <item 1>
- [ ] <item 2>

## References
- Relevant files: `path/to/file.ts`
- Source: ad-hoc ticket (not in `ROADMAP.md`)

## Collaborators
- @<handle> (shared area: <area>)

## Dependencies
- Blocked by: JAR-XX (if identified)
- Blocks: (if identified)

## Claude Code Prompt
Paste this into Claude Code (repo root, on the branch `<type>/jar-XX-<slug>`):

\`\`\`text
/work-ticket JAR-XX
\`\`\`
```

Branch-name convention:
- `bug` → `fix/jar-XX-<slug>`
- `feature` → `feature/jar-XX-<slug>`
- `improvement` → `cleanup/jar-XX-<slug>`
- `infrastructure` → `infra/jar-XX-<slug>`

Slug: kebab-case, max 5 words, drawn from the title.

## Step 6: Preview and edit

Show the drafted ticket with the resolved meta up top:

```
Title: <title>
Type: <type>
Area: <area>
Assignee: @<handle>
Collaborators: @<h1>, @<h2>  (or "none")
Priority: <priority>
Labels: <type>
Files: `file1.ts`, `file2.tsx`
Suggested branch: <branch>
```

Then the full description. Accept these commands from the user:

- `approve` — proceed to Step 7
- `edit title=<new title>` — rewrite title
- `edit assignee=@<handle>` — override assignee
- `edit collaborators=@h1,@h2` — set collaborators (empty to clear)
- `edit priority=<urgent|high|medium|low>` — change priority
- `edit type=<bug|feature|improvement|infrastructure>` — change type (also changes branch prefix)
- `edit ac` — replay Step 2 acceptance-criteria extraction with user feedback
- `cancel` — abort without writing to Linear

After each edit, reprint the preview.

## Step 7: Create in Linear

On `approve`, call `save_issue` (Linear MCP) with:
- `team: "JAR"`
- `title`
- `description` — full markdown body from Step 5
- `assignee` — the resolved `linearUserId`
- `priority` — Linear priority mapping: urgent=1, high=2, medium=3, low=4
- `labels` — `[type]`

Linear auto-subscribes users @-mentioned in the description, so collaborators are notified without an extra call.

If the create fails, report the error verbatim and stop — do not retry silently.

## Step 8: Summarize

Print:
```
Created JAR-XXX — <title>
URL: <linear url>
Assignee: @<handle>
Collaborators: @<h1>, @<h2>  (or "none")
Suggested branch: <type>/jar-XXX-<slug>
Next step: git checkout -b <branch>  && open Claude Code  && run `/work-ticket JAR-XXX`
```

## Never do

- Do NOT create a ticket without a `## Claude Code Prompt` block — the rest of the workflow depends on it.
- Do NOT invent acceptance criteria. Ask the user if the input is too vague.
- Do NOT create a duplicate of an existing JAR-* with similar title — offer to update instead.
- Do NOT skip the crew-based assignment step. Random assignment defeats the point of `crew.json`.
- Do NOT write to Linear before the user types `approve`.
- Do NOT modify `ROADMAP.md`. Ad-hoc tickets do not belong in the roadmap.
