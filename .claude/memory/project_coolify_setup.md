---
name: Coolify Setup (Apr 4, 2026)
description: Coolify replaces Vercel for frontend builds/previews — VPS IP, config, GitHub App, DNS
type: project
---

## Coolify VPS
- **Server**: jarble-coolify (Hetzner ID: 125853897)
- **Type**: cpx31 (4 vCPU, 8GB RAM) — resized from cpx11 because Next.js builds need 3-4GB
- **IP**: 178.156.235.35
- **Dashboard**: https://coolify.jarble.ai
- **Cost**: ~$7.50/mo (EUR)
- **GitHub App**: jarble-coolify (App ID: 3276932, Installation ID: 121444969)

## Applications
- **Staging**: jarble:develop branch → dev.jarble.ai (app ID: xotc4h1wvtfy4lanlp2kvo4i)
- **Production**: jarble:main branch → jarble.ai (TBD)
- **Preview URL template**: pr-{{pr_id}}.preview.jarble.ai

## Key Config
- Build Pack: Dockerfile
- Dockerfile Location: /Jarble-mvp/Dockerfile
- Base Directory: / (monorepo root)
- Port: 3000
- Healthcheck: DISABLED in Coolify (Dockerfile HEALTHCHECK also removed — Coolify's rolling update conflicted with it)
- Env vars: NEXT_PUBLIC_* set as build-time variables

## DNS (Cloudflare)
- dev.jarble.ai → A → 178.156.235.35 (proxy OFF)
- *.preview.jarble.ai → A → 178.156.235.35 (proxy OFF)
- coolify.jarble.ai → A → 178.156.235.35 (proxy OFF)
- jarble.ai → still on Vercel (switch after production app is tested)

## What Was Reverted
- All GitHub Actions preview deploy workflows (deploy-frontend.yml, cleanup-preview.yml) reverted
- K8s jarble-preview namespace, wildcard cert, DNS-01 ClusterIssuer deleted
- CORS regex for preview origins removed from API

**Why:** Coolify provides a full team-facing UI (deployments, logs, env vars, preview URLs) that the custom GitHub Actions pipeline didn't have. Reddit consensus + Thales research confirmed Coolify is the best self-hosted Vercel replacement for small teams.

**How to apply:** Frontend changes go through Coolify. API changes still go through K8s/Kubero on the separate cluster.
