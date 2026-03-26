---
description: "Query the CodeGraphContext MCP to understand codebase relationships before starting complex tasks. Shows what files depend on what, call chains, and impact analysis."
---

Before starting this task, use the CodeGraphContext MCP server to understand the relevant code relationships.

If the user specified files or features, query the graph for:
1. **Dependencies**: What does this file import? What imports it?
2. **Call chains**: What functions call into this code? What does it call?
3. **Impact radius**: If I change this file, what else might break?

Use the codegraphcontext MCP tools to query the graph database. Present the findings as a brief impact summary before proceeding with any code changes.

This is especially valuable for:
- Changes to shared code (`shared/component-manifest/`, `jarble-api-main/src/utils/`)
- tRPC router changes (what frontend hooks depend on them?)
- Schema changes (what queries reference these tables?)
- Component changes (what pages render this component?)

After querying, present a concise summary like:
```
Impact Analysis for [file/feature]:
- Direct dependents: [list]
- Indirect dependents: [list]
- Safe to change: [yes/no — explanation]
- Files to verify after change: [list]
```
