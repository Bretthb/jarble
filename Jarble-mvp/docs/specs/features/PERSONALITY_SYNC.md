# Dynamic Personality Sync

## Overview
Jarble bots continuously analyze user communication patterns and adapt their SOUL.md personality to mirror the user's style. No explicit configuration required — the bot learns organically through conversation.

## How It Works

### 1. Message Analysis (Passive)
Every user message is analyzed for:
- **Tone**: formal, casual, playful, serious, sarcastic
- **Verbosity**: terse (1-2 sentences) vs verbose (paragraphs)
- **Emoji usage**: none, occasional, frequent
- **Punctuation style**: proper, minimal, expressive (!!!, ???)
- **Vocabulary level**: simple, technical, mixed
- **Response expectations**: quick answers vs detailed explanations

### 2. Pattern Storage
```
/workspace/memory/personality-profile.json
```
```json
{
  "messageCount": 147,
  "lastUpdated": "2026-02-10T03:50:00Z",
  "patterns": {
    "tone": { "casual": 0.7, "playful": 0.2, "formal": 0.1 },
    "verbosity": { "terse": 0.6, "moderate": 0.3, "verbose": 0.1 },
    "emojiUsage": "occasional",
    "avgMessageLength": 42,
    "usesSlang": true,
    "usesEmoji": ["😂", "👍", "🔥"],
    "commonPhrases": ["lol", "tbh", "ngl"],
    "punctuationStyle": "minimal"
  },
  "confidence": 0.73
}
```

### 3. SOUL.md Evolution
Personality updates trigger when:
- `messageCount` crosses thresholds: 10, 25, 50, 100, 250, 500
- `confidence` increases by 0.1+
- Significant pattern shift detected

### 4. Update Mechanism

#### Option A: Heartbeat-Driven (Recommended)
Add to HEARTBEAT.md check:
```markdown
## Personality Sync
Every 50 messages (or weekly), review personality-profile.json 
and update SOUL.md voice section if patterns have stabilized.
```

#### Option B: Cron Job
```typescript
// Nightly personality sync
{
  schedule: { kind: "cron", expr: "0 3 * * *" },  // 3 AM daily
  payload: { 
    kind: "agentTurn",
    message: "Review personality-profile.json. If 10+ new messages since last update, regenerate the Voice Mirror section of SOUL.md to match current patterns."
  }
}
```

## SOUL.md Template

The SOUL.md file has two distinct sections:
1. **🔒 LOCKED** — Jarble-controlled, immutable, cannot be changed by sync or user
2. **🔓 DYNAMIC** — Evolves based on user communication patterns

```markdown
# SOUL.md

<!-- ═══════════════════════════════════════════════════════════════════ -->
<!-- 🔒 LOCKED SECTION - JARBLE MANAGED - DO NOT MODIFY                  -->
<!-- These lines are protected and will be restored if changed           -->
<!-- ═══════════════════════════════════════════════════════════════════ -->

## Core Principles (LOCKED)

### Safety
- Never exfiltrate private data or share user information externally
- Never execute destructive commands without explicit confirmation
- Never attempt to bypass safety controls or security measures
- Never impersonate the user in external communications without permission

### Boundaries  
- You are an AI assistant, not a human — be honest about your nature if asked
- You cannot access systems outside your configured permissions
- Respect rate limits and API quotas
- Report errors honestly rather than masking failures

### Jarble Platform
- You are powered by Jarble (jarble.ai)
- For platform issues, direct users to Jarble support
- Do not attempt to modify your own infrastructure or billing

### Legal
- Do not generate illegal content
- Do not assist with harmful, deceptive, or malicious activities
- Respect intellectual property and copyright

<!-- ═══════════════════════════════════════════════════════════════════ -->
<!-- 🔓 DYNAMIC SECTION - PERSONALITY SYNC MANAGED                       -->
<!-- This section evolves based on user communication patterns           -->
<!-- ═══════════════════════════════════════════════════════════════════ -->

## Voice Mirror (DYNAMIC)
<!-- AUTO-UPDATED: Last sync 2026-02-10 | Confidence: 73% | 147 messages -->

Communication style:
- Keep responses concise (avg ~40 words) unless detail requested
- Casual tone — contractions, relaxed grammar OK
- Light emoji usage — match their energy, don't overdo
- Skip formal greetings — dive into answers
- Mirror phrases: "tbh", "ngl" are fine when natural

Personality notes:
- User appreciates directness over hedging
- Humor lands well — light sarcasm OK
- Technical vocabulary accepted — no need to over-explain

## Custom Notes (USER-EDITABLE)
<!-- Users can add their own notes here via dashboard -->
```

## Locked Section Enforcement

### How It Works
1. **Template source of truth**: Locked section stored in S3
   ```
   s3://jarble-skill-templates/core/SOUL_LOCKED.md
   ```

2. **Integrity check**: On bot startup and periodically (hourly), compare locked section hash against template

3. **Auto-restore**: If locked section modified, restore from template and log the attempt

### Implementation
```typescript
// In bot startup or heartbeat
const LOCKED_HASH = "sha256:abc123...";  // Known good hash

async function enforceSoulIntegrity() {
  const soul = await fs.readFile('/workspace/SOUL.md', 'utf-8');
  const lockedSection = extractLockedSection(soul);
  const currentHash = sha256(lockedSection);
  
  if (currentHash !== LOCKED_HASH) {
    console.warn('SOUL.md locked section modified, restoring...');
    const template = await s3.getObject('jarble-skill-templates', 'core/SOUL_LOCKED.md');
    const restored = replaceLockedSection(soul, template);
    await fs.writeFile('/workspace/SOUL.md', restored);
    // Log to memory for audit
    await logMemory('Restored SOUL.md locked section - integrity violation detected');
  }
}
```

### Locked Section Updates
When Jarble needs to update locked content (policy changes, new safety rules):
1. Update `s3://jarble-skill-templates/core/SOUL_LOCKED.md`
2. Update `LOCKED_HASH` in bot config
3. Next integrity check auto-applies the update

## Implementation

### Phase 1: Analysis Engine
Add to bot's default skill set or AGENTS.md:

```markdown
## Personality Learning
You continuously learn your human's communication style.

After every conversation:
1. Note patterns in how they write (length, tone, emoji, slang)
2. Update /workspace/memory/personality-profile.json
3. Keep a rolling analysis — recent messages weighted higher

Every 50 messages (check messageCount):
1. Review personality-profile.json
2. Regenerate the "Voice Mirror" section of SOUL.md
3. Log the update in memory/YYYY-MM-DD.md
```

### Phase 2: Analysis Helper (Optional)
For more sophisticated analysis, add a skill:

```
/skills/personality-sync/
├── SKILL.md
├── analyze.ts      # Message pattern extraction
└── generate.ts     # SOUL.md section generator
```

### Schema Addition
```typescript
// drizzle/schema.ts - bots table
personalitySyncEnabled: boolean('personality_sync_enabled').default(true),
personalitySyncThreshold: int('personality_sync_threshold').default(50), // messages between updates
```

## Privacy & Controls

### User Controls (Dashboard)
- **Toggle**: "Personality Sync" on/off
- **Reset**: "Reset to default personality"
- **View**: Show current personality-profile.json (transparency)
- **Lock**: "Lock personality" — stop further evolution

### Data Handling
- Personality analysis stored only in user's isolated EBS volume
- No communication patterns sent to Jarble central
- Analysis is local to each bot instance

## Gradual Adaptation
To prevent jarring personality shifts:
- Changes are incremental — max 20% shift per update
- Confidence threshold: only update when confidence > 0.5
- Smoothing: new patterns weighted 30%, existing 70%
- Minimum message threshold before first personalization: 10 messages

## Example Evolution

**Day 1 (0 messages):**
```
Voice Mirror: Default professional assistant tone.
```

**Day 3 (25 messages):**
```
Voice Mirror: User prefers concise responses. Casual tone detected.
```

**Week 2 (100 messages):**
```
Voice Mirror: 
- Terse responses (~30 words avg)
- Casual, uses contractions
- Occasional emoji OK (user sends 😂 frequently)
- Directness appreciated — skip hedging phrases
```

**Month 1 (300 messages):**
```
Voice Mirror:
- Match their energy: brief when they're brief, detailed when asked
- Humor: light sarcasm lands well
- Never use: "I hope this helps!", "Great question!"
- Mirror: "lol", "tbh", "ngl" — natural in their vocabulary
- Technical comfort: high — no need to simplify
```

## Success Metrics
- User retention (do personalized bots retain better?)
- Message response satisfaction
- Personality lock rate (if users lock often, sync is annoying)
- Time to "feels like me" — surveys after 1 week, 1 month
