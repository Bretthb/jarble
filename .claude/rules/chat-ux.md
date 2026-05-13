---
description: "**Legacy reference** for the deprecated Jarble-built chat / canvas surface. The supported per-deployment chat UI is the Agent Harness's own webchat (OpenClaw's webchat today) — do not extend the code documented below. Auto-loaded when editing the legacy files so anyone touching them sees the deprecation notice."
globs:
  - "Jarble-mvp/hooks/useCanvasChat*"
  - "Jarble-mvp/lib/assistantRuntime*"
  - "Jarble-mvp/lib/conversationStorage*"
  - "Jarble-mvp/components/chat/**"
  - "Jarble-mvp/components/workspace/ConversationHistory*"
  - "Jarble-mvp/components/workspace/SimpleCanvas*"
  - "Jarble-mvp/components/canvas/**"
  - "jarble-api-main/src/routes/tamboAgent*"
status: deprecated
---

> ⚠️ **DEPRECATED SURFACE.** Per PRODUCT.md (2026-05-12), Jarble no longer ships its own chat / canvas UI. The per-deployment chat is the Agent Harness's webchat. This rule documents legacy code that is on a path to deletion — read it to understand existing behavior when touching the files, but do not add features here. New user-facing chat work belongs upstream in the harness, not in `Jarble-mvp/components/canvas/`.

# Chat UX Features (legacy reference)

## Stop Generation
Send button transforms to filled square stop button when streaming. Partial text preserved as assistant message. Sending a new message auto-aborts current generation.

## Message Edit + Resend
Hover over user messages → pencil icon → inline editor (assistant-ui's `ActionBarPrimitive.Edit`). Editing truncates conversation and resends. Wired via `onEdit` in `useExternalStoreRuntime`.

## Conversation History Sidebar
Multi-conversation system backed by localStorage (`conversationStorage.ts`). Each conversation maps to a separate OpenClaw session via `conversationId` → `sessionKey`.
- **Storage**: Index at `jarble-conversations-{deploymentId}`, messages at `jarble-conv-{deploymentId}-{convId}`. 20 conv max, 100 msg each, 7-day expiry.
- **Session isolation**: Each conversation gets its own OpenClaw session (`jarble-web-{userId}-{convId}`).
- **KeyedChatPanel**: Chat panel keyed by `activeConversationId` to force full remount on switch.

## Streaming Reasoning (Think Tags)
`createReasoningTracker()` in `tamboAgent.ts` parses `<think>`/`<reasoning>` tags and emits `REASONING_START/CONTENT/END` SSE events. Frontend streams via rAF-based typewriter reveal.

## Typewriter Text Reveal
`CHARS_PER_FRAME = 8` at 60fps ≈ 480 chars/sec. Target text accumulates instantly from SSE deltas; displayed text catches up per animation frame.

## Component Edit Sync
- **`content_edit` action**: Components emit via `useCanvasAction()` → `UPDATE_CARD_PROPS` silently
- **Card content snapshot**: `getCardContentSnapshot()` extracts current content for `[EDITING cardId]` reference block
- **Editable code blocks**: `CanvasCodeBlock` has pencil toggle, Tab indent, Ctrl+S save, Escape cancel

## Canvas Card Controls
Card actions (Ask, Select, Split, Save, Publish, Close) via right-click context menu or `...` button in top-right corner on hover. Context menu renders at canvas root level to avoid CSS transform positioning issues.

## Key Files
| File | Purpose |
|------|---------|
| `hooks/useCanvasChat.ts` | Chat hook — streaming, conversation mgmt, stop/edit, typewriter |
| `lib/assistantRuntime.ts` | assistant-ui ExternalStoreRuntime — onNew, onCancel, onEdit |
| `lib/conversationStorage.ts` | localStorage multi-conversation CRUD, legacy migration |
| `components/chat/AssistantUIChat.tsx` | Thread UI — bubbles, reasoning renderer, edit button |
| `components/workspace/ConversationHistoryPanel.tsx` | Conversation sidebar |
| `components/workspace/SimpleCanvasGrid.tsx` | Freeform canvas — cards, context menu, drag/resize |
| `components/canvas/CanvasActionContext.tsx` | Action dispatch context |
| `components/canvas/components/CanvasCodeBlock.tsx` | Code block — shiki, inline edit, copy |
| `components/canvas/FadeIn.tsx` | Lightweight mount-animation wrapper (22+ components) |
