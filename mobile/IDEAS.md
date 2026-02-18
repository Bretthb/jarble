# Jarble Mobile App — Ideas & Vision

## The Big Picture

The Jarble mobile app is a **conversational interface** where users connect to their
deployed bots and interact through **generative UI** — the agent doesn't just reply
with text, it renders interactive native components (charts, forms, action cards,
dashboards) directly in the chat. Powered by **Tambo** for generative UI and
**React Native + Expo** for the native shell.

The phone isn't a dashboard mirror. It's the **primary way users experience their
agents** — like iMessage, but the person on the other end is your AI bot, and it can
render anything.

---

## 1. Core Concept: Generative UI Chat Interface

### What Is Generative UI?
Instead of agents responding with plain text or markdown, they respond with **real,
interactive UI components** that render natively in the chat thread. The agent decides
which component to render based on the conversation context.

### How Tambo Makes This Work

Tambo is an open-source generative UI toolkit for React. You register components with
Zod schemas, and the agent picks the right one and streams the props in real-time.

```
User: "How are my deployments doing?"

Traditional chat:
  Bot: "You have 2 deployments. test1 is running (OpenClaw, 0.2 CPU).
        test2-zeroclaw is stopped."

Generative UI chat:
  Bot renders: <DeploymentStatusCard> component
  ┌──────────────────────────────────┐
  │  Your Deployments                │
  │                                  │
  │  test1          ● Running        │
  │  OpenClaw · gpt-4o · 0.2 CPU    │
  │  [Stop]  [Restart]  [Configure]  │
  │                                  │
  │  test2-zeroclaw ○ Stopped        │
  │  ZeroClaw · claude-sonnet-4      │
  │  [Start]  [Configure]            │
  └──────────────────────────────────┘
```

The buttons are real, tappable, and execute actions — not just display text.

### Tambo Architecture in Jarble Mobile

```
┌──────────────────────────────────────────────────────┐
│  Jarble Mobile App (React Native + Expo)             │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  TamboProvider (reactive registry)             │  │
│  │                                                │  │
│  │  Core Components (always loaded):              │  │
│  │   - <DeploymentCard />     (status + actions)  │  │
│  │   - <StorageMeter />       (usage visual)      │  │
│  │   - <LogViewer />          (live log stream)   │  │
│  │   - <ModelSelector />      (pick LLM model)    │  │
│  │   - <QuickAction />        (confirm dialogs)   │  │
│  │   - ...                                        │  │
│  │                                                │  │
│  │  Integration Components (loaded dynamically):  │  │
│  │   - Components from each active integration    │  │
│  │   - Hot-loaded when integration is connected   │  │
│  │   - Unloaded when integration is removed       │  │
│  │   - Each has Zod schema + MCP tools            │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌─────────────┐    ┌──────────────────────────┐     │
│  │ Tambo Agent  │───→│ Jarble API (tRPC)        │     │
│  │ (backend)    │    │ + Core MCP Tools         │     │
│  │              │    │ + Integration MCP Tools   │     │
│  │ Picks which  │    │   (per active integration)│    │
│  │ component to │    │                          │     │
│  │ render based │    │ Integration tools proxy   │     │
│  │ on user msg  │    │ through to bot runtime    │     │
│  └─────────────┘    └──────────────────────────┘     │
└──────────────────────────────────────────────────────┘
```

### Tambo + React Native Compatibility

Tambo is currently React-web only (`@tambo-ai/react`). For React Native, there are
three paths:

1. **Native Adapter (preferred)**: Tambo's core is React hooks + Zod schemas. The
   rendering layer can be swapped. Build a `@tambo-ai/react-native` adapter that uses
   RN components instead of DOM elements. The hooks (`useTambo`, `useTamboThread`)
   should work as-is since they're pure React. Only the component rendering needs
   adaptation.

2. **Tambo Backend + Custom RN Frontend**: Use Tambo's backend/agent API for
   conversation management and component selection, but render components with a
   custom React Native renderer. The agent still picks which component to render
   (via Zod schemas), but the actual rendering is native.

3. **WebView Hybrid**: Embed Tambo web components in a React Native WebView for
   complex components, with native components for performance-critical UI. Quick to
   ship but compromises on native feel.

**Recommendation**: Start with path 2 (Tambo backend + custom RN rendering). Migrate
to path 1 when/if Tambo ships official RN support.

---

## 2. The Chat Experience

### Primary Interface
The app opens directly into a **chat thread list** — one thread per deployed bot.
No dashboard, no settings screens to wade through. Just your bots, ready to talk.

```
┌──────────────────────────┐
│  Jarble                  │
│                          │
│  ┌────────────────────┐  │
│  │ ● test1 (OpenClaw) │  │
│  │   "Here's your     │  │
│  │    deployment..."   │  │
│  │   2 min ago         │  │
│  └────────────────────┘  │
│                          │
│  ┌────────────────────┐  │
│  │ ○ zclaw (ZeroClaw) │  │
│  │   Bot is stopped   │  │
│  │   Tap to start     │  │
│  └────────────────────┘  │
│                          │
│  [+ Connect New Bot]     │
└──────────────────────────┘
```

### Inside a Chat Thread

```
┌──────────────────────────┐
│ ← test1 (OpenClaw)  ● 🔧│
│──────────────────────────│
│                          │
│  ┌────────────────────┐  │
│  │ What's my storage  │  │
│  │ usage?         You │  │
│  └────────────────────┘  │
│                          │
│  ┌────────────────────┐  │
│  │ <StorageMeter>     │  │
│  │ ████████░░ 16/20GB │  │
│  │ 80% used           │  │
│  │                    │  │
│  │ [Clear Cache]      │  │
│  │ [Upgrade Storage]  │  │
│  └────────────────────┘  │
│                          │
│  ┌────────────────────┐  │
│  │ Switch me to       │  │
│  │ Claude Sonnet  You │  │
│  └────────────────────┘  │
│                          │
│  ┌────────────────────┐  │
│  │ <ModelSelector>    │  │
│  │                    │  │
│  │ Current: gpt-4o    │  │
│  │ Switch to:         │  │
│  │ ○ Claude Opus 4.5  │  │
│  │ ● Claude Sonnet 4  │  │
│  │ ○ Claude Haiku     │  │
│  │                    │  │
│  │ ⚠ New API key      │  │
│  │   required for     │  │
│  │   Anthropic        │  │
│  │                    │  │
│  │ [Enter Key & Save] │  │
│  └────────────────────┘  │
│                          │
│  [Type a message...]  📎 │
└──────────────────────────┘
```

### What Users Can Do Through Chat

Everything you can do on the web dashboard + anything from the bot's active
integrations, all through natural language:

| User Says | What Happens |
|-----------|-------------|
| "How are my bots doing?" | Core `<DeploymentStatusCard>` — always available |
| "Show me storage usage" | Core `<StorageMeter>` — always available |
| "Switch to Claude Sonnet" | Core `<ModelSelector>` — always available |
| "Stop my bot" | Core `<QuickAction>` — always available |
| "Show me logs" | Core `<LogViewer>` — always available |
| "Show me my channels" | Integration component from whatever chat platform the bot is on |
| "Who messaged my bot?" | Integration component showing recent conversations |
| "Show me recent orders" | Integration component from Shopify/Stripe/etc. if connected |
| "What's on my calendar?" | Integration component from Google Calendar if connected |
| "Check my inbox" | Integration component from email provider if connected |

The user doesn't need to know which integration provides what. They just ask.
The Tambo agent knows what's connected, has the right MCP tools loaded, and
picks the right component to render. If the bot doesn't have a relevant
integration, the agent says so and offers to help connect one.

---

## 3. Integration-Aware Generative Components

### The Core Idea

The generative UI component library is **not static** — it's **dynamic per bot,
and it changes over time** as users add and remove integrations. Every integration
the bot has (Discord, WhatsApp, Shopify, Google Calendar, a custom API — anything)
can ship its own set of Tambo components. When the user opens a bot's chat, the
app checks what integrations are currently active and loads only the relevant
components and MCP tools into the Tambo registry.

**Integrations are not constant.** Users connect and disconnect platforms all the
time. The component registry is **reactive** — it watches integration state and
hot-loads/unloads component packages as integrations change. If the user
disconnects Discord mid-session, Discord components stop appearing. If they
connect Shopify, Shopify components become available immediately.

This means the mobile app isn't a generic dashboard — it's a **living control
surface** that reflects exactly what each bot can do right now.

### How It Works

```
User opens chat with "test1" bot
        |
        v
App queries bot's current active integrations
(this is reactive — subscribes to changes, not a one-time check)
        |
        v
Integration registry dynamically assembled:
  ┌──────────────────────────────────────────────────┐
  │  Core components (always available):             │
  │   - DeploymentCard, StorageMeter, LogViewer, ... │
  │                                                  │
  │  + Integration A components (currently active)   │
  │     Components: ChannelList, MessageThread, ...  │
  │     MCP Tools:  get_channels, get_messages, ...  │
  │                                                  │
  │  + Integration B components (currently active)   │
  │     Components: ContactList, GroupInfo, ...       │
  │     MCP Tools:  get_contacts, send_message, ...  │
  │                                                  │
  │  (new integration added later? auto-loads)       │
  │  (integration removed? auto-unloads)             │
  └──────────────────────────────────────────────────┘
        |
        v
User asks about anything integration-related
  → Tambo agent has the right tools + components
  → Renders the right UI in the chat
```

### What This Looks Like in the Chat

The user doesn't think in terms of "which integration" — they just ask questions.
The Tambo agent knows what integrations are active and picks the right component.

```
┌──────────────────────────┐
│ ← test1 (OpenClaw)  ● 🔧│
│──────────────────────────│
│                          │
│  ┌────────────────────┐  │
│  │ What's happening   │  │
│  │ on my server?  You │  │
│  └────────────────────┘  │
│                          │
│  ┌────────────────────┐  │
│  │ <ServerOverview>   │  │  ← from the bot's Discord
│  │                    │  │    integration package
│  │ My Bot Server      │  │
│  │ 1,247 members      │  │
│  │ 12 channels        │  │
│  │ ● Online now       │  │
│  │                    │  │
│  │ Recent activity:   │  │
│  │ #general  42 msgs  │  │
│  │ #support  18 msgs  │  │
│  │ #random    7 msgs  │  │
│  │                    │  │
│  │ [View Channels]    │  │
│  │ [Server Settings]  │  │
│  └────────────────────┘  │
│                          │
│  ┌────────────────────┐  │
│  │ Show me recent     │  │
│  │ orders         You │  │
│  └────────────────────┘  │
│                          │
│  ┌────────────────────┐  │
│  │ <OrderList>        │  │  ← from the bot's Shopify
│  │                    │  │    integration package
│  │ Today's Orders (8) │  │
│  │ ──────────────     │  │
│  │ #1042 $89.00  Paid │  │
│  │  2 items · Austin  │  │
│  │                    │  │
│  │ #1041 $34.50  Paid │  │
│  │  1 item · Denver   │  │
│  │                    │  │
│  │ [View All] [Export]│  │
│  └────────────────────┘  │
│                          │
│  [Type a message...]  📎 │
└──────────────────────────┘
```

The key insight: the agent rendered a Discord component AND a Shopify component
in the same chat because the bot has both integrations active. The user didn't
have to switch modes or navigate to different screens.

### Integration Component Packages

Every integration ships as a **component package** — a self-contained bundle:

```
Integration Package = {
  components:  [...]   // Tambo components with Zod schemas
  mcpTools:    [...]   // MCP tools for fetching/mutating integration data
  description: "..."   // Natural language desc for the Tambo agent
}
```

The system is **generic**. There is no hardcoded list of integrations. Any
integration — first-party (Discord, WhatsApp) or third-party (Shopify, Stripe,
a user's custom API) — follows the same package contract.

#### Example Packages (Illustrative, Not Exhaustive)

A Discord package might ship: `ChannelList`, `ServerInfo`, `MessageThread`,
`MemberList`, `RoleManager` — with MCP tools like `get_channels`,
`get_messages`, `get_members`.

A WhatsApp package might ship: `ContactList`, `GroupInfo`, `QRPairer`,
`MessageHistory` — with tools like `get_contacts`, `get_messages`,
`connection_status`.

A Shopify package might ship: `OrderList`, `ProductCatalog`, `CustomerInfo`,
`InventoryStatus` — with tools like `get_orders`, `get_products`,
`get_inventory`.

An email package might ship: `Inbox`, `ComposeEmail`, `ThreadView` — with tools
like `get_emails`, `send_email`, `search_inbox`.

A Google Calendar package might ship: `EventList`, `EventDetail`,
`ScheduleView` — with tools like `get_events`, `create_event`.

The pattern is always the same: **components + schemas + tools**. Adding a new
integration just means shipping a new package.

### Reactive Registry (Live Integration Changes)

Integrations aren't set-and-forget. Users add and remove them constantly. The
component registry must be **reactive**:

```
Timeline:

  t=0   User opens bot chat
        → App loads core components
        → App queries active integrations: [Discord, WhatsApp]
        → Loads Discord package + WhatsApp package
        → Agent has Discord & WhatsApp components + tools

  t=5m  User connects Shopify from web dashboard
        → Integration change event fires (WebSocket/SSE)
        → App hot-loads Shopify package
        → Agent now ALSO has Shopify components + tools
        → User: "Show me my orders" → works immediately

  t=10m User disconnects Discord from web dashboard
        → Integration change event fires
        → App unloads Discord package
        → Agent no longer offers Discord components
        → User: "Show me channels" → agent explains Discord
          is no longer connected, offers to reconnect
```

This is powered by **subscribing to integration state changes** — the same way
the web dashboard live-updates deployment status via SSE, the mobile app
subscribes to integration changes and hot-swaps component packages.

```typescript
// Reactive integration loader — watches for changes
function useIntegrationComponents(botId: string) {
  const integrations = trpc.platformCredentials.getByDeployment.useQuery(
    { id: botId },
    { refetchInterval: 10_000 }  // poll for changes, or use WebSocket
  );

  useEffect(() => {
    // Clear previous integration components
    clearIntegrationRegistry();

    // Core components always loaded
    registerCoreComponents();

    // Load a package for each active integration
    for (const integration of integrations.data ?? []) {
      const pkg = getIntegrationPackage(integration.platform);
      if (pkg) {
        registerComponents(pkg.components);
        registerMCPTools(pkg.mcpTools);
      }
    }
  }, [integrations.data]);
}

// Integration packages are looked up from a registry, not a switch statement.
// New integrations just register their package — no app code changes needed.
const integrationRegistry = new Map<string, IntegrationPackage>();

function registerIntegrationPackage(platform: string, pkg: IntegrationPackage) {
  integrationRegistry.set(platform, pkg);
}

function getIntegrationPackage(platform: string): IntegrationPackage | undefined {
  return integrationRegistry.get(platform);
}
```

### Integration MCP Tools

Each package registers MCP tools so the Tambo agent can fetch and act on
integration data. The tools follow a consistent pattern:

```
Every integration package exposes tools like:
  - {integration}_list_{entities}     → list primary entities (channels, contacts, orders)
  - {integration}_get_{entity}        → get detail for one entity
  - {integration}_get_messages        → get message/activity history
  - {integration}_send_{action}       → perform an action (send message, create order)
  - {integration}_get_status          → connection health check
```

These tools call through the bot's runtime — the bot holds the live connections
to external platforms, so the mobile app queries integration data through the
Jarble API, which proxies to the bot's runtime. The mobile app never talks to
Discord/WhatsApp/etc. directly.

### Third-Party & Custom Integration Packages

When the MCP marketplace launches (see `MCP/IDEAS.md`), third-party developers
can publish their own integration packages. Someone builds a Jira integration?
They ship a Tambo package with `IssueList`, `SprintBoard`, `IssueDetail`
components. The user installs it from the marketplace, connects it to their bot,
and those components appear in the mobile chat automatically.

This creates a **component ecosystem** that grows independently of what Jarble
ships first-party.

---

## 4. Core Platform Components (Always Available)

### Components to Register

In addition to integration-specific components, these core components are always
available regardless of which integrations a bot has.

Each component has a Zod schema so Tambo knows what props to stream.

```typescript
// Example: DeploymentStatusCard
const DeploymentStatusCardSchema = z.object({
  deployments: z.array(z.object({
    id: z.string(),
    name: z.string(),
    runtime: z.string(),
    status: z.enum(["running", "stopped", "creating", "error"]),
    model: z.string(),
    cpuUsage: z.number().optional(),
    memoryMb: z.number().optional(),
  })),
});

// Example: StorageMeter
const StorageMeterSchema = z.object({
  usedGb: z.number(),
  totalGb: z.number(),
  percentUsed: z.number(),
  deploymentId: z.string(),
});

// Example: QuickAction
const QuickActionSchema = z.object({
  title: z.string(),
  description: z.string(),
  action: z.enum(["stop", "start", "restart", "delete"]),
  deploymentId: z.string(),
  destructive: z.boolean().default(false),
});
```

### Interactable Components (Persistent State)

Some components aren't one-shot — they persist and update across the conversation:

- **LogViewer**: Stays open, continuously streams logs. User can scroll, search,
  filter without losing it.
- **SystemPromptEditor**: User edits in the component, changes stream back to
  the agent for validation.
- **OnboardingWizard**: Multi-step flow that maintains state as the user
  progresses through deployment creation.

---

## 5. MCP Integration Layer

### Tambo + MCP = Agent With Platform Powers

Tambo supports MCP natively. We wire Jarble's tRPC API as MCP tools that the Tambo
agent can call. The tool set is **two-tiered**:

1. **Core MCP tools** — always available, for managing the Jarble platform itself
2. **Integration MCP tools** — loaded/unloaded dynamically per bot's active
   integrations (see Section 3)

```
MCP Server: "jarble-platform" (always loaded)
Tools:
  - deployment_list         → tRPC deployment.list
  - deployment_get          → tRPC deployment.getById
  - deployment_start        → tRPC deployment.start
  - deployment_stop         → tRPC deployment.stop
  - deployment_restart      → tRPC deployment.restart
  - deployment_update       → tRPC deployment.update
  - deployment_create       → tRPC deployment.create
  - billing_overview        → tRPC billing.getOverview
  - billing_invoices        → tRPC billing.getInvoices
  - billing_subscriptions   → tRPC billing.getSubscriptions
  - logs_stream             → SSE /api/deployments/:id/logs
  - storage_usage           → tRPC deployment.getStorageUsage
  - platform_credentials    → tRPC platformCredentials.getByDeployment
  - validate_api_key        → tRPC openrouter.validateProviderKey

MCP Server: "jarble-integration-{name}" (one per active integration)
  → loaded dynamically when bot connects the integration
  → unloaded dynamically when bot disconnects it
  → tools follow the standard pattern: list, get, send, status
  → components + schemas bundled in the same package
```

The Tambo agent calls these MCP tools to get real data, then decides which generative
component to render with that data. The user never sees raw API calls — they see
interactive native components in the chat. Because the tools and components are
loaded and unloaded reactively, the agent always reflects the bot's current
capabilities.

---

## 6. Connecting to Your Bot (Not Just Managing It)

### Two Modes of Interaction

The app has two layers:

1. **Management Layer** (Tambo agent): Talk to the Jarble platform agent to manage
   your bots. "Stop my bot", "Show me logs", "Switch to Claude". This agent uses
   Jarble's tRPC API via MCP tools and renders generative UI.

2. **Direct Chat Layer**: Talk directly TO your deployed bot. Messages route through
   a new "mobile" platform channel. Your bot responds like it would on WhatsApp or
   Discord — with its system prompt, its data, its personality.

### Switching Between Modes

```
┌──────────────────────────┐
│ test1 (OpenClaw)         │
│──────────────────────────│
│  [💬 Chat]   [🔧 Manage] │  ← Tab toggle
│──────────────────────────│
│                          │
│  💬 Chat mode:           │
│  Talk directly to your   │
│  bot. It responds as     │
│  configured (system      │
│  prompt, personality).   │
│                          │
│  🔧 Manage mode:         │
│  Talk to the Jarble      │
│  platform to configure,  │
│  monitor, and control    │
│  this deployment.        │
│  (Generative UI)         │
└──────────────────────────┘
```

- **Chat mode**: WebSocket to the bot's runtime. Messages processed by the bot's LLM
  with the bot's system prompt. This is the user's private line to their agent.
- **Manage mode**: Tambo agent with MCP tools. Generative UI components for config,
  monitoring, and control.

---

## 7. Push Notifications — The Agent-to-Human Loop

### Agent-Triggered Notifications

Deployed bots can push notifications to the phone via a platform tool:

```
Tool: notify_owner
Input: {
  "title": "New lead captured",
  "body": "John Smith filled out the contact form. Score: 92/100",
  "action": "open_chat",
  "priority": "normal"
}
```

Tap notification → lands in chat with the bot → continue the conversation.

### Platform Notifications

| Event | Notification |
|-------|-------------|
| Bot crashed | "test1 is down — tap to see error and restart" |
| Storage >90% | "test1 storage at 92% — tap to manage" |
| Free trial expiring | "Free trial ends in 24h — upgrade to keep your bot running" |
| Payment failed | "Payment failed — tap to update payment method" |
| WhatsApp connected | "WhatsApp paired successfully for test1" |
| New message to bot | "Someone messaged your bot test1" (optional) |

### Implementation
- Expo Push Notifications (handles APNs + FCM, free)
- New `notification` tRPC router in jarble-api-main
- Push token registration on app launch
- Per-notification-type toggles in settings

---

## 8. Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | React Native + Expo | Single codebase, OTA updates, official recommendation |
| Navigation | Expo Router | File-based routing, matches Next.js patterns |
| Generative UI | Tambo (backend) + custom RN components | Agent picks component, RN renders natively |
| API Client | tRPC (same AppRouter as web) | Zero API code duplication |
| Auth | Auth0 React Native SDK | Same tenant — SSO across web + mobile |
| Real-time | WebSocket | Chat with bots + live log streaming |
| Push | Expo Push Notifications | Free, APNs + FCM |
| Local Storage | MMKV | Fast key-value for offline cache |
| Styling | NativeWind (Tailwind for RN) | Familiar from web codebase |

### Monorepo Structure

```
jarble/
├── Jarble-mvp/             ← Web (Next.js)
├── mobile/                 ← Mobile (React Native + Expo)
│   ├── app/                ← Expo Router screens
│   │   ├── (tabs)/
│   │   │   ├── index.tsx       ← Bot list (home)
│   │   │   └── settings.tsx    ← Notification prefs, account
│   │   └── chat/
│   │       └── [botId].tsx     ← Chat + Manage for a bot
│   ├── components/
│   │   └── tambo/
│   │       ├── core/               ← Always-available platform components
│   │       │   ├── DeploymentCard.tsx
│   │       │   ├── StorageMeter.tsx
│   │       │   ├── LogViewer.tsx
│   │       │   ├── ModelSelector.tsx
│   │       │   ├── QuickAction.tsx
│   │       │   └── ...
│   │       └── integrations/       ← Per-integration component packages
│   │           ├── registry.ts          ← IntegrationPackage type + registry map
│   │           ├── {integration-name}/  ← One folder per integration
│   │           │   ├── index.ts         ← exports IntegrationPackage
│   │           │   ├── components/      ← RN components for this integration
│   │           │   ├── schemas.ts       ← Zod schemas
│   │           │   └── tools.ts         ← MCP tool definitions
│   │           └── ...                  ← more integrations as they're built
│   ├── lib/
│   │   ├── trpc.ts             ← tRPC client (reuses AppRouter)
│   │   ├── tambo.ts            ← Tambo config + reactive component loader
│   │   └── websocket.ts        ← Bot chat connection
│   └── app.json
├── jarble-api-main/        ← API (shared backend)
│   └── src/
│       ├── mcp/
│       │   ├── jarble-platform.ts       ← Core MCP server (tRPC endpoints)
│       │   └── integration-proxy.ts     ← Generic proxy: routes MCP tool calls
│       │                                   to the bot's runtime per integration
│       └── trpc/routers/
│           └── notification.ts          ← Push notification router (new)
└── MCP/                    ← MCP marketplace ideas
```

---

## 9. Implementation Phases

### Phase 1: Chat Shell + Tambo Integration (4-5 weeks)
- Expo project setup with Auth0 login
- tRPC client integration
- Bot list screen (threads)
- Basic Tambo backend integration
- Core generative components: DeploymentCard, QuickAction, StorageMeter, LogViewer
- Core MCP server wrapping tRPC endpoints

### Phase 2: Direct Bot Chat (3-4 weeks)
- WebSocket connection to bot runtime
- Chat UI with message bubbles
- New "mobile" platform channel in API runtime handlers
- Chat/Manage mode toggle per bot
- Conversation history persistence

### Phase 3: Integration Component System (4-5 weeks)
- `IntegrationPackage` contract (components + schemas + MCP tools)
- Reactive registry that watches for integration changes and hot-swaps packages
- Integration proxy in API (generic route: MCP tool calls → bot runtime)
- First 2-3 integration packages as proof of concept (whichever integrations
  the platform supports at that point)
- Third-party package loading via MCP marketplace (future)

### Phase 4: Push Notifications (2-3 weeks)
- Expo Push setup (token registration, backend integration)
- Agent-triggered notifications (`notify_owner` tool)
- Platform event notifications (crash, storage, billing)
- Notification preferences screen

### Phase 5: Remaining Components + Polish (3-4 weeks)
- Remaining core components: ModelSelector, BillingOverview, SystemPromptEditor
- Additional integration packages as platform adds integrations
- Interactable components with persistent state
- Voice input (speech-to-text → agent)
- Offline mode + background sync
- Deep links (jarble://chat/deploymentId)
- App Store / Play Store submission

---

## 10. What Makes This Special

Most bot hosting platforms give you a web dashboard. Some have basic APIs. None
give you a **native mobile app where you can chat with your bots through generative
UI**.

The combination of:
- **Tambo** (agent picks which UI component to render)
- **MCP** (agent has real tools to control the platform AND integrations)
- **Reactive component registry** (components load/unload as integrations change)
- **React Native** (native performance, native feel)
- **Existing Jarble API** (zero new backend — reuse tRPC)

...means the mobile app is essentially an **AI-native interface to the entire Jarble
platform AND everything your bot is connected to**. No forms, no settings screens,
no menus. Just talk to it.

"Stop my bot" → it stops.
"Show me what's wrong" → it shows you live logs.
"What's happening on my server?" → it pulls up channel activity.
"Show me recent orders" → it renders the order list.
"Switch to a cheaper model" → it shows you the options with pricing.

The app adapts to each bot in real time. Connect a new integration and its
components are immediately available in the chat. Disconnect one and they
disappear. The chat is always a reflection of what the bot can actually do
right now — not a static set of screens designed at build time.

---

## 11. Open Questions

- **Tambo RN support**: Tambo is React-web only today. Need to either build an RN
  adapter, use Tambo backend only, or convince Tambo team to add RN support (they may
  already be working on it — worth reaching out).

- **Which LLM powers the Tambo agent?** The management agent (that picks components)
  needs its own LLM. Could use OpenRouter (same as the platform), or let users pick.
  Should be fast (Haiku/Flash class) since it's UI orchestration, not deep reasoning.

- **Bot chat transport**: Does the bot's runtime (OpenClaw/ZeroClaw) need changes to
  support a "mobile" channel? Probably minimal — add a WebSocket endpoint or REST
  route that accepts messages and returns responses. Similar to how WhatsApp messages
  flow through.

- **Offline chat**: Should the app cache conversations locally? Yes — show cached
  history immediately, fetch new messages in background. Messages sent offline get
  queued.

- **Multi-agent chat**: Could we have a single chat thread where multiple bots
  collaborate? e.g., "Plan my trip" routes to travel bot, then "Book a restaurant"
  routes to food bot — all in one thread. This ties into the MCP A2A vision.

- **Integration data access**: The bot runtime holds the live connections to
  external platforms. The mobile app queries integration data through the bot.
  Do we add a generic API proxy (Jarble API → bot runtime), or does each bot
  expose its own MCP server that the mobile Tambo agent connects to directly?
  Proxying through the Jarble API is simpler (auth already works), but direct
  bot MCP is more flexible and avoids a bottleneck.

- **Package distribution**: How do integration component packages get to the
  mobile app? Bundled at build time (simpler, but requires app updates for new
  integrations)? Or fetched dynamically at runtime (more flexible, but harder
  to implement in React Native)? Probably bundled for first-party, with a
  code-push mechanism for adding new packages without full app updates.

- **Component versioning**: As integrations evolve, component packages need
  updating. How do we handle version mismatches between the app's component
  package and the bot's integration version? Probably: packages declare a min
  API version, and the app gracefully degrades or prompts for an update.

- **Custom user integrations**: If a user builds a custom integration (their own
  API), can they also ship a component package for it? This is ambitious but
  powerful — the user defines Zod schemas and component templates, and the
  mobile app renders them. Could tie into the MCP marketplace.

---

## References

- [Tambo — Generative UI SDK for React](https://tambo.co/)
- [Tambo Documentation](https://docs.tambo.co/)
- [Tambo GitHub](https://github.com/tambo-ai/tambo)
- [Introducing Tambo 1.0](https://tambo.co/blog/posts/introducing-tambo-generative-ui)
- [Expo — Official React Native Framework](https://expo.dev/)
- [React Native Best Practices for AI Agents](https://www.callstack.com/blog/announcing-react-native-best-practices-for-ai-agents)
- [Vercel AI SDK — Expo Getting Started](https://ai-sdk.dev/docs/getting-started/expo)
- [Running AI Models On-Device with React Native ExecuTorch](https://expo.dev/blog/how-to-run-ai-models-with-react-native-executorch)
