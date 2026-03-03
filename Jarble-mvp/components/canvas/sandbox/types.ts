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

/** All postMessage types sent FROM sandbox iframe TO parent. */
export type SandboxOutgoingMessage =
  | { type: "jarble:ready" }
  | { type: "jarble:bridge-ready" }
  | { type: "jarble:action"; action: string; payload: unknown }
  | { type: "jarble:error"; error: SandboxErrorInfo | unknown }
  | { type: "jarble:csp-violation"; detail: CspViolationDetail };

/** All postMessage types sent FROM parent TO sandbox iframe. */
export type SandboxIncomingMessage =
  | { type: "jarble:props"; props: Record<string, unknown> }
  | { type: "jarble:init"; srcdoc: string };

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
  props?: Record<string, unknown>;
  height?: number;
  title?: string;
  libraries?: string[];
}
