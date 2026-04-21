---
name: feedback_overnight_qa
description: Overnight QA runs on a different computer than the main dev machine — .env must be manually created after cloning
type: feedback
---

Overnight QA testing runs on a separate computer from the main development machine.

**Why:** The developer switches between machines. The overnight runner needs servers running for 8+ hours, so it runs on a dedicated machine while the dev machine is used for coding.

**How to apply:**
- Everything needed is committed to git except `scripts/nightly-qa/.env` (gitignored, contains Auth0 credentials + Anthropic key)
- After cloning/pulling on the QA machine, the `.env` must be manually created
- The README at `scripts/nightly-qa/README.md` documents the full setup
- Consider adding a `.env.example` for the QA machine setup
