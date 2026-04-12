# Overnight QA — Prod Mutation Policy

## When to load
This rule auto-loads when working in QA agent prompts or overnight orchestrator configurations.

## Policy

Overnight QA agents are authorized to perform the following **without confirmation**:

### Safe (always allowed)
- **Read-only queries** against all prod databases (Neon Postgres, K8s API, Langfuse API)
- **HTTP probes** against the API (GET, POST with test payloads, rate-limit testing)
- **kubectl exec** for read-only inspection (env, logs, file listing, mcporter list)
- **Playwright** for UI testing via the existing authenticated session
- **Langfuse queries** for trace inspection and verification
- **Chat messages** via the frontend (agent conversations for testing)
- **Inserting tagged test rows** in non-critical tables (agent_calls, chat_messages) — tag with `TEST:overnight-{date}` prefix

### Allowed with clear tagging
- **Creating test deployments** via the onboarding wizard — name them `qa-test-{date}` and delete after testing
- **Toggling deployment config** (memory scope, model, system prompt) on test deployments only (qa-test-*, t3)
- **Sending adversarial payloads** (XSS, SQL injection attempts, oversized bodies) against the API — these should be rejected by validation layers

### NOT allowed (require explicit user confirmation)
- **Scaling pods to zero** (`kubectl scale --replicas=0`) on any deployment
- **Creating deliberate cycles** in team membership (t1 ↔ t2)
- **Deleting deployments** that the user created (t1, t2, Dev, Dev11122)
- **Modifying the Neon database schema** (ALTER TABLE, DROP, CREATE)
- **Changing Kubero/infrastructure env vars** (NODE_ENV, LANGFUSE keys, etc.)
- **Force-pushing** or editing git history
- **Modifying the `.claude/` directory** or memory files

### Cleanup contract
Any test data created during overnight runs MUST be cleaned up before the session ends:
- Test deployments deleted
- Tagged test rows in agent_calls cleaned up
- Any temporary K8s resources removed
- Git worktrees cleaned up

## How to reference in agent prompts
Include this in overnight QA agent prompts:
```
See .claude/rules/overnight-qa-policy.md for what mutations you ARE and ARE NOT authorized to perform on prod.
```
