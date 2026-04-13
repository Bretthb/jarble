---
name: AI QA blind spots — exploratory vs regression
description: AI agents excel at regression/code-analysis testing but miss emergent bugs from system interactions. Must combine with live exploratory testing.
type: feedback
---

AI QA agents are excellent at:
- Regression testing (unit tests, known patterns)
- Code review (security, correctness, type safety)
- Static analysis (race conditions, missing validation)
- Adversarial input generation (chaos testing)

AI QA agents are BAD at:
- Exploratory testing of novel features (no historical data)
- Emergent bugs from system interactions (bot behavior + session history + frontend rendering)
- UX bugs that require visual inspection (component rendering, layout issues)
- Bugs that only appear in production-like environments (pod exec, PVC, real LLM responses)

**Bugs that only live testing caught in this session:**
1. Library save format mismatch — executeListArtifacts dropped format arg (found via Playwright click test)
2. "Webchat without dashboard" refusal — session history pollution (found via live delegation)
3. Think tag leak <think" — malformed LLM output (found via live chat observation)
4. Bar chart delegation crash — 60s timeout too short (found via live parallel delegation)

**Rule: Every QA cycle must include:**
1. Code-level agents (regression, security, correctness) — automated
2. Live Playwright testing (click through the actual UI) — semi-automated
3. Real bot conversation testing (send actual messages, check responses) — requires live pods
4. "Bad user" simulation (garbage input, abandon flows, rapid clicking) — semi-automated

**The combination works. Neither alone is sufficient.**

Source: Reddit post on AI QA failures — "AI is a tool, not a replacement"
