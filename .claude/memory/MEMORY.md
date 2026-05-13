# Memory Index

## Active policy / decisions
- [Harness + chat-UI policy (2026-05-12)](harness-and-chat-decision.md) — Jarble is an "Agent Infrastructure Platform"; "Agent Runtime" → "Agent Harness" in prose (code identifiers stay); legacy canvas + chat code is deprecated, harness owns chat

## Feedback & preferences
- [feedback_human_workforce_mental_model.md](feedback_human_workforce_mental_model.md) — Jarble is an AI workforce; use "what would a human team do?" as a design compass
- [feedback_deployments_are_atomic.md](feedback_deployments_are_atomic.md) — Deployments atomic, teams fractal orchestration+distributed compute
- [feedback_whatsapp_secondary.md](feedback_whatsapp_secondary.md) — WhatsApp/messaging are secondary; web chat is primary (note: chat now = harness webchat)
- [feedback_component_quality.md](feedback_component_quality.md) — Components must be investor pitch deck quality (applies to legacy canvas surface — see harness-and-chat-decision)
- [feedback_autonomous_overnight.md](feedback_autonomous_overnight.md) — User trusts Claude to work autonomously overnight
- [feedback_no_auto_merge_main.md](feedback_no_auto_merge_main.md) — Don't auto-merge to main without approval
- [feedback_overnight_qa.md](feedback_overnight_qa.md) — Overnight QA preferences and authorization scope
- [feedback_slash_commands.md](feedback_slash_commands.md) — Slash command preferences
- [feedback_deployments_page.md](feedback_deployments_page.md) — Deployments page UX preferences
- [tRPC splitLink for mutations](feedback_splitlink.md) — Never batch mutations with queries

## Active projects
- [Enterprise feature — Phase 1 backend](enterprise-phase1.md) — Org model, account types, agent listings, orgAuth utility
- [project_vision.md](project_vision.md) — Jarble vision snapshot (pre-2026-05; superseded for positioning by PRODUCT.md)
- [project_autoscaling_2026_03_25.md](project_autoscaling_2026_03_25.md) — K3s auto-scaling on nodeManager; JAR-130 (Apr 22) fixed duplicate-InternalIP cloud-init bug

## Infrastructure
- [Infrastructure hosting setup](infra-hosting.md) — Coolify for frontend (dev.jarble.ai, jarble.ai), Kubero for API (api.jarble.ai), both on Hetzner K3s
- [jarble-agents host IP](jarble-agents-host.md) — jarble-agents node at 178.156.231.154 (SSH via id_ed25519_hetzner)
- [project_coolify_setup.md](project_coolify_setup.md) — Coolify VPS setup
- [project_k8s_infra_apr3.md](project_k8s_infra_apr3.md) — K3s + Kubero infra setup
- [prod_deployment_mar25.md](prod_deployment_mar25.md) — Prod deployment notes
- [k8s-architecture.md](k8s-architecture.md) — K8s topology overview
- [infra_docker_builds.md](infra_docker_builds.md) — Docker build pipeline notes
- [staging_pipeline_plan.md](staging_pipeline_plan.md) — Staging pipeline plan

## Side projects (not platform)
- [jarble-mc Minecraft server](jarble-mc-server.md) — CPX41 at 5.161.195.44 running ATM10 v6.6 NeoForge for the team

## Architecture notes
- [orchestration_architecture.md](orchestration_architecture.md) — Orchestration layer overview
- [orchestration_system_mar27.md](orchestration_system_mar27.md) — Orchestration snapshot
- [deployment_orchestration.md](deployment_orchestration.md) — Deployment-side orchestration
- [jarble_orchestration_layers.md](jarble_orchestration_layers.md) — Layer breakdown
- [control_ui_integration.md](control_ui_integration.md) — Control UI proxy integration
- [team_deployment_bridge.md](team_deployment_bridge.md) — Team deployment bridge notes
- [marketplace-install-flows.md](marketplace-install-flows.md) — Marketplace install flow (future feature)
- [project_forking_flywheel.md](project_forking_flywheel.md) — Forking + marketplace flywheel

## Legacy / deprecated areas (do not extend)
- [canvas-workspace-plan.md](canvas-workspace-plan.md) — Canvas workspace plan **(deprecated; see harness-and-chat-decision)**
- [component-audit-report.md](component-audit-report.md) — Canvas component audit **(deprecated)**
- [component-inventory.md](component-inventory.md) — Canvas component inventory **(deprecated)**
- [perf_useCanvasChat_plan.md](perf_useCanvasChat_plan.md) — useCanvasChat perf plan **(deprecated)**
- [custom_themes_skins.md](custom_themes_skins.md) — Custom themes for legacy chat skins **(deprecated)**
- [project_sandbox_first_pivot.md](project_sandbox_first_pivot.md) — Sandbox-first canvas pivot **(deprecated)**
- [project_page_routing.md](project_page_routing.md) — Bot page routing in legacy canvas **(deprecated)**

## Audits & findings
- [security-audit.md](security-audit.md)
- [bugs-and-fixes.md](bugs-and-fixes.md)
- [project_bug_audit_mar20.md](project_bug_audit_mar20.md)
- [project_agent_findings_2026_03_22.md](project_agent_findings_2026_03_22.md)
- [project_audit_2026_03_17.md](project_audit_2026_03_17.md)
- [project_qa_findings_apr10.md](project_qa_findings_apr10.md)
- [error-resilience-audit.md](error-resilience-audit.md)
- [error-resilience-implementation.md](error-resilience-implementation.md)
- [pod-performance-analysis.md](pod-performance-analysis.md)
- [soul-md-audit.md](soul-md-audit.md)

## Session notes
- [project_session_2026_03_23.md](project_session_2026_03_23.md)
- [project_overnight_2026_03_18.md](project_overnight_2026_03_18.md)
- [project_overnight_apr9_plan.md](project_overnight_apr9_plan.md)
- [project_merge_2026_03_22.md](project_merge_2026_03_22.md)
- [cron_jobs_planned.md](cron_jobs_planned.md)
