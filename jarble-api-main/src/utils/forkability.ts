/**
 * Forkability Scoring Utility
 *
 * Computes a 0-100 score indicating how "forkable" (ready to clone) a deployment is,
 * based on completeness of its public profile and community ratings.
 */

export interface ForkabilityInput {
  isPublic: boolean;
  bio: string | null;
  specialties: string | null; // JSON array string
  showcasePrompts: string | null; // JSON array string
  featuredAt: Date | null;
  bestDomainScore?: {
    overallScore: number; // 100-500 scale (1-5 stars * 100)
    ratingCount: number;
    confidence: string; // "low" | "medium" | "high"
  } | null;
}

/** Safely parse a JSON string as an array, returning [] on failure */
function safeParseArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Compute a 0-100 forkability score for a deployment.
 *
 * Scoring criteria (total 100 points):
 *   - isPublic === true                                    → 15 pts
 *   - Has non-empty bio                                    → 10 pts
 *   - Has >= 1 showcase prompt                             → 10 pts
 *   - Has >= 2 specialties                                 → 15 pts
 *   - Rating count >= 10 with confidence "medium"|"high"   → 20 pts
 *   - Overall score >= 350 (3.5/5)                         → 20 pts
 *   - featuredAt is not null                               → 10 pts
 */
export function computeForkabilityScore(input: ForkabilityInput): number {
  let score = 0;

  // Public visibility (15 pts)
  if (input.isPublic) {
    score += 15;
  }

  // Non-empty bio (10 pts)
  if (input.bio && input.bio.trim().length > 0) {
    score += 10;
  }

  // At least 1 showcase prompt (10 pts)
  const prompts = safeParseArray(input.showcasePrompts);
  if (prompts.length >= 1) {
    score += 10;
  }

  // At least 2 specialties (15 pts)
  const specs = safeParseArray(input.specialties);
  if (specs.length >= 2) {
    score += 15;
  }

  // Rating count >= 10 with medium or high confidence (20 pts)
  if (
    input.bestDomainScore &&
    input.bestDomainScore.ratingCount >= 10 &&
    (input.bestDomainScore.confidence === "medium" ||
      input.bestDomainScore.confidence === "high")
  ) {
    score += 20;
  }

  // Overall score >= 350 (3.5/5 stars) (20 pts)
  if (input.bestDomainScore && input.bestDomainScore.overallScore >= 350) {
    score += 20;
  }

  // Featured (10 pts)
  if (input.featuredAt != null) {
    score += 10;
  }

  return Math.min(score, 100);
}
