# Startup Procedures

## Quick Start (Returning Developer)

```bash
# 1. Pull latest
git pull origin main

# 2. Install dependencies
cd Jarble-mvp && npm install
cd ../jarble-api-main && npm install

# 3. Start services
cd jarble-api-main && npm run dev      # API on :3001
cd ../Jarble-mvp && npm run dev        # Frontend on :3000
```

## Full Setup (New Machine)

```bash
# 1. Clone and run the setup script
git clone <repo-url> develop-monorepo
cd develop-monorepo
bash scripts/setup.sh
```

The setup script handles:
- Restoring Claude Code memory from committed `.claude/memory/`
- Installing npm dependencies for both packages
- Setting up CodeGraphContext (Neo4j + graph indexing)

### Manual Steps After Setup

1. **Environment files** — Copy from a teammate or password manager:
   - `jarble-api-main/.env` (DATABASE_URL, Auth0, Stripe, encryption keys)
   - `Jarble-mvp/.env.local` (API URL, Auth0 client config)
   - See `CLAUDE.md > Environment Variables` for the full list.

2. **Verify services**:
   ```bash
   # API health check
   curl http://localhost:3001/health

   # Frontend
   open http://localhost:3000
   ```

3. **Run tests** to confirm everything works:
   ```bash
   cd jarble-api-main && npm test    # 934 backend tests
   cd ../Jarble-mvp && npm test      # 367 frontend tests
   ```

## Bot Skills (21 total)

Every OpenClaw bot ships with **21 built-in skills** — all free, no API keys required.

**5 original OpenClaw-native tools:**
- Web Search, Weather, Calculator, Wikipedia, Translator

**16 new MCP tools:**
- Web Fetch, News Search, Hacker News, GitHub Search, npm Search, Academic Search
- Dictionary, Currency Exchange, Timezone, Country Info, Open Library
- Code Runner, URL Metadata, RSS Reader, Image Search

Skills are seeded into the `skills_catalog` table at startup (SQLite dev mode). Bots can also discover them at runtime via the `skill_reference` MCP tool.

## CodeGraphContext (Graph DB)

Code analysis graph database — indexes all TypeScript source into Neo4j for relationship queries.

### Prerequisites
- Python 3.10+ (`py` on Windows, `python3` on macOS/Linux)
- Docker (for Neo4j container)

### Setup
```bash
bash scripts/codegraph/setup.sh
```

This:
1. Installs `codegraphcontext` via pip
2. Starts Neo4j 5 Community in Docker (`jarble-codegraph` container)
3. Configures credentials (`bolt://localhost:7687`, user: `neo4j`, pass: `codegraph`)
4. Indexes the full monorepo (~7 min on first run)

### Daily Use

Neo4j starts automatically with Docker (`restart: unless-stopped`). If stopped:
```bash
cd scripts/codegraph && docker compose up -d
```

Re-index after major changes:
```bash
cgc index .
```

Watch for auto-reindex (optional):
```bash
cgc watch .
```

### CLI Commands
```bash
cgc stats                              # Graph statistics
cgc find name <function>               # Find a function/class
cgc find pattern <substring>           # Substring search
cgc analyze callers <function>         # Who calls this?
cgc analyze calls <function>           # What does this call?
cgc analyze dead-code                  # Find unused functions
cgc analyze complexity                 # Cyclomatic complexity report
cgc analyze deps <file>                # Module dependencies
```

### Claude Code MCP Integration

The MCP server is configured in `.claude/settings.json`. After restarting Claude Code, these tools become available in conversations:
- `find_code` — Search by keyword
- `analyze_code_relationships` — Callers, callees, imports
- `execute_cypher_query` — Raw Cypher queries
- `add_code_to_graph` — Index new directories
- `watch_directory` — Auto-reindex on changes

### Troubleshooting

**"Database set to neo4j but credentials not found"**
```bash
# Re-run setup
bash scripts/codegraph/setup.sh
```

**Neo4j container not running**
```bash
docker ps --filter name=jarble-codegraph
cd scripts/codegraph && docker compose up -d
```

**Windows encoding errors (emoji/unicode)**
The wrapper script sets `PYTHONIOENCODING=utf-8` automatically. For direct `cgc` CLI usage:
```bash
export PYTHONIOENCODING=utf-8
cgc stats
```

**Re-index from scratch**
```bash
cgc delete .          # Remove current index
cgc index .           # Fresh index
```
