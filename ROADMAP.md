# Jarble Roadmap

_Last updated: 2026-04-17 — edit and run `/dispatch-roadmap` to sync to Linear._

This file is the forward-looking counterpart to `CLAUDE.md`. `CLAUDE.md` describes the system as it is today (source of truth for how the platform is built). This roadmap describes what is coming next and who is doing it. The `/dispatch-roadmap` command parses every `### Feature:` block below and turns it into a Linear ticket with the teammate's Claude Code prompt embedded, so the crew can start work with one command.

## How to edit this file

1. Add an **Epic** (`## Epic:`) for each large body of work. An epic represents a milestone or shipped feature set. Epics can map to a Linear project — set the project id in the epic header or leave it as `auto` to let the dispatcher pick.
2. Under each epic, add one or more **Feature** (`### Feature:`) blocks. Each feature becomes one Linear ticket. If a feature will take more than ~4 hours, split it into multiple features up front — the dispatcher will also warn you if it thinks something is too large.
3. Use the fields below exactly as shown. The dispatcher parses them case-sensitively.
4. When the work ships, change `Status:` on the epic to `shipped` and leave the block in the file as a historical record, or move it to a bottom "Shipped" section.

## Feature block schema

```md
## Epic: <name> {#epic-slug}
Status: planned | in-progress | shipped
Linear project: <linear project id or "auto">

### Feature: <name> {#feature-slug}
Assignee: @<crew-handle>
Priority: urgent | high | medium | low
Size: small | medium | large
Labels: feature | bug | improvement | infrastructure
Depends on: JAR-xx (optional)

**Scope:** one-paragraph what + where.

**Acceptance criteria:**
- [ ] testable item 1
- [ ] testable item 2

**Files likely touched:** `path/to/file.ts`, `path/to/other.tsx`
```

Notes:
- `Assignee` is a handle from `.claude/crew.json`. Unassigned features fall back to `defaultAssignee`. You can override per dispatch in the interactive preview.
- `Depends on: JAR-xx` links this ticket as blocked by that issue in Linear.
- `Files likely touched` is passed to the assignee's Claude Code prompt so their session starts with the right context.
- The `{#slug}` anchors are optional today. Keep them stable if you add them — they let the dispatcher recognise an existing feature instead of creating a duplicate.

## Epics

<!--
Real epics go below. Replace this placeholder after the first dispatch. The dispatcher treats anything that does not start with `## Epic:` or `### Feature:` as narrative and ignores it.
-->

## Epic: Linear-driven team workflow {#epic-linear-workflow}
Status: in-progress
Linear project: auto

### Feature: Roadmap dispatcher end-to-end smoke test {#feature-dispatcher-smoke}
Assignee: @brett
Priority: medium
Size: small
Labels: infrastructure

**Scope:** After merging the Linear-driven workflow scaffolding, run the end-to-end smoke test described in `.claude/rules/linear-workflow.md` — dispatch this placeholder feature, work it on a branch, confirm the Stop hook posts a rich Linear comment with mermaid + token-cost footer, and confirm a nightly dry run writes `docs/daily-standup.md`.

**Acceptance criteria:**
- [ ] `/dispatch-roadmap` creates a Linear ticket for this feature with the Claude Code prompt block present.
- [ ] Running Claude Code on the branch posts a session-end comment on the ticket with mermaid diagram and per-session token/cost footer.
- [ ] `node scripts/linear/nightly-sync.mjs --dry-run --cycles 0` writes `docs/daily-standup.md` with at least one ticket referenced.
- [ ] Delete this feature after the smoke test passes (or move it to a "Shipped" section).

**Files likely touched:** `ROADMAP.md`, `docs/daily-standup.md`

## Shipped

_Move finished features here to keep the active section tidy. Optional._
