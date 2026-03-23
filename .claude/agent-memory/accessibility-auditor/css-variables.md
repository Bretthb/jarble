---
name: CSS Custom Property Values
description: Confirmed hex values for Jarble CSS custom properties, used in contrast ratio calculations
type: reference
---

Sourced from `Jarble-mvp/app/globals.css`.

## Light mode (default)
- `--muted-foreground`: `#666666` — contrast on white (#fff) = ~5.7:1 (PASSES 4.5:1)
- `--muted-foreground-subtle`: `#737373` — contrast on white = ~4.73:1 (PASSES 4.5:1)
- Background: `#ffffff` or `#fafafa`

## Dark mode
- `--muted-foreground`: `#9a958e` — contrast on `#0a0a0a` ≈ 5.9:1 (PASSES)
- `--muted-foreground-subtle`: `#918c85` — contrast on `#0a0a0a` ≈ ~4.6:1 (PASSES)
- Background: `#0a0a0a` or `#171717`

## Opacity modifier failures
Any opacity modifier applied to `muted-foreground` text drops below 4.5:1:
- `text-muted-foreground/60` light: #666666 at 60% opacity → effective ~#9f9f9f on white ≈ 2.85:1 (FAILS)
- `text-muted-foreground/50` light: ≈ 3.25:1 (FAILS)
- `text-muted-foreground/40` light: ≈ ~2.6:1 (FAILS)
- `text-muted-foreground/30` light: ≈ ~2.0:1 (FAILS)
- `text-muted-foreground/80` light: ≈ ~4.3:1 (borderline FAIL for AA)

## Known violation hotspots
- `AssistantUIChat.tsx:89` — `text-muted-foreground/60` on skill name in agent call indicator
- `AssistantUIChat.tsx:101` — `text-muted-foreground/70` on tool status text
- `AssistantUIChat.tsx:275` — `text-muted-foreground/60` on reasoning preview truncation
- `OrchestrationSteps.tsx` — multiple `/40`, `/30`, `/60` modifiers on step metadata
- `ConversationHistoryPanel.tsx:107,111` — `/60` and `/50` modifiers on preview and timestamp text
