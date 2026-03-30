---
description: 'Create a well-structured Linear ticket from a description or bug report'
---

# Create Linear Ticket

The user wants to create a Linear ticket. Input: $ARGUMENTS

## Step 1: Understand the Request

Parse the user's description. Determine:
- Is this a bug, feature, improvement, or infrastructure task?
- What is the scope?
- Which part of the codebase is affected?

## Step 2: Research Context

Before writing the ticket:
- Read relevant source files to understand current state
- Check for related existing tickets (search Linear)
- Identify dependencies

## Step 3: Draft the Ticket

Use the standard template from CLAUDE.md:

**Title**: Clear, actionable summary (not vague)

**Description**:
- Scope: specific files and modules affected
- Context: why this matters
- Acceptance criteria: testable, checkboxable items
- References: relevant files and docs
- Dependencies: what this blocks or is blocked by

**Labels**: bug / feature / improvement / infrastructure
**Priority**: urgent / high / medium / low
**Project**: Assign to the appropriate Linear project

## Step 4: Present for Review

Show the drafted ticket to the user. Wait for approval or edits before creating it in Linear.

## Step 5: Create

Create the issue via Linear API/MCP. Confirm with the ticket ID (e.g., JAR-XX).
