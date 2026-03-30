---
description: 'Review and triage Linear backlog - prioritize, estimate, and organize tickets'
---

# Triage Linear Backlog

Review the current Linear backlog and help organize it.

## Step 1: Fetch Open Issues

Pull all issues in Triage or Backlog status from Linear.

## Step 2: For Each Issue

Evaluate:
- Is the description clear enough to work on? If not, flag it.
- What priority should it be? (urgent/high/medium/low)
- What labels apply? (bug/feature/improvement/infrastructure)
- Does it have acceptance criteria? If not, suggest them.
- Are there dependencies on other tickets?
- Estimated size: small (< 1hr), medium (1-4hr), large (4hr+)

## Step 3: Present Summary

Show a table:
| Ticket | Title | Suggested Priority | Size | Issues |
|--------|-------|--------------------|------|--------|

Flag any tickets that:
- Are duplicates
- Are too vague to work on
- Should be broken into smaller tickets
- Are blocked by unresolved dependencies

## Step 4: Apply Changes

After user approval, update priorities, labels, and add missing acceptance criteria in Linear.
