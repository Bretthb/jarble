// Shared types for onboarding wizard step components

export type KeyValidationStatus = "idle" | "validating" | "valid" | "invalid";

/**
 * Public shape returned by `runtimeCatalog.list` — matches `toPublicRuntime`
 * in `jarble-api-main/src/trpc/routers/runtimeCatalog.ts`. Internal fields
 * (dockerImage, cpuLimit, memoryMb, storageMb) are deliberately stripped
 * on the public endpoint and must not be re-added here without also
 * re-authenticating that endpoint.
 */
export interface RuntimeEntry {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  monthlyPriceCents: number;
}
