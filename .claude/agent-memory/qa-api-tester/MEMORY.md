# QA API Tester Memory

## Auth & Token Behavior
- [M2M Token Behavior](feedback_m2m_token_behavior.md) — M2M tokens auto-provision users, return 200 with empty data (not 401)

## API Correctness Notes
- [tRPC Procedure Name Corrections](project_trpc_procedure_names.md) — skills.listCatalog (not .list), platformCredentials.getByDeployment (not .list), runtimeCatalog.getById needs numeric id, services.get needs serviceId field, benchmarks.leaderboard needs domainSlug
