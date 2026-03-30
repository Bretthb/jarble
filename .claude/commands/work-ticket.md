---
description: 'Work on a Linear ticket - fetches details, plans, implements, and opens a PR'
---

# Work on Linear Ticket

You are working on a Linear ticket. Follow the development workflow defined in CLAUDE.md.

## Step 1: Parse Input

The user provided: $ARGUMENTS

Extract the Linear ticket identifier (e.g., "JAR-12", "JAR-45") from the input.

## Step 2: Fetch Ticket

Use the Linear MCP tool (or API) to fetch the ticket details:
- Title, description, priority, status, labels
- Parent issue (if any) - read it for full context
- Sub-issues (if any)
- Comments

## Step 3: Read References

If the ticket description mentions specific files, specs, or docs:
- Read each referenced file
- Understand the current state before making changes

## Step 4: Plan

Write a clear implementation plan:
- List each step with the files to modify
- Identify risks or ambiguities
- Estimate complexity (simple / medium / complex)

Present the plan to the user and wait for approval before proceeding.

## Step 5: Implement

1. Create branch from `develop`: `<type>/jar-xx-<slug>`
2. Update ticket status to "In Progress"
3. Write code following project standards
4. Commit incrementally: `<summary> (JAR-XX)`
5. Run builds/tests before each commit

## Step 6: Self-Review

Launch a subagent to review your changes:
- `git diff develop...HEAD`
- Check: bugs, dead code, security issues, missing tests
- Verify all acceptance criteria from the ticket are met

## Step 7: Ship

1. Push branch
2. Create PR with `gh pr create` - include ticket link, summary, build results
3. Update ticket status to "In Review"
4. Add PR link as comment on the ticket
