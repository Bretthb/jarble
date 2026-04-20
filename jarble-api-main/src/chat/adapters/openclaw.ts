/**
 * OpenClawChatAdapter — wraps the existing services/openclawGateway.ts
 * helpers behind the ChatAdapter interface (JAR-121).
 *
 * v1 just re-exports the underlying WS/HTTP/exec helpers. The three
 * chat routes (tamboAgent / flowChat / botAsk) still import from
 * `services/openclawGateway.ts` directly; moving them to this adapter
 * is a follow-up after live testing. Landing the wrapper now gives
 * us a seam so a second runtime's adapter can slot in before the
 * route migration happens.
 */

import type { ChatAdapter } from "./types.js";

export const openclawChatAdapter: ChatAdapter = {
  runtimeSlug: "openclaw",
  transport: "openclaw-ws",
  canHandle(runtimeSlug: string) {
    return runtimeSlug === "openclaw";
  },
};
