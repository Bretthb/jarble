/**
 * ServiceCard — Structured descriptor for remote/hybrid marketplace services.
 *
 * When a creator publishes a remote service, they provide a ServiceCard that
 * describes their API endpoint, authentication requirements, exposed skills
 * (MCP-compatible tool definitions), and rate limits. Stored as JSON in
 * `marketplaceServices.remoteApiConfig`.
 *
 * Inspired by:
 * - A2A Agent Card (`/.well-known/agent.json`)
 * - MCP Registry `server.json`
 * - Shopify App Proxy descriptors
 *
 * Uses Zod v3 (API package).
 */

import { z } from "zod";
import { validateExternalUrl } from "../utils/urlValidation.js";

// ── JSON Schema sub-schema ──────────────────────────────────────────────────
// Lightweight validator for JSON Schema objects used in skill input/output.
// We only require `type: "object"` with `properties` — full draft-07 validation
// happens at proxy time via the existing schemaValidation utility.

const jsonSchemaSchema = z
  .object({
    type: z.literal("object"),
    properties: z.record(z.unknown()),
    required: z.array(z.string()).optional(),
  })
  .passthrough();

// ── Skill Definition ────────────────────────────────────────────────────────

export const serviceCardSkillSchema = z.object({
  /** Skill tool name, e.g. "get_weather". Must be a valid MCP tool name. */
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z][a-z0-9_-]*$/,
      "Skill name must be lowercase alphanumeric with underscores or hyphens, starting with a letter",
    ),

  /** Human-readable description shown to the LLM. */
  description: z.string().min(1).max(1000),

  /** JSON Schema for tool call arguments — validated at proxy before forwarding. */
  inputSchema: jsonSchemaSchema,

  /** Optional JSON Schema for the expected response — validated on response at proxy. */
  outputSchema: jsonSchemaSchema.optional(),

  /** How the platform executes this skill: "handler" runs JS inline, "agent" delegates to a bot. */
  executionMode: z.enum(["handler", "agent"]).optional(),

  /** JS function body for handler mode (max 50KB). */
  handlerCode: z.string().max(50000).optional(),

  /** Maximum retry attempts for transient failures (502/503). Default 2, max 5. */
  maxRetries: z.number().int().min(0).max(5).optional(),

  /** Call mode: "sync" (default) waits for response, "async" returns 202 + job polling. */
  callMode: z.enum(["sync", "async"]).optional(),
});

// ── Auth Configuration ──────────────────────────────────────────────────────

export const serviceCardAuthSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("api_key"),
    /** Header name for the API key. Defaults to "X-API-Key". */
    headerName: z.string().min(1).max(100).default("X-API-Key"),
  }),
  z.object({
    type: z.literal("bearer"),
    /** Header name for the bearer token. Defaults to "Authorization". */
    headerName: z.string().min(1).max(100).default("Authorization"),
  }),
  z.object({
    type: z.literal("oauth2_client_credentials"),
    /** OAuth2 token endpoint URL. */
    tokenEndpoint: z.string().url(),
    /** OAuth2 scopes to request. */
    scopes: z.array(z.string().min(1).max(200)).default([]),
  }),
]);

// ── Rate Limits ─────────────────────────────────────────────────────────────

export const serviceCardRateLimitsSchema = z.object({
  /** Max requests per minute the creator's API accepts. */
  requestsPerMinute: z.number().int().positive().max(10_000).optional(),
  /** Max requests per day the creator's API accepts. */
  requestsPerDay: z.number().int().positive().max(1_000_000).optional(),
});

// ── ServiceCard (top-level) ─────────────────────────────────────────────────

export const serviceCardSchema = z.object({
  /** Creator's API base URL (HTTPS required in production). Optional for platform-managed services. */
  endpoint: z.string().url().refine(
    (url) => validateExternalUrl(url),
    "Endpoint must be a public URL (private IPs, localhost, and cloud metadata endpoints are blocked)",
  ).optional(),

  /** Health check endpoint. Jarble polls this every 5min. Falls back to `{endpoint}/health`. */
  healthEndpoint: z.string().url().refine(
    (url) => validateExternalUrl(url),
    "Health endpoint must be a public URL (private IPs, localhost, and cloud metadata endpoints are blocked)",
  ).optional(),

  /** Auth configuration that the creator's API expects from the Jarble proxy. */
  auth: serviceCardAuthSchema,

  /** Skills (MCP-compatible tool definitions) the service exposes. At least one required. */
  skills: z.array(serviceCardSkillSchema).min(1).max(50),

  /** Rate limits the creator enforces. */
  rateLimits: serviceCardRateLimitsSchema.optional(),

  /** Custom proxy timeout in milliseconds. Capped at 120000 (2 min) server-side.
   *  Useful for AI inference skills that need longer than the default 30s. */
  timeoutMs: z.number().int().positive().max(120_000).optional(),

  /** Service card version (semver). */
  version: z
    .string()
    .regex(
      /^\d+\.\d+\.\d+$/,
      "Version must be semver format (e.g. 1.0.0)",
    ),

  /** For platform-managed services: links to the creator's deployment for skill execution. */
  creatorDeploymentId: z.string().optional(),

  /** Heartbeat interval in ms (creator pushes heartbeats at this rate). Max 10 minutes. */
  heartbeatIntervalMs: z.number().int().positive().max(600_000).optional(),

  /** HMAC secret for heartbeat signature verification. Min 16, max 128 chars. */
  heartbeatSecret: z.string().min(16).max(128).optional(),
});

// ── Exported Types ──────────────────────────────────────────────────────────

export type ServiceCard = z.infer<typeof serviceCardSchema>;
export type ServiceCardSkill = z.infer<typeof serviceCardSkillSchema>;
export type ServiceCardAuth = z.infer<typeof serviceCardAuthSchema>;
export type ServiceCardRateLimits = z.infer<typeof serviceCardRateLimitsSchema>;

/** A ServiceCard that is guaranteed to have a creatorDeploymentId (platform-managed). */
export type PlatformServiceCard = ServiceCard & { creatorDeploymentId: string; };

// ── Backward-compatible aliases ─────────────────────────────────────────────
// Keep old names available for any code that hasn't been updated yet.
/** @deprecated Use serviceCardSchema */
export const packageCardSchema = serviceCardSchema;
/** @deprecated Use serviceCardSkillSchema */
export const packageCardSkillSchema = serviceCardSkillSchema;
/** @deprecated Use serviceCardAuthSchema */
export const packageCardAuthSchema = serviceCardAuthSchema;
/** @deprecated Use serviceCardRateLimitsSchema */
export const packageCardRateLimitsSchema = serviceCardRateLimitsSchema;
/** @deprecated Use ServiceCard */
export type PackageCard = ServiceCard;
/** @deprecated Use ServiceCardSkill */
export type PackageCardSkill = ServiceCardSkill;
/** @deprecated Use ServiceCardAuth */
export type PackageCardAuth = ServiceCardAuth;
/** @deprecated Use ServiceCardRateLimits */
export type PackageCardRateLimits = ServiceCardRateLimits;
