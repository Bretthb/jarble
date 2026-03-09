# Marketplace Install Flow Research

## Summary

Both component and service install flows follow a similar pattern:
1. **DB validation** — Verify component/service exists and is published, check permissions
2. **Create install records** — Add DB entries (componentInstalls or serviceInstalls)
3. **Update counts** — Increment totalInstalls on component/service
4. **Fire-and-forget PVC sync** — If deployment is running, async sync to pod (non-blocking)

**Key finding**: Component installs are PVC synced immediately via `syncMarketplaceComponent()`. Service installs additionally call `syncConfigsToPvc()` to update soul.md with package snippets and skill files.

---

## Component Marketplace (`marketplace.ts`)

### Table Structure
```
marketplaceComponents {
  id, creatorId, name, displayName, description, category, tier
  propsSchema (JSON Schema string)
  exampleProps (JSON string)
  pricingModel, priceUsdCents, status (draft|submitted|in_review|approved|published|rejected|deprecated)
  totalInstalls, totalRevenueCents, averageRating, ratingCount
  currentVersion, publishedAt, createdAt
}

componentVersions {
  id, componentId (FK to marketplaceComponents)
  version (semver), changelog, packageUrl, packageSizeBytes, manifestHash
  status (published|deprecated)
  createdAt
}

componentInstalls {
  id, componentId (FK), versionId (FK), deploymentId (FK), userId
  pinnedVersion, autoUpdate (boolean), syncedAt, installedAt
  UNIQUE(deploymentId, componentId) — one install per deployment
}

componentPurchases, componentReviews — payment and rating records
```

### install Procedure (marketplace.ts:351-488)

**Input**: `{ componentId, deploymentId, versionId? }`

**Steps**:
1. **Auth check** — User owns deployment (eq deployments.userId)
2. **Component validation** — Component exists & status = "published"
3. **Access check** — If priced component, verify purchase record exists
4. **Already installed?** — Unique(deploymentId, componentId) prevents duplicates
5. **Version resolution** — Use provided versionId or find latest from componentVersions
6. **Create install record** — Insert into componentInstalls with versionId, installedAt
7. **Increment counter** — `totalInstalls += 1` on marketplaceComponents
8. **Logging** — Log to observability
9. **Fire-and-forget PVC sync** (if deployment.status === "running"):
   - Call `syncMarketplaceComponent()` with:
     - componentId, manifest (name, displayName, tier, propsSchema, version)
     - templateOrHtml (exampleProps or propsSchema — fallback to "")
     - tier ("template" | "sandbox")
   - Non-fatal: errors logged but don't fail mutation
10. **Return** — `{ success: true, installedVersion }`

### uninstall Procedure (marketplace.ts:490-539)

**Input**: `{ componentId, deploymentId }`

**Steps**:
1. Auth check, verify install exists
2. Delete from componentInstalls
3. Log
4. Fire-and-forget PVC removal (if deployment.status === "running"):
   - Call `removeMarketplaceComponent()` — removes `/data/marketplace/{componentId}` dir
   - Non-fatal
5. Return `{ success: true }`

### listInstalled Query (marketplace.ts:541-588)
Returns array of installed components with:
- installId, installedAt, versionId, version, component metadata

---

## Service Marketplace (`services.ts`)

### Table Structure
```
marketplaceServices {
  id, creatorId (FK to creatorProfiles), name, displayName, description
  hostingModel ("self-hosted" | "remote" | "hybrid")
  instructionSnippet (appended to soul.md as ## Service: {name})
  remoteApiEndpoint, remoteApiConfig (JSON ServiceCard)
  remoteHealth, remoteLastCheck
  status, pricingModel, priceUsdCents, totalInstalls
  createdAt
}

serviceComponents {
  id, packageId (FK), componentId (FK)
  UNIQUE(packageId, componentId)
}

serviceSkills {
  id, packageId (FK), skillId (FK)
  UNIQUE(packageId, skillId)
}

serviceInstalls {
  id, packageId (FK), deploymentId (FK), userId
  installedAt
  UNIQUE(deploymentId, packageId)
}

serviceCredentials (for remote/hybrid services) {
  id, packageInstallId (FK), deploymentId, packageId
  signingSecret (encrypted HMAC), handshakeStatus (pending|completed|failed)
  handshakeError, remoteInstallId
}

serviceUsage {
  id, packageInstallId, deploymentId, packageId, skillName
  requestCount, billingCycleStart, recordedAt
}
```

### install Procedure (services.ts:215-459)

**Input**: `{ serviceId, deploymentId }`

**Steps**:

**Phase 1: Validation**
1. Auth check — User owns deployment
2. Service validation — Service exists & status = "published"
3. Already installed? — Unique(deploymentId, packageId) prevents duplicates

**Phase 2: Component Installation**
4. Fetch serviceComponents linked to this service
5. For each component:
   - Skip if already installed individually on deployment
   - Find latest version from componentVersions
   - Create componentInstalls record
   - Increment component.totalInstalls
   - Track in installedComponents array

**Phase 3: Skill Installation**
6. Fetch serviceSkills linked to this service
7. For each skill:
   - Skip if already installed on deployment
   - Create deploymentSkills record
   - Track in installedSkills array

**Phase 4: Create Service Install Record**
8. Create serviceInstalls record with installId, packageId, deploymentId
9. Increment service.totalInstalls
10. Log to observability

**Phase 5: Remote/Hybrid Handshake (fire-and-forget)**
11. If hostingModel = "remote" or "hybrid":
    - Parse remoteApiConfig JSON → ServiceCard
    - Generate HMAC-SHA256 signing secret via `generateSigningSecret()`
    - Create serviceCredentials record (encrypted secret, status="pending")
    - Spawn async: `performInstallHandshake()` to notify creator's endpoint
    - Update handshakeStatus to "completed" or "failed" (fire-and-forget)

**Phase 6: PVC Sync (fire-and-forget)**
12. If deployment.status === "running":
    - For each component in installedComponents:
      - Call `syncMarketplaceComponent()` (same as component install)
    - Call `syncConfigsToPvc()` to:
      - Write `/data/skills/{skillName}.json` files for new skills
      - Rebuild `/data/config/soul.md` with appended `## Service: {packageName}` sections
      - Potentially restart deployment if LLM keys changed (tiered strategy)

13. Return `{ success: true, installedComponents, installedSkills, handshakeStatus }`

### uninstall Procedure (services.ts:461-610+)

**Steps**:
1. Auth check, verify install exists
2. Fetch serviceComponents and serviceSkills linked to service
3. For each component:
   - Find componentInstalls record
   - Delete it (mark as uninstalled)
4. For each skill:
   - Find deploymentSkills record
   - Delete it
5. **Remote/Hybrid Webhook** (fire-and-forget):
   - If hostingModel = "remote" or "hybrid":
     - Find serviceCredentials for this install
     - POST to creator's remoteApiEndpoint with:
       - action: "uninstall"
       - deploymentId, packageId, remoteInstallId
     - Non-fatal: continue uninstall even if webhook fails
6. Delete serviceInstalls record
7. Log
8. Call `syncConfigsToPvc()` to:
   - Remove package snippet from soul.md
   - Remove skill files (if no other service uses them)
   - Potentially restart deployment
9. Return `{ success: true }`

---

## PVC Sync Functions

### syncMarketplaceComponent() (configSync.ts:791-831)
Writes a marketplace component to `/data/marketplace/{componentId}/` directory.

**Parameters**:
- deploymentId, componentId
- manifest: { name, displayName, description, tier, category, propsSchema, version }
- templateOrHtml: component code (JSON for templates, HTML for sandboxes)
- tier: "template" | "sandbox"
- managedBy: ManagedBy = "legacy"

**Operations**:
```
mkdir -p /data/marketplace/{componentId}/
Write manifest.json (base64 encoded via stdin)
Write template.json or sandbox.html (base64 encoded via stdin)
```

**Transport**: Uses `execInPod()` with base64 encoding (avoids shell escaping issues).

### removeMarketplaceComponent() (configSync.ts:842-862)
Removes `/data/marketplace/{componentId}` directory from running pod.

**Operations**:
```
rm -rf /data/marketplace/{componentId}
```

### syncConfigsToPvc() (configSync.ts:250-400+)
**Two-way sync between DB and running pod's PVC**. This is the main config sync orchestrator.

**Triggers**: Called fire-and-forget by:
- Credential mutations (platformCredentials save/delete)
- Service install/uninstall (updates packageSnippets)
- Skill install/uninstall

**Three-tier strategy**:

**Tier 1 (file-only, zero downtime)**:
- System prompt, skills, packageSnippets → files
- Writes to ConfigMap + running pod
- No restart needed

**Tier 2 (process restart, ~5-10s downtime)**:
- LLM keys, platform tokens changed
- Updates K8s Secret
- Signals process restart via `.reload` marker (OpenClaw entrypoint polls)

**Tier 3 (pod restart, ~30-60s downtime)**:
- Fallback for old images or removed env vars
- Scale 0 → 1 restart (full pod restart)

**Key detail**: For service installs, `buildDeploymentFields()` includes:
- `serviceSnippets[]` — instruction snippets appended to soul.md as `## Service: {name}` sections
- `remoteSkillConfigs[]` — proxy URLs for remote service skills

---

## marketplaceComponents Schema Fields

### For Installation:
- **name** — lowercase slug (e.g., "my-chart")
- **displayName** — human name
- **description** — long description
- **tier** — "template" (JSON) or "sandbox" (HTML/CSS/JS)
- **category** — category for browsing (e.g., "charts")
- **propsSchema** — JSON Schema string (defines props)
- **exampleProps** — example props JSON (used as fallback template)
- **status** — must be "published" to install
- **currentVersion** — semantic version (e.g., "1.2.3")

### For Pricing:
- **pricingModel** — "free" or "paid"
- **priceUsdCents** — price (0 for free)
- **stripePriceId**, **stripeProductId** — Stripe IDs

### Analytics:
- **totalInstalls** — incremented on each install
- **totalRevenueCents** — sum of purchase amounts
- **averageRating** — 1-500 scaled (e.g., 450 = 4.50 stars)
- **ratingCount** — number of reviews

---

## Where Component PVC Sync Hooks In

### Current Architecture:
1. Component install flow creates DB record + fires `syncMarketplaceComponent()` → writes to `/data/marketplace/{componentId}/`
2. Component resolver discovers installed components from PVC at runtime

### Gap Identified:
**Missing**: Metadata sync after component version update. If component is updated to new version, PVC isn't automatically refreshed. Solution: Hook `updateVersion()` mutation to also call `syncMarketplaceComponent()` with new version.

### Key Design Decision:
- **Per-component PVC dirs**: `/data/marketplace/{componentId}/manifest.json` + `template.json|sandbox.html`
- **Discovered at runtime** by bot (via MCP `list_components` → custom component resolver)
- **Lifecycle tied to componentInstalls** — PVC cleanup on uninstall, refresh on version update

---

## Testing Considerations

### Unit Tests Needed:
- marketplace.install validates component exists & is published
- marketplace.install skips if already installed
- marketplace.install resolves latest version correctly
- marketplace.uninstall removes PVC component
- services.install creates all three record types (serviceInstalls, componentInstalls, deploymentSkills)
- services.install skips already-installed components/skills
- services.uninstall calls remote webhook for hybrid services
- syncMarketplaceComponent writes manifest + template/sandbox files correctly

### Integration Tests:
- Install → verify `/data/marketplace/{componentId}/manifest.json` exists
- Uninstall → verify directory removed
- Service install → verify skill files written to `/data/skills/`
- Service install → verify soul.md includes `## Service: {name}` section
