/**
 * Chat error classification - maps raw error strings to structured codes
 * with user-facing messages, suggestions, and available actions.
 */

export type ChatErrorCode =
  | "GATEWAY_TIMEOUT"
  | "EXEC_TIMEOUT"
  | "GATEWAY_REFUSED"
  | "GATEWAY_RESET"
  | "GATEWAY_AUTH_FAILED"
  | "POD_NOT_FOUND"
  | "DEPLOYMENT_NOT_RUNNING"
  | "POD_CRASH_LOOP"
  | "BOT_EMPTY_RESPONSE"
  | "CREDITS_EXHAUSTED"
  | "UNKNOWN";

export interface ClassifiedError {
  code: ChatErrorCode;
  message: string;
  suggestion: string;
  canRetry: boolean;
  canStart: boolean;
  canDiagnose: boolean;
  canTopUp?: boolean;
}

interface ClassifyContext {
  deploymentStatus?: string;
}

const ERROR_MAP: Array<{
  pattern: RegExp | ((msg: string, ctx: ClassifyContext) => boolean);
  result: ClassifiedError;
}> = [
  {
    pattern: /\b402\b|Payment Required|insufficient credit|insufficient.*balance|out of credit|credits? exhausted|quota exceeded/i,
    result: {
      code: "CREDITS_EXHAUSTED",
      message: "Managed credits exhausted",
      suggestion: "Add credits to your deployment to continue chatting",
      canRetry: false,
      canStart: false,
      canDiagnose: false,
      canTopUp: true,
    },
  },
  {
    pattern: /execInPod timed out/i,
    result: {
      code: "EXEC_TIMEOUT",
      message: "Bot took too long to respond",
      suggestion: "Try a simpler request, or restart the bot if it's stuck",
      canRetry: true,
      canStart: false,
      canDiagnose: true,
    },
  },
  {
    pattern: /ETIMEDOUT|timed out/i,
    result: {
      code: "GATEWAY_TIMEOUT",
      message: "Gateway timed out",
      suggestion: "Try restarting the bot",
      canRetry: true,
      canStart: false,
      canDiagnose: true,
    },
  },
  {
    pattern: /ECONNREFUSED|handshake/i,
    result: {
      code: "GATEWAY_REFUSED",
      message: "Gateway not accepting connections",
      suggestion: "Bot may still be starting up",
      canRetry: true,
      canStart: false,
      canDiagnose: true,
    },
  },
  {
    pattern: /ECONNRESET|closed before response/i,
    result: {
      code: "GATEWAY_RESET",
      message: "Connection was reset",
      suggestion: "Try again in a moment",
      canRetry: true,
      canStart: false,
      canDiagnose: true,
    },
  },
  {
    pattern: /closed before auth|auth failed/i,
    result: {
      code: "GATEWAY_AUTH_FAILED",
      message: "Gateway auth failed",
      suggestion: "Try restarting the bot",
      canRetry: false,
      canStart: false,
      canDiagnose: true,
    },
  },
  {
    pattern: /empty response/i,
    result: {
      code: "BOT_EMPTY_RESPONSE",
      message: "Bot sent an empty response",
      suggestion: "Try rephrasing or restarting the bot",
      canRetry: true,
      canStart: false,
      canDiagnose: true,
    },
  },
  {
    pattern: /No pod found|no running pod/i,
    result: {
      code: "POD_NOT_FOUND",
      message: "No running pod found",
      suggestion: "Start the bot first",
      canRetry: false,
      canStart: true,
      canDiagnose: true,
    },
  },
  {
    pattern: /CrashLoopBackOff/i,
    result: {
      code: "POD_CRASH_LOOP",
      message: "Bot is crash-looping",
      suggestion: "Check config and restart",
      canRetry: false,
      canStart: false,
      canDiagnose: true,
    },
  },
  {
    pattern: (_msg, ctx) =>
      ctx.deploymentStatus !== undefined &&
      ctx.deploymentStatus !== "running" &&
      ctx.deploymentStatus !== "creating" &&
      ctx.deploymentStatus !== "restarting",
    result: {
      code: "DEPLOYMENT_NOT_RUNNING",
      message: "Bot is not running",
      suggestion: "Start the bot",
      canRetry: false,
      canStart: true,
      canDiagnose: true,
    },
  },
];

export function classifyError(errorMessage: string, ctx: ClassifyContext = {}): ClassifiedError {
  for (const { pattern, result } of ERROR_MAP) {
    if (typeof pattern === "function") {
      if (pattern(errorMessage, ctx)) return result;
    } else {
      if (pattern.test(errorMessage)) return result;
    }
  }

  return {
    code: "UNKNOWN",
    message: "Something went wrong",
    suggestion: "Run diagnostics",
    canRetry: true,
    canStart: false,
    canDiagnose: true,
  };
}
