---
description: "Jarble's UI design system — typography scale, surface utilities, color tokens, motion strategy. Auto-loads when editing frontend UI files. Source: components/ui/README.md and docs/design/dashboard-refresh-plan.md."
globs:
  - "Jarble-mvp/components/ui/**"
  - "Jarble-mvp/components/**"
  - "Jarble-mvp/views/**"
  - "Jarble-mvp/app/**/*.tsx"
  - "Jarble-mvp/app/globals.css"
---

# Jarble UI Utilities & Design System

Authoritative copy lives in `Jarble-mvp/components/ui/README.md`. The full direction lives in `docs/design/dashboard-refresh-plan.md`. This rule surfaces the rules that future Claude sessions need at the moment of writing UI code.

## The four "use the system" rules

1. **Use the typography scale tokens, not ad-hoc `text-sm`.**
   - `text-display font-serif` — Playfair, page hero
   - `text-h1 font-serif` — Playfair, section header
   - `text-h2 font-sans font-semibold` — Inter, sub-section / modal title
   - `text-body font-sans` — default copy
   - `text-micro font-sans uppercase tracking-wide` — status pills, microtype caps
   - `font-mono` — every identifier, duration, count, model name, log line. Data, not prose.

2. **Use the existing surface utilities, not hand-rolled card chrome.**
   - `.card-surface` for elevated cards
   - `.section-group` for form-field groupings
   - `.info-box` for inline callouts
   - `.charcoal-glow` / `.charcoal-glow-strong` for warm hover/focus glow
   - `.charcoal-stroke` for warm-tinted borders in dark mode

3. **Stay on the warm palette + muted status colors.**
   - Primary `#c85a5a`, dark-mode borders `rgba(200, 90, 90, 0.08)` — warm thread.
   - Status colors muted (`text-emerald-400 / amber-400 / red-400 / stone-400`). **No pastel candy** (mint / peach / lavender).
   - Chart palette is the 5 `--chart-N` tokens — use those for any sparkline / chart stroke.

4. **Motion: CSS keyframes + `<FadeIn>`. Don't add new framer-motion imports.**
   - `framer-motion` exists in the dep tree and stays for legacy callers (`Dashboard.tsx`, `OnboardingWizard.tsx`, `WizardLoader.tsx`, `PageFullscreenOverlay.tsx`, deprecated canvas surface).
   - **New components must not import `framer-motion`** — use the named keyframes in `globals.css` (`fade-in-up`, `fade-in-up-fast`, `fade-in-scale`, `step-enter`, `shimmer`) or the lightweight `<FadeIn>` wrapper.

## What NOT to do

These appeared in the competitive scan as "AI-generic" tells. Do not introduce any of them:

- Glassmorphic translucent cards stacked on a gradient backdrop
- "Welcome back, {name} 👋" hero with avatar + emoji wave
- Pastel candy-color status badges
- Decorative AI illustrations in empty states (robots / sparkles / neural-net swirls)
- Animated gradient blobs / mesh backgrounds behind cards
- Identical card grids where every card is the same shape and size regardless of importance

## Iconography

`lucide-react` only. Default `w-4 h-4` from shadcn button defaults. Use `size-N` to override.

## Deprecated areas — do not extend

Per the harness-and-chat-decision policy (2026-05-12) and the dashboard refresh plan, **do not extend** these surfaces — they are on a path to deletion:

- `Jarble-mvp/components/canvas/**`
- `Jarble-mvp/components/chat/**`
- `Jarble-mvp/components/workspace/**` (legacy chat workspace; the orchestration canvas in `views/Deployments.tsx` is separate and stays)
- `Jarble-mvp/hooks/useCanvasChat.ts`
- `Jarble-mvp/lib/assistantRuntime.ts`

## Reaching for the system

- Need a token? Check `globals.css` `@theme inline {}` block first.
- Need a utility? Check `globals.css` after the @theme block.
- Need a component? Check `Jarble-mvp/components/ui/` (shadcn) or `Jarble-mvp/components/` (Jarble bespoke) before scaffolding new ones.

When in doubt: read `Jarble-mvp/components/ui/README.md`.
