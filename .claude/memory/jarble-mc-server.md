---
name: jarble-mc Minecraft server
description: Hetzner CPX41 hosting the Jarble team's modded Minecraft server (ATM10)
type: reference
originSessionId: 6682e5b7-6cc5-4401-8126-644209832680
---
**Box:** `jarble-mc` — Hetzner CPX41 (8 vCPU / 16 GB / 240 GB), Ashburn (`ash`), Ubuntu 24.04
**IP:** `5.161.195.44` (server id 128881741)
**Created:** 2026-05-02 by tanner via Hetzner API (token from `/opt/jarble-agents/.env` on jarble-agents)

**SSH:** `ssh -i ~/.ssh/id_ed25519_hetzner root@5.161.195.44` (uses tanner-local key, id 110445783; brett@jarble id 110221499 also added)

**Firewall:** `jarble-mc-firewall` (id 10921138) — allows SSH 22/tcp, MC 25565/tcp, ICMP, all from any IP.

**Stack:**
- Docker compose at `/opt/minecraft/docker-compose.yml`
- World data + zip at `/opt/minecraft/data/` (bind-mounted to `/data` in container)
- Image: `itzg/minecraft-server:latest`
- TYPE=NEOFORGE, NEOFORGE_VERSION=21.1.224, MC 1.21.1
- Modpack: ATM10 (All The Mods 10) v6.6, installed via `GENERIC_PACK=/data/ServerFiles-6.6.zip`
- 12 GB Java heap, 14 GB container memory limit
- Whitelist + enforce-whitelist ON

**ATM10 reference data (CurseForge):**
- Project ID: 925200
- Slug: all-the-mods-10
- Server pack file ID 7892979 = `ServerFiles-6.6.zip` at `https://edge.forgecdn.net/files/7892/979/ServerFiles-6.6.zip`

**Why we did NOT use AUTO_CURSEFORGE:** Tanner's free CF API key (`$2a$10$...`) doesn't have access to the `/v1/mods/search` endpoint, which itzg's AUTO_CURSEFORGE requires to resolve a slug → project ID. Direct mod lookups (`/v1/mods/{id}`) DO work with that key tier. We bypassed CF entirely by manually downloading the server pack zip and using `GENERIC_PACK` + `TYPE=NEOFORGE`.

**Common ops:**
```bash
# Whitelist a player
docker exec minecraft rcon-cli whitelist add <ign>
# Op
docker exec minecraft rcon-cli op <ign>
# Server logs
docker logs -f minecraft
# Restart
cd /opt/minecraft && docker compose restart minecraft
# Update modpack: download new ServerFiles-X.Y.zip into /opt/minecraft/data/, update GENERIC_PACK in compose, wipe install marker, restart
```

**Future modpack updates:** itzg writes `.installed` markers in `/data` after first GENERIC_PACK install. To force re-extract: delete the markers AND the previous mod files before restart.
