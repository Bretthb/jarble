/**
 * ChatAdapter — runtime-agnostic chat transport interface (JAR-121).
 *
 * Today chat routes (`routes/tamboAgent.ts`, `routes/flowChat.ts`,
 * `routes/botAsk.ts`) import `chatViaGateway` / `chatViaHTTP` /
 * `chatViaExec` directly from `services/openclawGateway.ts`. That
 * works because OpenClaw is the only runtime. For a second runtime
 * with a different transport (ZeroClaw's Axum HTTP + Bearer auth,
 * LangGraph's SSE, Dify's chat API), the routes need to dispatch on
 * the runtime's declared transport rather than hard-coding the
 * OpenClaw three-tier chain.
 *
 * This file defines the transport-agnostic interface. The actual
 * OpenClaw adapter lives in `openclaw.ts` and wraps the existing
 * gateway helpers — no behavior change.
 *
 * The registry in `index.ts` maps runtime slug → adapter. Callers
 * that need chat pick the adapter via `getChatAdapter(deployment)`
 * and invoke its methods; they never know about runtime-specific
 * transport details.
 *
 * JAR-121 lands the interface + OpenClaw adapter + registry. The
 * full migration of tamboAgent / flowChat / botAsk is a follow-up
 * because the existing retry logic is entangled with those routes
 * and a clean migration needs live testing against dev.jarble.ai.
 */

export type ChatTransport = "openclaw-ws" | "http-stream" | "none";

export interface ChatAdapter {
  /** Runtime slug — must match a registered RuntimeHandler. */
  readonly runtimeSlug: string;
  /** Declared transport. Matches RuntimeCapabilities.chatTransport. */
  readonly transport: ChatTransport;

  /**
   * Simple probe — does this adapter know how to talk to the runtime
   * identified by `runtimeSlug`? Useful for registry lookups that
   * want to gracefully degrade rather than throw.
   */
  canHandle(runtimeSlug: string): boolean;
}
