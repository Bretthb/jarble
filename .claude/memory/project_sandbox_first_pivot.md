---
name: project_sandbox_first_pivot
description: Sandbox-first rendering strategy — LLMs ignore prompt rules in favor of concrete schemas; may need API-level enforcement
type: project
---

Sandbox-first pivot implemented 2026-03-18. System prompt and component manifests updated to direct bots toward sandbox for dashboards/charts/data viz instead of typed components.

**Why:** Typed Zod schemas reject valid-looking props (numbers vs strings, missing fields), causing render errors. Competitors like blink.new render beautifully because they let the LLM write actual code in sandboxes.

**Problem discovered:** LLMs ignore rule-based instructions ("use sandbox") when concrete schemas are available (metric_card, chart, stat_grid schemas right in the prompt). Tested 3 times — bot still used typed components every time.

**How to apply:** If prompt-level changes continue to fail, implement API-level enforcement in tamboAgent.ts: when the bot emits 3+ typed component blocks (metric_card/chart/data_table) in a single response, auto-convert to a single sandbox component. This is deterministic and doesn't rely on LLM compliance.
