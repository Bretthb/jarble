/**
 * Mesh Gateway Shared Secret
 *
 * Provides a cryptographically random token for authenticating internal
 * mesh-gateway-to-service-proxy calls. Both meshGateway.ts and serviceProxy.ts
 * import this module so they share the same token value within the process.
 *
 * Token source (in priority order):
 *   1. MESH_GATEWAY_SECRET env var - use this when gateway and proxy run in
 *      separate processes (e.g. separate K8s pods). Both processes must share
 *      the same secret.
 *   2. crypto.randomUUID() - generated once at import time. Safe when both
 *      gateway and proxy run in the same Node process (the common case),
 *      because they share the same module cache and therefore the same token.
 *
 * Security rationale: The previous implementation used a hardcoded string
 * ("mesh-gateway-internal") which was predictable and could be used by an
 * attacker who discovered the token value. A per-process random token
 * eliminates that risk.
 */
import crypto from "crypto";
import { env } from "../utils/env.js";

export const meshGatewayToken: string = env.MESH_GATEWAY_SECRET || crypto.randomUUID();
