---
name: Never auto-merge to main
description: Do not merge develop to main without explicit user approval. All work stays on develop.
type: feedback
originSessionId: c15213cf-e687-4400-ad85-03c7babc46c4
---
NEVER merge develop to main automatically. All work stays on develop until the user explicitly says to merge.

**Why:** During the April 9, 2026 session, I merged to main ~8 times to "trigger deploys," which caused a cascade of Coolify builds that crashed the frontend VPS. The user's dev environment (dev.jarble.ai) may pull from either main or develop — confirm the branch before merging.

**How to apply:** When the user says "deploy" or "push," push to develop only. When the user explicitly says "merge to main" or "deploy to production," then merge. Ask first if unsure.
