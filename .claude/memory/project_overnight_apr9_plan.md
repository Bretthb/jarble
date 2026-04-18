---
name: Overnight work plan (2026-04-09)
description: 7-hour autonomous overnight session — bug fixes, observability, QA
type: project
originSessionId: c15213cf-e687-4400-ad85-03c7babc46c4
---
Session goal: ship bug fixes + continue JAR-51 observability + run extensive QA orchestrator while user sleeps. Work is autonomous — no confirmations.

## Tier 1 (must-do)
1. Fix restart race condition ("Cannot restart deployment that is reloading" popup) — visible when toggling memory scope in ConfigPanel
2. Session mode bot compliance — openclaw system prompt must tell bot to pass session_id when memoryScope=session (PR #75 is dead without this)
3. Full qa-orchestrator run in background
4. Live smoke test all 12 tonight's PRs (#67-80)

## Tier 2 (should-do)
5. OpenLLMetry for LLM spans (Anthropic/OpenAI auto-instrumentation)
6. Debug drawer frontend — render agent_calls tree by trace_id
7. Fix Kubero UI env var rendering (vue stale state)
8. Fix anything QA agents report (via qa-healer)

## Tier 3 (nice-to-have)
9. Cross-pod traceparent CONSUME side — research openclaw W3C support
10. Runaway cost circuit breaker (JAR-51 Phase 5)
11. Fractal vision gap audit pieces
12. Legacy IDB cleanup (#47)

## Guardrails
- Every change via PR with tests + typecheck
- No force-push, no main edits
- High-risk = DRAFT PR with notes
- No DB DROPs, no force-delete of deployments
- Don't touch Stripe/Auth0
- Verify API pod healthy after any rollout

## Morning handoff
- docs/audits/overnight-work-report-apr9.md (full summary)
- List of merged PRs + Linear tickets filed
- Known issues still open
- Recommended next actions
