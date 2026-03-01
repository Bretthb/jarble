# Report 15: Multi-Platform Bot UX Patterns

**Agent**: multi-platform-ux-researcher
**Status**: COMPLETE
**Date**: 2026-02-27

## Executive Summary

Comprehensive research on platform capabilities, smart content degradation patterns, platform-specific UX best practices, web app bridges (Telegram Mini Apps, Discord Activities, Slack Home Tab), platform-conditional prompting, and server-side image generation for Jarble's multi-platform deployment.

**Key findings**: Telegram Mini Apps are the highest-ROI bridge (full canvas rendering in-app), platform-conditional prompts can save ~1,250 tokens on non-web platforms, and the 56+ components break into 4 degradation tiers.

---

## 1. Platform Capabilities Matrix

### Telegram Bot API
- **Message length**: 4,096 chars
- **Formatting**: HTML (`<b>`, `<i>`, `<u>`, `<s>`, `<code>`, `<pre>`, `<a>`, `<blockquote>`) or MarkdownV2
- **Inline keyboards**: Up to 8 buttons/row, 100 total, callback data max 64 bytes
- **Media**: Photos (10MB), Videos (50MB), Documents (50MB), Media groups (2-10 album)
- **Web Apps (Mini Apps)**: Full HTML/CSS/JS WebView, Telegram API bridge, payment support, device access
- **Rate limits**: 30 msg/s overall, 20 msg/min to same group

### Discord Bot API
- **Message length**: 2,000 chars
- **Embeds**: Title (256), Description (4,096), 25 fields, Footer (2,048), Color, Images. 10 embeds/msg
- **Components V2 (2025)**: Container, Section, Separator, TextDisplay, Thumbnail, MediaGallery, File, Button, SelectMenu, TextInput. 10 top-level, 40 total/msg
- **Buttons**: 5 per ActionRow. Styles: primary/secondary/success/danger/link
- **Select menus**: String/User/Role/Channel. 25 options. Multi-select
- **Modals**: Up to 5 TextInput. Title 45 chars
- **Activities**: Embedded iframes via Embedded App SDK, proxied through discordsays.com

### Slack Bot API
- **Message length**: 40,000 chars total (mrkdwn text blocks: 3,000 chars)
- **Block Kit**: Section, Divider, Image, Actions (25 elements), Context (10 elements), Input, Header, RichText, Video, File. 50 blocks/msg, 100 in modals
- **Interactive**: Buttons, Overflow, Date/Time pickers, Multi-selects, Radio, Checkboxes, Rich text inputs
- **Modals**: views.open/push/update. 100 blocks. 3 levels deep stacking
- **Home tab**: Persistent dashboard. 100 blocks. Updated via views.publish

### WhatsApp Business API
- **Message length**: 4,096 chars (some providers cap at 1,600)
- **Formatting**: `*bold*`, `_italic_`, `~strikethrough~`, `` `monospace` ``, ` ```code``` `
- **Reply buttons**: Up to 3 per message. Title max 20 chars
- **List messages**: 10 rows across 10 sections. Row title max 24 chars
- **Media**: Image (5MB), Video (16MB), Document (100MB), Audio (16MB), Sticker, Location
- **Rate limits**: Tier-based (1K → 10K → 100K → unlimited users/day)

---

## 2. Component Degradation Taxonomy

### Tier 1: Direct Text (all platforms)

| Component | Telegram | Discord | Slack | WhatsApp |
|---|---|---|---|---|
| `card` | HTML text | Embed | Section block | Formatted text |
| `alert` | Emoji prefix + text | Colored embed | Section + emoji | Emoji + text |
| `header` | `<b>` heading | Embed title | Header block | `*bold*` |
| `divider` | `───────` line | Separator V2 | Divider block | Line emoji |
| `badge` | Emoji + text | Inline code | Context block | `[tag]` |
| `code_block` | `<pre><code>` | ` ```lang\ncode``` ` | ` ```code``` ` | ` ```code``` ` |
| `list` | Numbered/bulleted | Embed fields/markdown | Section mrkdwn | Numbered text |
| `key_value` | `<b>Key:</b> Value` | Embed fields (inline) | Section mrkdwn | `*Key:* Value` |
| `progress` | `[████░░░░] 65%` | Embed + text bar | Section + context | Text `65% complete` |

### Tier 2: Approximated (creative formatting)

| Component | Strategy |
|---|---|
| `stat_grid` | Emoji + bold values, multiple embed fields, section blocks |
| `metric_card` | `📊 Revenue: $5M (+12%)` with sparkline `▁▂▃▅▇` |
| `timeline` | Numbered steps with status emoji |
| `data_table` | Monospace `<pre>` table (small) or document (large) |
| `accordion` | Multiple messages or numbered sections |
| `tabs` | Inline keyboard/buttons for selection + message edit |
| `form` | Sequential questions (Telegram) or modal (Discord/Slack) |
| `button_group` | Inline keyboards / button rows / reply buttons (3 max WhatsApp) |

### Tier 3: Image-Rendered (server-side)

Charts (bar, line, pie, area, gauge, heatmap, radar, sankey, treemap, funnel, waterfall, scatter, histogram, etc.), `image_gallery`, `carousel`, `map`, `spreadsheet` — render to PNG/PDF on server, send as media.

### Tier 4: Web-Only (link to dashboard)

`sandbox`, `code_editor`, `video`, `audio` — send link: "View interactive visualization at [URL]"

---

## 3. Platform UX Best Practices

### Telegram
- Inline keyboards everywhere (never require typing commands)
- Register commands via BotFather for menu
- `<pre>` monospace tables, media groups for galleries
- **Mini Apps** for complex interfaces (highest impact)

### Discord
- Slash commands with autocomplete
- Rich embeds with semantic color coding
- Ephemeral messages for private responses
- Thread creation for detailed interactions
- Activities for full web app embedding

### Slack
- Home tab for persistent dashboards
- Modal flows for multi-step forms
- Thread replies to avoid channel noise
- Block Kit polish (context blocks, accessories, dividers)
- Unfurls for relevant URLs

### WhatsApp
- Reply buttons for top 3 actions (max 3)
- List messages for menus (max 10 items)
- Short messages (mobile users scan)
- Media-first for visual data
- Human handoff option always available

---

## 4. Web App / Mini App Bridges

### Telegram Mini Apps (Highest ROI)

Full HTML/CSS/JS in embedded WebView. Jarble's existing React components render directly.

**Architecture**:
1. Bot detects complex UI request
2. Sends inline keyboard: "Open Dashboard"
3. URL: `https://app.jarble.ai/d/{id}/mini?session={token}&platform=telegram`
4. Mini App loads same canvas components with Telegram-optimized layout
5. Auth via Telegram's `initData` (HMAC-verified, no Auth0 needed)
6. Real-time data via same SSE infrastructure

**Advantages**: Full 56+ component library, hardware-accelerated, payment support, persistent storage, shareable.

**Implementation**: Medium. Need: Mini App route, initData verification, theme integration, mobile layout.

### Discord Activities (Lower ROI)

Iframe in voice/text channels via Embedded App SDK. All traffic proxied through `discordsays.com`.

**Challenges**: Proxy latency, SPA requirement, CSP restrictions, requires application registration.

**Implementation**: High complexity. Wait for Activities platform to mature.

### Slack Home Tab (Moderate ROI)

Persistent dashboard with up to 100 Block Kit blocks. Good for enterprise users.

**Limitations**: Not a web renderer, max 100 blocks, no real-time updates without user interaction, images must be publicly hosted.

**Implementation**: Medium-Low. Block Kit mapping is straightforward for Tier 1/2 components.

### Priority Order

1. **Telegram Mini Apps** (highest ROI) — full canvas in-app
2. **Slack Home Tab** (moderate ROI) — persistent dashboard
3. **Discord Activities** (lower ROI) — high cost, wait for maturity

---

## 5. Platform-Conditional Prompt Architecture

### Proposed: Composable Template System

Replace monolithic `JARBLE_UI_PROMPT` with per-platform sections:

```typescript
const PLATFORM_PROMPTS: Record<string, PlatformPromptSection> = {
  web: { /* Full UI prompt with component reference */ },
  telegram: { /* Telegram HTML formatting, data viz patterns, sparklines */ },
  discord: { /* Discord markdown, embed patterns, 2K char limit */ },
  slack: { /* Slack mrkdwn, block kit patterns, concise style */ },
  whatsapp: { /* Simple formatting, short messages, 3 button max */ },
};

function buildPlatformPrompt(deployment: DeploymentFields): string {
  // Always include web + detection header
  // Only include prompts for enabled platforms
  // Deployment with only Telegram gets ~500 tokens (not ~2,000+)
}
```

### Integration Point

In `openclaw.ts:renderConfigs()`, replace:
```typescript
soulParts.push(JARBLE_UI_PROMPT);
// With:
soulParts.push(buildPlatformPrompt(deployment));
```

### Platform Detection

OpenClaw should inject `[PLATFORM:telegram]` marker into messages. Current `[CANVAS_STATE]` only distinguishes web vs non-web.

---

## 6. Image Generation for Platform Degradation

### Technical Options

| Library | Per-image | Quality | Notes |
|---|---|---|---|
| **Recharts SSR + Sharp** | 30-80ms | Excellent | Jarble already uses Recharts. Server-render to SVG → PNG |
| **QuickChart.io** (external API) | 150-300ms | Good | Zero infrastructure. URL-based |
| **Puppeteer** | 200-500ms warm | Pixel-perfect | Heavy (~400MB Chromium). For complex components |
| **Satori + @vercel/og** | 30-80ms | Good | Designed for OG images. Limited CSS |

### Recommended Approach

**Phase 1**: Unicode text degradation (prompt engineering only, zero infrastructure)
**Phase 2**: QuickChart.io for basic charts (URL-based, no deps)
**Phase 3**: Recharts SSR + Sharp for high-quality charts + Puppeteer sidecar for complex components
**Phase 4**: Telegram Mini App bridge (eliminates image degradation need on Telegram)

### Image Quality Guidelines

- **Telegram**: Render at 800x600 or 1200x800
- **Discord**: Render at 800x600 (2x for retina, embeds display ~400px wide)
- **Slack**: 800x600 default
- **WhatsApp**: 600x400 minimum (previews at ~300px wide)

---

## Key Recommendations Summary

1. **Platform-conditional prompts** — Changes only in `openclaw.ts`. Replace monolithic prompt with composable per-platform sections. ~1,250 token savings on non-web platforms.

2. **Telegram Mini Apps** — Highest ROI bridge. Existing React components render directly in Telegram's WebView. Create `/d/[id]/mini` route.

3. **Chart image generation** — Start with QuickChart.io URLs (zero infra), graduate to Recharts SSR + Sharp.

4. **Component taxonomy** — 10 render as text, 12 approximated with formatting, 20+ need images, 4 web-only.

5. **Platform detection** — Inject `[PLATFORM:xxx]` marker into messages for format selection.
