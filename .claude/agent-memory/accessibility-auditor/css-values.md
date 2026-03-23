# CSS Custom Property Values — Confirmed from globals.css

Source: `Jarble-mvp/app/globals.css`

## Light Mode (:root)
| Token | Hex | Notes |
|-------|-----|-------|
| --background | #ffffff | |
| --foreground | #1a1a1a | |
| --primary | #000000 | |
| --primary-foreground | #ffffff | |
| --muted-foreground | #666666 | Contrast on #fff = 5.74:1 (passes AA) |
| --muted-foreground-subtle | #737373 | Contrast on #fff = 4.73:1 (passes AA) |
| --secondary | #f4f4f5 | |
| --muted | #fafafa | |
| --border | #e4e4e7 | |
| --card | #ffffff | |

## Dark Mode (.dark)
| Token | Hex | Notes |
|-------|-----|-------|
| --background | #0f0e0d | |
| --foreground | #e8e4df | |
| --primary | #f0ece6 | |
| --primary-foreground | #0f0e0d | |
| --muted-foreground | #9a958e | Contrast on #0f0e0d ≈ 4.46:1 (borderline, check) |
| --muted-foreground-subtle | #918c85 | Contrast on #0f0e0d ≈ 4.2:1 (fails AA for small text) |
| --card | #161514 | |
| --secondary | #1e1d1b | |
| --border | #2e2b28 | |

## Key Findings
- Light mode `text-muted-foreground` (#666666 on #fff) = 5.74:1 — PASSES AA
- Dark mode `text-muted-foreground` (#9a958e on #0f0e0d) ≈ 4.46:1 — borderline, may fail for some text sizes
- Dark mode `text-muted-foreground-subtle` (#918c85 on #0f0e0d) ≈ 4.2:1 — FAILS AA for normal text
- The `/60`, `/70`, `/80` opacity modifiers on muted-foreground will always fail AA
- `text-muted-foreground/60` in light mode = rgba(102,102,102,0.6) on #fff ≈ 3.07:1 — FAILS
- `text-muted-foreground/70` in light mode ≈ 3.65:1 — FAILS
- `text-muted-foreground/80` in light mode ≈ 4.24:1 — FAILS (just under 4.5:1)
