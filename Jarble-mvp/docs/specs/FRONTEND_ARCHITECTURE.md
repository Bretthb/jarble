# Frontend Architecture Guide

> **Purpose:** Map current codebase to target architecture. What to keep, delete, move, and add.

---

## Current State vs Target

```
CURRENT (8-step wizard)              TARGET (4-step wizard)
────────────────────────             ─────────────────────────
1. Account Info                      1. Name Your Bot
2. Tier Selection                    2. Choose Template
3. Model Provider                    3. Connect Platform
4. API Configuration                 4. Deploy
5. Platforms                         
6. Skills                            (Tier/billing = post-deploy)
7. Review                            (Skills = from template)
8. Deploy                            (Model = template default)
```

---

## File Decisions

### ✅ KEEP (core infrastructure)

| File | Why |
|------|-----|
| `app/layout.tsx` | Root layout |
| `app/providers.tsx` | Context providers |
| `app/page.tsx` | Landing page |
| `app/dashboard/page.tsx` | Dashboard route |
| `app/login/page.tsx` | Auth route |
| `app/pricing/page.tsx` | Pricing route |
| `views/Dashboard.tsx` | Main dashboard (needs updates) |
| `views/Home.tsx` | Landing page |
| `views/Pricing.tsx` | Tier comparison |
| `views/Login.tsx` | Auth (update for Auth0) |
| `components/DashboardLayout.tsx` | Shell layout |
| `components/ui/*` | All UI primitives |
| `contexts/ThemeContext.tsx` | Theme switching |
| `hooks/useMobile.tsx` | Responsive hook |

### 🔧 MODIFY (needs updates)

| File | Changes Needed |
|------|----------------|
| `views/OnboardingWizard.tsx` | Simplify to 4 steps |
| `views/Dashboard.tsx` | Add personality panel, fix bot cards |
| `views/BotConfiguration.tsx` | Add personality tab |
| `views/Login.tsx` | Replace with Auth0 |
| `views/Register.tsx` | Replace with Auth0 |
| `app/providers.tsx` | Add Auth0Provider |

### ❌ DELETE (not needed)

| File | Why |
|------|-----|
| `views/ForgotPassword.tsx` | Auth0 handles this |
| `app/forgot-password/page.tsx` | Auth0 handles this |
| `views/ComponentShowcase.tsx` | Dev tool only |
| `app/component-showcase/page.tsx` | Dev tool only |
| `components/GuidedTour.tsx` | Over-engineered, 1348 lines |
| `components/Map.tsx` | Unused? |
| `components/WatercolorBlob.tsx` | Decorative, low priority |
| `components/AIChatBox.tsx` | Not in MVP scope |
| `components/DevNav.tsx` | Replace with proper nav |

### ➕ ADD (new components)

| Component | Purpose |
|-----------|---------|
| `components/auth/Auth0Provider.tsx` | Auth0 wrapper |
| `components/auth/LoginButton.tsx` | Auth0 login trigger |
| `components/auth/LogoutButton.tsx` | Auth0 logout |
| `components/personality/PersonalityPanel.tsx` | Personality sync UI |
| `components/personality/TraitBar.tsx` | Trait visualization |
| `components/onboarding/TemplateSelector.tsx` | Template picker (exists in tech-architect) |
| `components/onboarding/PlatformConfig.tsx` | Platform setup |
| `components/billing/UsageChart.tsx` | Usage visualization |
| `components/billing/CurrentPlan.tsx` | Plan display |
| `components/bots/BotCard.tsx` | Bot list item |
| `components/bots/BotStatusBadge.tsx` | Online/offline/deploying |

---

## Directory Structure (Target)

```
/jarble
├── app/
│   ├── layout.tsx
│   ├── providers.tsx              # Add Auth0Provider
│   ├── page.tsx                   # Landing
│   ├── login/page.tsx             # Auth0 redirect
│   ├── pricing/page.tsx
│   ├── dashboard/
│   │   └── page.tsx
│   ├── onboarding/
│   │   └── [botId]/page.tsx
│   ├── bot/
│   │   └── [botId]/
│   │       ├── page.tsx           # Bot detail
│   │       └── configure/page.tsx # Bot settings
│   └── billing/
│       └── page.tsx               # NEW: Billing management
│
├── components/
│   ├── ui/                        # KEEP ALL - design system
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   └── ... (50+ primitives)
│   │
│   ├── layout/
│   │   ├── DashboardLayout.tsx    # MOVE from components/
│   │   ├── Sidebar.tsx            # NEW
│   │   ├── Header.tsx             # NEW
│   │   └── Footer.tsx             # NEW
│   │
│   ├── auth/                      # NEW
│   │   ├── Auth0Provider.tsx
│   │   ├── LoginButton.tsx
│   │   ├── LogoutButton.tsx
│   │   └── ProtectedRoute.tsx
│   │
│   ├── bots/                      # NEW
│   │   ├── BotCard.tsx
│   │   ├── BotList.tsx
│   │   ├── BotStatusBadge.tsx
│   │   └── CreateBotButton.tsx
│   │
│   ├── onboarding/                # NEW
│   │   ├── WizardShell.tsx        # 4-step layout
│   │   ├── NameStep.tsx
│   │   ├── TemplateSelector.tsx   # From tech-architect branch
│   │   ├── PlatformConfig.tsx
│   │   └── DeployStep.tsx
│   │
│   ├── personality/               # NEW
│   │   ├── PersonalityPanel.tsx
│   │   ├── TraitBar.tsx
│   │   └── PersonalityHistory.tsx
│   │
│   ├── billing/                   # NEW
│   │   ├── PlanCard.tsx
│   │   ├── UsageChart.tsx
│   │   ├── UsageTable.tsx
│   │   └── UpgradePrompt.tsx
│   │
│   └── common/
│       ├── ErrorBoundary.tsx      # MOVE from components/
│       ├── LoadingSpinner.tsx
│       └── EmptyState.tsx
│
├── views/                         # Page-level components
│   ├── Home.tsx                   # KEEP
│   ├── Dashboard.tsx              # MODIFY
│   ├── OnboardingWizard.tsx       # REWRITE (4 steps)
│   ├── BotConfiguration.tsx       # MODIFY (add personality)
│   ├── Pricing.tsx                # KEEP
│   ├── Login.tsx                  # REWRITE (Auth0)
│   └── Billing.tsx                # NEW
│
├── hooks/
│   ├── useMobile.tsx              # KEEP
│   ├── useAuth.ts                 # NEW (Auth0 hook)
│   └── useBot.ts                  # NEW (bot queries)
│
├── lib/
│   ├── trpc.ts                    # KEEP
│   ├── auth0.ts                   # NEW
│   └── utils.ts                   # KEEP
│
└── contexts/
    └── ThemeContext.tsx           # KEEP
```

---

## Onboarding Wizard Rewrite

### Current (1157 lines, 8 steps)
Too complex. Asks for tier before they even know what they're getting.

### Target (4 steps, ~400 lines)

```tsx
// views/OnboardingWizard.tsx (simplified)

const STEPS = [
  { id: 1, title: "Name", icon: <Bot /> },
  { id: 2, title: "Template", icon: <Layout /> },
  { id: 3, title: "Platform", icon: <MessageSquare /> },
  { id: 4, title: "Deploy", icon: <Rocket /> },
];

// Step 1: Name
<Input 
  placeholder="My Assistant" 
  value={name} 
  onChange={setName} 
/>

// Step 2: Template (pulls from S3)
<TemplateSelector 
  templates={templates}
  selected={template}
  onSelect={setTemplate}
/>

// Step 3: Platform
<PlatformConfig
  platform={platform}  // discord | telegram | slack
  config={platformConfig}
  onChange={setPlatformConfig}
/>

// Step 4: Deploy
<DeployProgress 
  status={deployStatus}
  progress={progress}
/>
```

### What Happens to Cut Steps?

| Old Step | New Location |
|----------|--------------|
| Tier Selection | Post-deploy, in billing page |
| Model Provider | Template includes default |
| API Configuration | Advanced settings (bot config page) |
| Skills | Template includes defaults |
| Review | Removed (just deploy) |

---

## Auth0 Integration

### Delete
- `views/ForgotPassword.tsx`
- `views/Register.tsx` (Auth0 handles)
- Custom password logic in `views/Login.tsx`

### Add
```tsx
// components/auth/Auth0Provider.tsx
import { Auth0Provider } from '@auth0/auth0-react';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <Auth0Provider
      domain={process.env.NEXT_PUBLIC_AUTH0_DOMAIN!}
      clientId={process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID!}
      authorizationParams={{
        redirect_uri: typeof window !== 'undefined' ? window.location.origin : '',
        audience: process.env.NEXT_PUBLIC_AUTH0_AUDIENCE,
      }}
    >
      {children}
    </Auth0Provider>
  );
}
```

### Update
```tsx
// views/Login.tsx (simplified)
import { useAuth0 } from '@auth0/auth0-react';

export default function Login() {
  const { loginWithRedirect, isLoading } = useAuth0();
  
  return (
    <Button onClick={() => loginWithRedirect()} disabled={isLoading}>
      {isLoading ? <Spinner /> : "Log In"}
    </Button>
  );
}
```

---

## Personality Panel (New Feature)

Add to `views/BotConfiguration.tsx`:

```tsx
// Tab: Personality
<TabsContent value="personality">
  <PersonalityPanel botId={botId} />
</TabsContent>
```

Component:
```tsx
// components/personality/PersonalityPanel.tsx
export function PersonalityPanel({ botId }: { botId: string }) {
  const { data: profile } = trpc.personality.getProfile.useQuery({ botId });
  const toggleSync = trpc.personality.toggleSync.useMutation();
  
  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between">
          <CardTitle>🎭 Personality Sync</CardTitle>
          <Switch 
            checked={profile?.enabled}
            onCheckedChange={(v) => toggleSync.mutate({ botId, enabled: v })}
          />
        </div>
        <CardDescription>
          Your bot learns and mirrors your communication style
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Progress value={(profile?.messageCount || 0) / 5} />
        <p className="text-sm text-muted-foreground mt-2">
          {profile?.messageCount || 0} messages analyzed
        </p>
        
        <div className="mt-4 space-y-3">
          <TraitBar label="Tone" value={profile?.patterns?.tone?.casual} />
          <TraitBar label="Length" value={profile?.patterns?.verbosity?.terse} />
          <TraitBar label="Emoji" value={profile?.emojiScore} />
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## Migration Steps

### Phase 1: Cleanup (Day 1)
```bash
# Delete unused files
rm views/ForgotPassword.tsx
rm views/ComponentShowcase.tsx
rm app/forgot-password/page.tsx
rm app/component-showcase/page.tsx
rm components/GuidedTour.tsx
rm components/Map.tsx

# Create new directories
mkdir -p components/{auth,bots,onboarding,personality,billing,layout,common}
```

### Phase 2: Auth0 (Day 2)
1. Add `@auth0/auth0-react` package
2. Create `components/auth/Auth0Provider.tsx`
3. Update `app/providers.tsx` to wrap with Auth0
4. Simplify `views/Login.tsx`
5. Delete `views/Register.tsx`
6. Remove `DEV_MODE` checks

### Phase 3: Simplify Onboarding (Day 3-4)
1. Create `components/onboarding/` components
2. Rewrite `views/OnboardingWizard.tsx` (4 steps)
3. Pull `TemplateSelector` from `technical-architect` branch
4. Test flow end-to-end

### Phase 4: Dashboard Polish (Day 5)
1. Create `components/bots/` components
2. Update `views/Dashboard.tsx` with new bot cards
3. Add empty states
4. Add create bot CTA

### Phase 5: Personality Sync (Day 6)
1. Create `components/personality/` components
2. Add personality tab to `views/BotConfiguration.tsx`
3. Wire up tRPC calls

### Phase 6: Billing (Day 7)
1. Create `components/billing/` components
2. Create `views/Billing.tsx`
3. Create `app/billing/page.tsx`
4. Integrate Stripe checkout

---

## Component Checklist

### Must Have (MVP)
- [ ] Auth0 login flow
- [ ] 4-step onboarding wizard
- [ ] Dashboard with bot list
- [ ] Bot configuration page
- [ ] Billing/plan selection

### Should Have (v1.1)
- [ ] Personality sync panel
- [ ] Usage charts
- [ ] Bot metrics

### Nice to Have (v1.2)
- [ ] AI chat preview
- [ ] Template browser
- [ ] Team management

---

## Quick Reference

### Branches
- `development` — Current rough draft
- `technical-architect` — Has TemplateSelector, PlatformConfigForm
- `main` — Production (don't touch yet)

### Key Files to Study
```bash
# Current onboarding (to simplify)
cat views/OnboardingWizard.tsx

# Template selector (from tech-architect)
git show technical-architect:components/TemplateSelector.tsx

# Platform config (from tech-architect)
git show technical-architect:components/PlatformConfigForm.tsx

# Dashboard (to update)
cat views/Dashboard.tsx

# tRPC client
cat lib/trpc.ts
```

### Run Locally
```bash
cd /home/ubuntu/jarble
pnpm install
pnpm dev
# → http://localhost:3000
```

---

*This is your frontend roadmap. Work through it step by step, or hand it to the Frontend Agent.*
