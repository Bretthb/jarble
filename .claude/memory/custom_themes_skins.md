---
name: Custom Themes & Skins Feature
description: User-created themes and skins saved to PVC, accessible via /create-theme and /create-skin slash commands, eventually publishable to marketplace
type: project
---

User wants the ability to create custom themes and skins that persist per-user on the PVC and can later be published to the marketplace.

**Why:** Current themes/skins are preset-only. Users should be able to design their own and share them.

**How to apply:** When implementing, build on existing infrastructure:

### Slash Commands
- `/create-theme <name>` — saves current themeConfig as a named custom theme to `/data/custom-themes/<name>.json`
- `/create-skin <name>` — saves current skin config as a named custom skin
- `/my-themes` — lists user's saved custom themes
- `/my-skins` — lists user's saved custom skins
- `/theme <custom-name>` — should check custom themes first, then presets

### Storage
- PVC path: `/data/custom-themes/` and `/data/custom-skins/`
- JSON files per theme/skin with full config
- Survives pod restarts (Longhorn PVC)

### Marketplace Integration (later)
- Publish custom theme/skin to marketplace (component type: "theme" or "skin")
- Browse/install community themes
- Preview before install

### Architecture Notes
- `handleThemeChange()` in tamboAgent.ts already does preset → config resolution
- `resolveThemeVars()` in themes.ts handles CSS variable generation
- Skin system uses `data-skin` attribute + CSS in globals.css
- Custom skins would need a way to inject custom CSS (possibly via a `<style>` tag or CSS-in-JS)
- Theme marketplace items could reuse the existing `marketplaceComponents` table with a new category
