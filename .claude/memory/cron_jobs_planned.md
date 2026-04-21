---
name: Cron jobs for deployments and subagents (planned feature)
description: Both top-level deployments and OpenClaw subagents need to run on schedules - cron-style triggers for automated agent execution
type: project
---

The user wants cron jobs at TWO levels of the orchestration hierarchy:

1. **Deployment-level cron**: a whole bot runs on a schedule (e.g. "every weekday at 9am, run the daily-news bot")
2. **Subagent-level cron**: a subagent inside an OpenClaw runtime runs on a schedule (e.g. inside one bot, schedule the "research-and-summarize" subagent to run every 6h)

**Why:** This is one of those both-layer features (see jarble_orchestration_layers.md) - it adds value at the outer layer (Jarble triggers a deployment) AND the inner layer (a deployment internally schedules a subagent run). High-leverage feature for the platform's positioning.

**How to apply:** When designing the flow engine or scheduler, plan for BOTH levels. Likely architecture:
- Outer: Jarble adds a `cron` or `schedule` field to deployments, the flow engine has a node type that runs on a schedule, OR a separate K8s CronJob per scheduled deployment
- Inner: OpenClaw runtime exposes a "schedule_subagent" tool (or skill) that registers a recurring trigger inside the bot's own scheduler

This is NOT scoped or shipped yet. File as a future feature ticket. When implementing, coordinate with the team-deployment-bridge work and make sure cron triggers can also fire flow chat sessions (so a scheduled run can use the same delegation contract as a manual chat).
