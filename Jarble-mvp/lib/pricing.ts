/**
 * Hardware-based pricing calculator (mirrors jarble-api-main/src/utils/pricing.ts).
 *
 * Pricing table (per month):
 *   vCPU:    $10.00 per 1.0 vCPU
 *   RAM:     $2.50  per 1 GB
 *   Storage: $0.08  per 1 GB
 */

const CPU_CENTS_PER_UNIT = 1000;   // $10.00 per 1.0 vCPU
const RAM_CENTS_PER_GB = 250;      // $2.50 per GB
const STORAGE_CENTS_PER_GB = 8;    // $0.08 per GB

export function calculateMonthlyPriceCents(
  cpuLimit: string,
  memoryMb: number,
  storageMb: number,
): number {
  const cpu = parseFloat(cpuLimit) || 0;
  const ramGb = memoryMb / 1024;

  const cpuCents = cpu * CPU_CENTS_PER_UNIT;
  const ramCents = ramGb * RAM_CENTS_PER_GB;
  const storageCents = storageMb * STORAGE_CENTS_PER_GB;

  return Math.round(cpuCents + ramCents + storageCents);
}

export function formatPriceCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
