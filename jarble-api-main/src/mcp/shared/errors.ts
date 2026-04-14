/**
 * Standard MCP error codes + typed error classes.
 *
 * Handlers throw these; the proxy / SDK adapter catches and converts to the
 * MCP wire format. This lets all three servers speak the same error vocabulary
 * without every tool reinventing its own message shape.
 */

export type McpErrorCode =
  | "INVALID_ARGS"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "UPSTREAM_FAILED"
  | "TIMEOUT"
  | "INTERNAL"
  | "NOT_IMPLEMENTED";

export class McpError extends Error {
  readonly code: McpErrorCode;
  readonly details?: unknown;

  constructor(code: McpErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.details = details;
  }
}

export class InvalidArgsError extends McpError {
  constructor(message: string, details?: unknown) {
    super("INVALID_ARGS", message, details);
    this.name = "InvalidArgsError";
  }
}

export class NotFoundError extends McpError {
  constructor(message: string, details?: unknown) {
    super("NOT_FOUND", message, details);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends McpError {
  constructor(message = "Unauthorized", details?: unknown) {
    super("UNAUTHORIZED", message, details);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends McpError {
  constructor(message = "Forbidden", details?: unknown) {
    super("FORBIDDEN", message, details);
    this.name = "ForbiddenError";
  }
}

export class UpstreamError extends McpError {
  constructor(message: string, details?: unknown) {
    super("UPSTREAM_FAILED", message, details);
    this.name = "UpstreamError";
  }
}

export class TimeoutError extends McpError {
  constructor(message: string, details?: unknown) {
    super("TIMEOUT", message, details);
    this.name = "TimeoutError";
  }
}
