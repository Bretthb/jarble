---
name: slash_commands_theme
description: Theme changes should only happen via explicit /theme command, never from contextual keyword detection
type: feedback
---

Theme switching must ONLY trigger on explicit `/theme` or `/skin` slash commands.

**Why:** The bot was too aggressively detecting theme intent from contextual mentions like "windows 98" or "terminal" in conversation, causing unwanted theme switches.

**How to apply:** The slash command system (implemented in tamboAgent.ts:tryHandleSlashCommand) handles /theme, /skin, /color-preset, /reset, /clear, /commands. The bot's system prompt tells it NOT to call set_theme unless explicitly asked. All theme changes go through the API-level command handler, not through keyword detection.
