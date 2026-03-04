/**
 * AG-UI Event Type Constants
 *
 * Standard AG-UI events for protocol compliance, plus custom Jarble-specific
 * events wrapped in the AG-UI CUSTOM event type.
 */

// ── AG-UI Standard Events (already emitted) ─────────────────────────────────

export const RUN_STARTED = "RUN_STARTED";
export const TEXT_MESSAGE_START = "TEXT_MESSAGE_START";
export const TEXT_MESSAGE_CONTENT = "TEXT_MESSAGE_CONTENT";
export const TEXT_MESSAGE_END = "TEXT_MESSAGE_END";
export const RUN_FINISHED = "RUN_FINISHED";

// ── AG-UI Standard Events (new — replaces UI_BLOCK_*) ───────────────────────

export const TOOL_CALL_START = "TOOL_CALL_START";
export const TOOL_CALL_ARGS = "TOOL_CALL_ARGS";
export const TOOL_CALL_END = "TOOL_CALL_END";

// ── AG-UI Custom Event Wrapper ──────────────────────────────────────────────

export const CUSTOM = "CUSTOM";

// ── Custom Event Names (used with CUSTOM type) ─────────────────────────────

export const CUSTOM_CARD_UPDATE = "jarble.card.update";
export const CUSTOM_COMPONENT_DEFINED = "jarble.component.defined";
export const CUSTOM_CHAT_ERROR = "jarble.chat.error";
export const CUSTOM_DASHBOARD_CREATED = "jarble.dashboard.created";
export const CUSTOM_ARTIFACT_UPDATED = "jarble.artifact.updated";
