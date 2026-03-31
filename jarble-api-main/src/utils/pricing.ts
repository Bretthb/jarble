/**
 * Hardware-based pricing calculator.
 *
 * Users build their own monthly subscription by choosing vCPU, RAM, and storage.
 * The monthly price is the sum of each resource's cost.
 *
 * Pricing table (per month):
 *   vCPU:    $10.00 per 1.0 vCPU
 *   RAM:     $2.50  per 1 GB
 *   Storage: $0.08  per 1 GB
 *
 * Note: storageMb is named historically - the value is actually in GB.
 */

// Prices in cents per unit
const CPU_CENTS_PER_UNIT = 1000;   // $10.00 per 1.0 vCPU
const RAM_CENTS_PER_GB = 250;      // $2.50 per GB
const STORAGE_CENTS_PER_GB = 8;    // $0.08 per GB

/**
 * Calculate the monthly price in cents for a deployment based on hardware specs.
 *
 * @param cpuLimit - vCPU count as string, e.g. "2.0", "0.5", "1"
 * @param memoryMb - RAM in megabytes, e.g. 2048
 * @param storageMb - Storage in GB (named "Mb" historically), e.g. 30
 * @returns Monthly price in cents (integer)
 */
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
