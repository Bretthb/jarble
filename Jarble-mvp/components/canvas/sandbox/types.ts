/**
 * Shared types for sandbox components (CanvasSandbox & MarketplaceSandbox).
 */

/** Error information sent from sandbox iframe via postMessage. */
export interface SandboxErrorInfo {
  message: string;
  source: string;
  line: number;
  column: number;
  stack: string;
}

/** CSP violation detail sent from sandbox iframe. */
export interface CspViolationDetail {
  blockedURI: string;
  violatedDirective: string;
  effectiveDirective: string;
  originalPolicy: string;
  sourceFile: string;
  lineNumber: number;
}

/** Storage request from sandbox to parent. */
export interface StorageRequest {
  id: string;
  op: "get" | "set" | "delete";
  key: string;
  value?: string;
}

/** Storage response from parent to sandbox. */
export interface StorageResponse {
  id: string;
  ok: boolean;
  value?: string | null;
  error?: string;
}

/** All postMessage types sent FROM sandbox iframe TO parent. */
export type SandboxOutgoingMessage =
  | { type: "jarble:ready" }
  | { type: "jarble:bridge-ready" }
  | { type: "jarble:action"; action: string; payload: unknown }
  | { type: "jarble:error"; error: SandboxErrorInfo | unknown }
  | { type: "jarble:csp-violation"; detail: CspViolationDetail }
  | { type: "jarble:heartbeat" }
  | { type: "jarble:progress"; percent: number }
  | { type: "jarble:storage-request"; request: StorageRequest }
  | { type: "jarble:event-emit"; channel: string; data: unknown }
  | { type: "jarble:resize-request"; width?: number; height?: number }
  | { type: "jarble:set-title"; title: string };

/** All postMessage types sent FROM parent TO sandbox iframe. */
export type SandboxIncomingMessage =
  | { type: "jarble:props"; props: Record<string, unknown> }
  | { type: "jarble:init"; srcdoc: string }
  | { type: "jarble:storage-response"; response: StorageResponse }
  | { type: "jarble:event"; channel: string; data: unknown };

/** Configuration for sandbox document building. */
export interface SandboxDocumentConfig {
  /** Log prefix for console messages inside the iframe. */
  logPrefix: string;
}

/** Common sandbox props shared between Canvas and Marketplace variants. */
export interface BaseSandboxProps {
  html: string;
  css?: string;
  js?: string;
  /** ES module JavaScript — rendered as `<script type="module">`. Use for `import` from esm.sh/esm.run. */
  moduleJs?: string;
  /** Import map entries — enables clean imports (e.g. `"react"` → `"https://esm.sh/react@18"`). */
  importMap?: Record<string, string>;
  props?: Record<string, unknown>;
  height?: number;
  title?: string;
  libraries?: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Heartbeat ping interval inside the sandbox iframe (ms). */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/** Number of missed heartbeats before the sandbox is killed. */
export const HEARTBEAT_MISS_LIMIT = 3;

/** Total time of silence before the sandbox is killed (ms). */
export const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * HEARTBEAT_MISS_LIMIT; // 15s

/** Maximum localStorage quota per sandbox card (bytes). */
export const SANDBOX_STORAGE_QUOTA = 1_048_576; // 1MB
