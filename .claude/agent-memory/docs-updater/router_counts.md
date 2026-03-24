---
name: router_counts
description: tRPC router names, procedure counts, and REST endpoint counts as of Session 20 (2026-03-23)
type: reference
---

## tRPC Routers (15 total, 174 procedures)

| Router | Queries | Mutations | Total |
|--------|---------|-----------|-------|
| `deployment` | 14 | 23 | 37 |
| `openrouter` | 3 | 7 | 10 |
| `user` | 2 | 4 | 6 |
| `runtimeCatalog` | 4 | 0 | 4 |
| `billing` | 4 | 0 | 4 |
| `platformCredentials` | 2 | 5 | 7 |
| `template` | 4 | 0 | 4 |
| `skills` | 2 | 2 | 4 |
| `marketplace` | 12 | 11 | 23 |
| `services` | 14 | 12 | 26 |
| `benchmarks` | 7 | 7 | 14 |
| `flows` | 3 | 5 | 8 |
| `admin` | 12 | 7 | 19 |
| `agentCredits` | 3 | 1 | 4 |
| `apiKeys` | 2 | 2 | 4 |
| **Total** | **88** | **86** | **174** |

## REST Endpoints (34 total)

| Category | Count |
|----------|-------|
| REST Webhooks (stripe, auth0, config-changed, tambo-agent, beta-signup) | 5 |
| REST Payment (checkout, portal) | 2 |
| REST Chat (tambo-agent) | 1 |
| REST Artifact | 4 |
| REST Flow Execution (execute, resume, stream) | 3 |
| REST Service Proxy | 1 |
| REST Agent Hub (call, discover) | 2 |
| REST Public API (leaderboard, profile) | 2 |
| REST Pod Compose | 1 |
| SSE Streams (status, logs, qr) | 3 |
| MCP Endpoints | 5 |
| Health/Debug | 5 |
| **Total** | **34** |

## Session History

- Session 19 (2026-03-19): 11 routers, ~96 procedures
- Session 20 (2026-03-23): 15 routers, 174 procedures, 34 REST endpoints

## Doc Header to Use

> Complete reference for every API endpoint in the Jarble platform. Covers all 174 tRPC procedures and 34 REST endpoints.
> Last updated: March 23, 2026 (Session 20)
