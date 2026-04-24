# Last QA Run

## Run Details
- **Timestamp**: 2026-04-24T22:23:13.862Z
- **Git SHA**: b76ef3f
- **Duration**: ~17 minutes
- **Pass rate**: 82% (9 pass, 2 warn, 0 fail, 0 error, 0 skip out of 11 goals)
- **Real bugs found**: 1 potential (FP-009: empty chat response body for BYOK Anthropic Opus 4.6)
- **UX gaps found**: 1 (FP-008: pod-not-reachable lag after status=Running)
- **Healer dispatched**: No (deployment deleted for cleanup before investigation)

## Goals Tested

| # | Goal | Type | Status | Notes |
|---|------|------|--------|-------|
| 1 | Diagnose endpoint auth enforcement | API | PASS | 401 no auth, 404 valid auth + fake ID — refactor to openclaw.diagnostics.ts intact |
| 2 | flows.create with valid nodes | API | PASS | Flow created (flw_cl6wluaggtcb), retrieved, then soft-deleted |
| 3 | flows.generateFromPrompt | API | WARN | 412 PRECONDITION_FAILED — test user has no LLM key (expected behavior, not a bug) |
| 4 | flows.delete cleanup | API | PASS | Soft delete confirmed; flow absent from list |
| 5 | org.list with valid auth | API | PASS | Returns [] for test user with no orgs |
| 6 | Diagnose endpoint unauthenticated | API | PASS | 401 returned correctly |
| 7 | Dashboard loads with org switcher | UI | PASS | Workspace banner, org switcher in profile dropdown, deployment section all present |
| 8 | Agent Teams / Flow Canvas | UI | PASS | 7 Team 1 flows listed; canvas renders with mini-map, zoom, chat/run controls; node badges not shown (flows have empty nodes) |
| 9 | Deployment wizard BYOK Anthropic | UI | PASS | Full 5-step wizard completed; Anthropic key validated; deployment 8uv3e8mpg9uc created; pod provisioned via autoscaler |
| 10 | /d/[id] chat interface | UI | WARN | Pod-not-reachable lag for 2-3 min after Running; chat UI loaded; Opus 4.6 response had empty body after 75s typing indicator |
| 11 | Visual regression (billing, deployments) | UI | PASS | All 3 pages clean; minor billing counter lag noted |

## Key Findings

### Code Change Verified: openclaw.diagnostics.ts Extraction (b76ef3f)
- The refactored `diagnose.ts` → `runOpenClawDiagnostics()` extraction is working correctly
- Auth guard still fires: 401 on missing auth, 404 on valid auth with non-existent deployment
- No 500 errors from the refactoring — extraction is clean

### Deployment Wizard BYOK Works End-to-End
- 5-step wizard: Name → OpenClaw runtime → (optional system prompt) → LLM BYOK Anthropic → Deploy
- Anthropic key validation via API works ("Key validated! Connected to Anthropic." toast)
- Default model shown as "Claude Opus 4.6" in the deploy step
- Autoscaler provisioned a new Hetzner worker (jarble-auto-8uv3e8mpg9uc) for the pod
- Deployment reached Running state in ~3-4 minutes

### Agent Teams Canvas Confirmed Working
- Renders with @xyflow/react grid + mini-map + zoom controls
- Shows 7 "Team 1" flows from test user's existing data
- Left panel: "No deployments yet — Create deployments first, then build your team here"
- Top controls: New / Layout / Save (disabled) / Chat (disabled) / Run / Delete

### TOS Consent Gate Triggered
- On first login with smallradcomp@gmail.com, TOS consent modal appeared (tosAcceptedAt was null)
- User accepted consent before dashboard was accessible — gate working as designed

### WARN: Empty Chat Response Body (FP-009)
- After BYOK Anthropic deployment reached Running, sent "Hello, what can you do?"
- Typing indicator appeared for 75+ seconds
- Assistant message header rendered ("claude-opus-4-6") but body was empty
- "openclaw-control-ui" appeared as sender label (anomalous)
- Deployment was deleted for cleanup — need new repro deployment to investigate Langfuse traces

### WARN: Pod-Not-Reachable Lag (FP-008)
- 2-3 minute window where status=Running but chat iframe returns {"error":"Pod not reachable"}
- Misleading UX — users see green "Running" badge but can't use the agent yet

## Healer Actions
None — deployment was cleaned up before healer could investigate. FP-009 needs a fresh repro.

## Next Run Priorities
1. **INVESTIGATE FP-009**: Create new BYOK Anthropic deployment and check Langfuse traces for empty response; compare with a non-BYOK deployment
2. **Test /d/[id] with non-BYOK deployment** (if one can be provisioned without payment)
3. **Test Agent Teams generateFromPrompt UI** — the "Generate Flow" button in the teams canvas (needs a configured LLM on the test user)
4. **Test /orgs page** — new page never tested end-to-end via UI
5. **Test Files panel** in /d/[id] — Files icon was visible but not clicked this run
6. **Test Control UI** deep-dive (openclaw-control-ui interaction after pod fully warms up)
