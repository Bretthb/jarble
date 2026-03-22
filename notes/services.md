# Running Services Reference

## Development Services

| Service | Port | Start Command | Purpose |
|---------|------|---------------|---------|
| Jarble API | 3001 | `cd jarble-api-main && npm run dev` | Express + tRPC backend |
| Jarble Frontend | 3000 | `cd Jarble-mvp && npm run dev` | Next.js 15 App Router |
| Neo4j (CodeGraph) | 7474 (HTTP), 7687 (Bolt) | `cd scripts/codegraph && docker compose up -d` | Code analysis graph DB |

## Service Dependencies

```
Frontend (:3000) ──tRPC──> API (:3001) ──> SQLite (local.db)
                                      ──> K8s cluster (prod only)
                                      ──> Stripe (webhooks)
                                      ──> Auth0 (JWT verification)

Claude Code ──MCP/stdio──> CodeGraphContext ──Bolt──> Neo4j (:7687)
```

## API Modes

### Local Development (SQLite)
```bash
cd jarble-api-main
npm run dev:test    # Sets USE_SQLITE=true automatically
```
Uses `local.db` file — no external DB needed. Seeds test user + runtime catalog on startup.

### Against Real K8s
```bash
cd jarble-api-main
export USE_SQLITE=true
npx tsx watch src/index.ts
```
Requires `kubectl` configured and `jarble` namespace in cluster.

## Docker Containers

| Container | Image | Purpose | Auto-start |
|-----------|-------|---------|------------|
| `jarble-codegraph` | `neo4j:5-community` | CodeGraphContext graph DB | Yes (`unless-stopped`) |

### Docker Commands
```bash
# Check running containers
docker ps

# Start codegraph
cd scripts/codegraph && docker compose up -d

# Stop codegraph
cd scripts/codegraph && docker compose down

# View Neo4j browser UI
open http://localhost:7474
# Login: neo4j / codegraph
```

## Bot MCP Tools (16 search/reference tools)

Every deployed bot has access to **16 free MCP search and reference tools** — no API keys needed:
- **Search**: Web Fetch, News Search, Hacker News, GitHub Search, npm Search, Academic Search, Image Search
- **Reference**: Dictionary, Currency Exchange, Timezone, Country Info, Open Library, URL Metadata, RSS Reader
- **Execution**: Code Runner (sandboxed JS)

These complement the 5 original OpenClaw-native tools (Web Search, Weather, Calculator, Wikipedia, Translator) for a total of 21 built-in skills per bot.

## Debug Endpoints (API dev mode only)

```bash
GET  /health                              # Health check
GET  /debug/db                            # Dump all tables
POST /debug/deployment/:id/status         # Force status change
GET  /debug/deployment/:id/pod-status     # K8s pod status
GET  /debug/platform-skills               # Platform skills JSON
```
