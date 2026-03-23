# Recurring Violation Patterns

## 1. Opacity modifiers on text colors
Pattern: `text-muted-foreground/60`, `/70`, `/80` used for status text, agent indicators, and decorative text.
These fail WCAG 4.5:1 contrast in both modes. Already fixed for `/40`, `/50` per CLAUDE.md, but `/60`-`/80` range persists.
Files: AssistantUIChat.tsx (lines 89, 101, 275, 281), OrchestrationSteps.tsx (many instances)
Fix: Use `text-muted-foreground-subtle` for any text that is semantically important, or `text-muted-foreground` for medium emphasis. Reserve opacity modifiers only for truly decorative elements.

## 2. Icon-only interactive elements without aria-label
Pattern: Small action buttons (Edit, Copy, Reload, Zoom in/out) use lucide icons with no visible text and no aria-label.
The `title` attribute is not a reliable aria-label substitute (not read by all screen readers, not announced on focus).
Files: AssistantUIChat.tsx action bars, page.tsx header nav buttons (Back, History, Files, Knowledge, Credits, Hosted Services, Marketplace, Settings).
Fix: Add `aria-label="[Action] [target]"` to all icon-only buttons. Hide decorative icons with `aria-hidden="true"`.

## 3. Panel toggle buttons missing aria-expanded
Pattern: Header buttons that toggle slideover panels (History, Files, Config, etc.) use only visual state (variant="secondary" vs "ghost") to indicate open/closed state.
Screen readers cannot discover whether the panel is open.
Fix: Add `aria-expanded={panelOpen}` and `aria-controls="panel-id"` to each toggle button.

## 4. Missing heading hierarchy — no h1
Pattern: Both Dashboard and the workspace page lack an `<h1>`. Dashboard jumps straight to `<h2>Deployments</h2>`, and the workspace page has no headings at all.
Fix: Add a visually appropriate (or sr-only) `<h1>` to each page. Workspace could use the deployment name.

## 5. No aria-live on streaming/dynamic status
Pattern: Streaming status (toolStatus, orchestration steps, agent delegation) appears dynamically but has no aria-live region.
Screen readers do not announce these changes.
Fix: Wrap or add `aria-live="polite"` + `aria-atomic` region for status updates.

## 6. Context menu lacks menu semantics
Pattern: Canvas right-click context menu is a positioned `<div>` with plain `<button>` children. No `role="menu"` or `role="menuitem"`, no arrow key navigation, no Escape handler propagation from menu root.
Fix: Add `role="menu"` on container, `role="menuitem"` on items, implement ArrowUp/ArrowDown/Escape keyboard nav.

## 7. Framer Motion animations not respecting reduced-motion at component level
Pattern: `motion.div` with `whileHover`, `initial/animate` animations are used in Dashboard DeploymentCard without checking `prefers-reduced-motion`. The global CSS rule reduces animation-duration to 0.01ms but framer-motion bypasses this.
Fix: Use `useReducedMotion()` hook from framer-motion in animated components, or apply `useMotionValue`/`animate` conditionally.

## 8. Checkbox/radio groups implemented as styled buttons without role
Pattern: In StepChooseRuntime and StepLlmSetup / ModelSelector, radio-like selection UI uses plain `<button>` elements with visual selection state but no `role="radio"` / `role="radiogroup"`, no `aria-checked`.
Fix: Add `role="radiogroup"` on the container and `role="radio"` + `aria-checked={isSelected}` on each option button.
