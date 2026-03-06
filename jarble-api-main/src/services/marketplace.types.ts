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
  // Backward-compatible aliases
  packageCardSchema,
  packageCardSkillSchema,
  packageCardAuthSchema,
  packageCardRateLimitsSchema,
} from "./serviceCard.js";
export type {
  ServiceCard,
  ServiceCardSkill,
  ServiceCardAuth,
  ServiceCardRateLimits,
  // Backward-compatible aliases
  PackageCard,
  PackageCardSkill,
  PackageCardAuth,
  PackageCardRateLimits,
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

// ── Manifest ────────────────────────────────────────────────────────────────

export interface MarketplaceManifest {
  name: string;
  displayName: string;
  description: string;
  version: string;
  tier: "template" | "sandbox";
  author?: { id: string; name: string; url?: string };
  category: string;
  tags?: string[];
  propsSchema?: Record<string, unknown>;
  exampleProps?: Record<string, unknown>;
  examplePrompts?: string[];
  botDescription?: string;
  pricingModel?: "free" | "one_time" | "subscription";
  priceUsdCents?: number;
  sandbox?: {
    entrypoint?: string;
    libraries?: string[];
    maxHeight?: number;
    permissions?: string[];
  };
}

// ── Template Layout ─────────────────────────────────────────────────────────

export interface TemplateLayout {
  name: string;
  description?: string;
  layout: Array<{
    component: string;
    props: Record<string, unknown>;
  }>;
}
