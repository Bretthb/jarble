# QA API Tester Memory

## Auth & Token Behavior
- [M2M Token Behavior](feedback_m2m_token_behavior.md) — M2M tokens auto-provision users, return 200 with empty data (not 401)

## Environment Blockers
- [Delegation Credit Blocker](project_delegation_credit_blocker.md) — ops@jarble.ai has no Anthropic credits; delegation framework fires correctly but LLM calls fail

## API Correctness Notes
- [tRPC Procedure Name Corrections](project_trpc_procedure_names.md) — skills.listCatalog (not .list), platformCredentials.getByDeployment (not .list), runtimeCatalog.getById needs numeric id, services.get needs serviceId field, benchmarks.leaderboard needs domainSlug
