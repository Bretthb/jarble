# Jarble UI Primitives

This directory holds shadcn/ui primitives and a small set of Jarble-specific design tokens / utilities. The intent is **one source of truth for visual chrome** — if you find yourself hand-rolling card padding, border treatments, or glow shadows, check this README first.

> Source of truth for the broader UI direction: `docs/design/dashboard-refresh-plan.md`.

---

## Typography scale (Phase 0 — JAR-136)

The `@theme inline` block in `Jarble-mvp/app/globals.css` defines a five-step semantic type scale on top of three font families. Use these utilities instead of ad-hoc `text-sm` / `font-serif` combinations so the rhythm stays consistent across the product.

| Utility | Family | Size / line-height | Use for |
|---------|--------|--------------------|---------|
| `text-display font-serif` | Playfair Display | 2.25rem / 1.15 | Page hero, marketing headers |
| `text-h1 font-serif` | Playfair Display | 1.5rem / 1.25 | Section headers in app surfaces |
| `text-h2 font-sans font-semibold` | Inter | 1.125rem / 1.3 | Sub-section headers, modal titles |
| `text-body font-sans` | Inter | 0.875rem / 1.5 | Default body text — most copy |
| `text-micro font-sans uppercase tracking-wide` | Inter | 0.6875rem / 1 | Status pills, metadata caps, microtype |
| `font-mono` | JetBrains Mono | inherits size | **Every identifier**: deployment IDs, request IDs, durations, model names, region tags, log lines, anything that's "data, not prose" |

The mono voice is the highest-leverage rule. If a value is a number, an ID, a duration, a count, or a code snippet, it should render in `font-mono`. This is what makes a product feel like infrastructure instead of marketing copy.

---

## Surface utilities

These live in `globals.css` and predate the dashboard refresh. **Use them rather than reinventing card chrome.**

| Utility | Purpose | When to use |
|---------|---------|-------------|
| `.card-surface` | Backdrop blur + soft shadow + warm border | Elevated cards (dashboard tiles, wizard panels, modal bodies) |
| `.section-group` | Semi-transparent secondary background + softened border | Form-field group containers, compact info groupings |
| `.info-box` | Standard info-callout chrome | Inline notifications, "did you know" callouts |
| `.charcoal-glow` | `box-shadow: 0 0 12px 2px rgba(200, 90, 90, 0.06)` | Subtle warm glow on hover / focus targets |
| `.charcoal-glow-strong` | `0 0 20px 4px rgba(200, 90, 90, 0.1)` | Active / selected state glow |
| `.charcoal-stroke` | `1px solid rgba(200, 90, 90, 0.08)` | Soft warm-tinted borders for dark mode |

If you need a new utility because none of these fit, **add it here and document it** rather than inlining one-off Tailwind soup in a component.

---

## Color system

Jarble's palette is warm-red primary on neutral, tuned for a paper-grain dark mode. All colors are CSS variables defined in `:root` (light) and `.dark` (dark mode).

- **Primary:** `#c85a5a` (warm red, identical across light/dark)
- **Accents bleed warm into neutrals.** Dark-mode borders use `rgba(200, 90, 90, 0.08)` so the accent threads through every element instead of feeling bolted on.
- **Status colors** (used by `<StatusBadge>`): `text-emerald-400` for running, `text-amber-400` for transitional states, `text-red-400` for failed, `text-stone-400` for stopped. **Muted, not saturated.** Pastel candy colors (mint, peach, lavender) are explicitly out of scope.
- **Chart palette:** 5 colors defined as `--chart-1` through `--chart-5`. Use them via `text-chart-N` / `bg-chart-N` for any chart, sparkline, or visualization stroke.

---

## Motion

Jarble's motion is intentionally minimal and CSS-keyframe-driven. The full set of named animations lives in `globals.css`:

- `fade-in-up` (0.6s) — page section entrance
- `fade-in-up-fast` (0.2s) — element reveal
- `fade-in-scale` (0.8s) — hero / pricing card entrance
- `step-enter` (0.3s) — wizard step transitions
- `shimmer` (1.5s infinite) — loading skeletons
- `fadeIn` (0.3s) — generic
- `blink` — skeleton/cursor

`prefers-reduced-motion` is respected globally, with an exemption for `.animate-spin / .animate-pulse / .animate-ping` so loading indicators stay legible.

### framer-motion strategy

`framer-motion` IS in the dep tree and IS used today in `Dashboard.tsx`, `OnboardingWizard.tsx`, `WizardLoader.tsx`, `PageFullscreenOverlay.tsx`, plus the deprecated canvas surface. **Existing usages stay; new components in Phase 1+ should not add new framer-motion imports** — prefer the CSS keyframes above or the lightweight `<FadeIn>` wrapper. Removal of `framer-motion` from the bundle is a downstream concern tied to the canvas surface deletion.

---

## Iconography

`lucide-react` only. No other icon libraries. No inline SVG that duplicates a lucide icon. Default size `w-4 h-4` (inherited from shadcn button defaults). When sizing differently, prefer `size-N` Tailwind utilities to keep stroke width visually consistent.

---

## Adding a new shadcn primitive

If you genuinely need a primitive that isn't already here, install via the shadcn CLI rather than copying from npm. The CLI keeps imports + theme references consistent with the existing primitives.

JAR-91 is tracking deletion of ~36 primitives that are imported nowhere. Before adding a new primitive, check if one of those covers the use case — restoring an existing one is cheaper than introducing a new dependency.

---

## When in doubt

- **Reach for a token, not a magic number.** Custom hex / rem in a component is a smell.
- **Reach for a utility class above before inlining shadow / blur / border treatments.**
- **Reach for `font-mono` whenever you're rendering data, not prose.**
- **Don't add framer-motion to new code.** Use CSS keyframes.

The `.claude/rules/ui-utilities.md` rule auto-loads when working in this directory, so future Claude sessions will surface this guidance without being asked.
