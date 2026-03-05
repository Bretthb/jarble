/**
 * PackageCard — Structured descriptor for remote/hybrid marketplace packages.
 *
 * When a creator publishes a remote package, they provide a PackageCard that
 * describes their API endpoint, authentication requirements, exposed skills
 * (MCP-compatible tool definitions), and rate limits. Stored as JSON in
 * `marketplacePackages.remoteApiConfig`.
 *
 * Inspired by:
 * - A2A Agent Card (`/.well-known/agent.json`)
 * - MCP Registry `server.json`
 * - Shopify App Proxy descriptors
 *
 * Uses Zod v3 (API package).
 */

import { z } from "zod";

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

export const packageCardSkillSchema = z.object({
  /** Skill tool name, e.g. "get_weather". Must be a valid MCP tool name. */
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "Skill name must be lowercase alphanumeric with underscores, starting with a letter",
    ),

  /** Human-readable description shown to the LLM. */
  description: z.string().min(1).max(1000),

  /** JSON Schema for tool call arguments — validated at proxy before forwarding. */
  inputSchema: jsonSchemaSchema,

  /** Optional JSON Schema for the expected response — validated on response at proxy. */
  outputSchema: jsonSchemaSchema.optional(),
});

// ── Auth Configuration ──────────────────────────────────────────────────────

export const packageCardAuthSchema = z.discriminatedUnion("type", [
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

export const packageCardRateLimitsSchema = z.object({
  /** Max requests per minute the creator's API accepts. */
  requestsPerMinute: z.number().int().positive().max(10_000).optional(),
  /** Max requests per day the creator's API accepts. */
  requestsPerDay: z.number().int().positive().max(1_000_000).optional(),
});

// ── PackageCard (top-level) ─────────────────────────────────────────────────

export const packageCardSchema = z.object({
  /** Creator's API base URL (HTTPS required in production). */
  endpoint: z.string().url(),

  /** Health check endpoint. Jarble polls this every 5min. Falls back to `{endpoint}/health`. */
  healthEndpoint: z.string().url().optional(),

  /** Auth configuration that the creator's API expects from the Jarble proxy. */
  auth: packageCardAuthSchema,

  /** Skills (MCP-compatible tool definitions) the package exposes. At least one required. */
  skills: z.array(packageCardSkillSchema).min(1).max(50),

  /** Rate limits the creator enforces. */
  rateLimits: packageCardRateLimitsSchema.optional(),

  /** Package card version (semver). */
  version: z
    .string()
    .regex(
      /^\d+\.\d+\.\d+$/,
      "Version must be semver format (e.g. 1.0.0)",
    ),
});

// ── Exported Types ──────────────────────────────────────────────────────────

export type PackageCard = z.infer<typeof packageCardSchema>;
export type PackageCardSkill = z.infer<typeof packageCardSkillSchema>;
export type PackageCardAuth = z.infer<typeof packageCardAuthSchema>;
export type PackageCardRateLimits = z.infer<typeof packageCardRateLimitsSchema>;
