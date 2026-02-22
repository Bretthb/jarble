// Shared types for onboarding wizard step components

export type KeyValidationStatus = "idle" | "validating" | "valid" | "invalid";

export interface RuntimeEntry {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  cpuLimit: string;
  memoryMb: number;
  storageMb: number;
  monthlyPriceCents: number;
}
