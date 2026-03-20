# Component Audit Status

## Audited — March 2026

### app/d/[id]/page.tsx (WorkspacePage / CanvasWorkspace)
Status: AUDITED — Multiple issues found
- Missing `aria-label` on Back button (icon-only)
- Missing `aria-label` on Send/Stop buttons in chat input
- Missing `aria-expanded` on all panel toggle buttons (History, Files, Knowledge, Credits, Services, Marketplace, Config)
- Missing `aria-label` on the chat resize handle div
- No `<h1>` on the workspace page
- `text-muted-foreground/60` opacity used in one place (line 89 via AssistantUIChat)

### components/chat/AssistantUIChat.tsx
Status: AUDITED — Multiple issues found
- ActionBarPrimitive.Edit/Copy/Reload are icon-only — need aria-label (Radix ActionBar does expose this via its primitive, but the `className` wrapper strips visible text; needs verification)
- `text-muted-foreground/60`, `/70`, `/80` used on status text (contrast failures)
- `text-muted-foreground/60` on agent delegation skill name (line 89)
- Missing aria-live for streaming status changes (toolStatus, activeAgentCall, orchestrationSteps)
- Reasoning expand/collapse button missing `aria-expanded`

### components/workspace/SimpleCanvasGrid.tsx
Status: AUDITED — Some issues, many good patterns
- GOOD: `role="grid"`, `role="gridcell"`, `aria-live` region, `aria-grabbed`, `aria-label` on cards
- GOOD: Roving tabindex with arrow key navigation
- GOOD: Resize handle has `role="slider"` + `aria-label` + `aria-valuenow`
- Issue: `tabIndex={-1}` on resize handle prevents keyboard access
- Issue: Context menu has no `role="menu"` / `role="menuitem"` semantics
- Issue: Card menu button (... button) is visible only on hover (opacity-0) — keyboard users cannot discover it
- Issue: Undo-toast close button (X) has no aria-label
- Issue: Resize handle only has `aria-valuenow` for width, not height — it controls 2D

### views/OnboardingWizard.tsx
Status: AUDITED — Multiple issues found
- Progress bar has no accessible label or `role="progressbar"` + aria-valuenow
- Step nav buttons missing `aria-current="step"` on active step
- No `aria-live` announcement when step changes

### views/Dashboard.tsx
Status: AUDITED — Mostly good, some issues
- No `<h1>` — page starts with `<h2>Deployments</h2>` (heading hierarchy skip)
- DeploymentCard uses `role="button"` on Card correctly with Enter/Space handler
- Action buttons have aria-label — GOOD
- framer-motion whileHover animation not respecting prefers-reduced-motion (component-level)
- Loader2 spinner on action buttons has no sr-only text

### components/chat/OrchestrationSteps.tsx
Status: AUDITED — Issues found
- No `role="status"` or `aria-live` on the orchestration steps container
- Status icons (error dot) use only color + "!" text as indicator
- `text-muted-foreground/40`, `/60` extensively used — contrast failures

### components/canvas/sandbox/SandboxControls.tsx
Status: AUDITED — Minor issues
- SandboxControlBar button has visible text (Restart/Stop) — GOOD
- SVG PlayIcon/StopIcon have no aria-hidden — they are next to text so decorative, should have aria-hidden
