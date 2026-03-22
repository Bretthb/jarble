/**
 * Marketplace Types — Shared TypeScript types for the component marketplace.
 *
 * These types define the shape of marketplace component packages: manifests,
 * template layouts, and category constants. Used by the manifest validator,
 * configSync marketplace extension, and future marketplace API routes.
 */

// Re-export ServiceCard schemas and types from the dedicated module
export {
  serviceCardSchema,
  serviceCardSkillSchema,
  serviceCardAuthSchema,
  serviceCardRateLimitsSchema,
} from "./serviceCard.js";
export type {
  ServiceCard,
  ServiceCardSkill,
  ServiceCardAuth,
  ServiceCardRateLimits,
} from "./serviceCard.js";

// ── Categories ──────────────────────────────────────────────────────────────

export const MARKETPLACE_CATEGORIES = [
  "dashboard",
  "chart",
  "form",
  "media",
  "utility",
  "game",
  "visualization",
  "layout",
  "social",
] as const;

export type MarketplaceCategory = (typeof MARKETPLACE_CATEGORIES)[number];

