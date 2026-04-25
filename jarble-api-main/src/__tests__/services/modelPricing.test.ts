/**
 * Unit tests for modelPricing.ts.
 *
 * The service is the single point of truth for "how much did this
 * delegation hop cost?" — its output flows directly into the
 * `creditsCharged` column on `agent_calls` and from there into the
 * billing dashboard. A regression here distorts every cost report
 * the platform produces.
 *
 * Two contracts to pin down:
 *
 *   1. `calculateHopCostCents` — pure math. Unit price × token count
 *      across input/output/cacheRead/cacheWrite, summed and rounded up
 *      to whole cents with a floor of 1c (the platform never charges
 *      0c for a real call). Most regressions here will be off-by-one
 *      cent rounding or forgetting one of the four token buckets.
 *
 *   2. `getModelPricing` — fallback resolution chain. Network is
 *      best-effort; the function MUST return usable pricing even when
 *      OpenRouter is unreachable. The chain is:
 *         live cache (warm) → bulk fetch → fallback table → conservative
 *         default (Claude Sonnet pricing)
 *      We only exercise the offline branches here so the test does
 *      not depend on a live OpenRouter token. Network mocking is
 *      handled by `vi.stubGlobal("fetch", ...)`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Stub fetch BEFORE importing the SUT so the module-level `fetch`
// reference (only used inside bulkFetchPricing) sees the stub.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  getModelPricing,
  calculateHopCostCents,
} from "../../services/modelPricing.js";

beforeEach(() => {
  mockFetch.mockReset();
  // Force every test to take the no-key path so module-level cache
  // never bulk-fetches against a real network.
  delete process.env.OPENROUTER_API_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── calculateHopCostCents ───────────────────────────────────────────────────

describe("calculateHopCostCents", () => {
  // Pricing fixture ($3 prompt / $15 completion / $0.30 cache-read per 1M)
  const sonnet = {
    promptPricePerToken: 3 / 1_000_000,
    completionPricePerToken: 15 / 1_000_000,
    cachedReadPricePerToken: 0.3 / 1_000_000,
    fetchedAt: 0,
  };

  it("computes cost for a basic input/output split and rounds UP to whole cents", () => {
    // 1000 input × $3/M  = $0.003
    // 500  output × $15/M = $0.0075
    // total              = $0.0105 → 1.05c → ceil to 2c
    expect(calculateHopCostCents({ inputTokens: 1000, outputTokens: 500 }, sonnet)).toBe(2);
  });

  it("includes cacheReadTokens at the cached-read price", () => {
    // 0 input/output, 10_000 cacheRead × $0.3/M = $0.003 → 0.3c → ceil to 1c
    expect(
      calculateHopCostCents({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 10_000 }, sonnet),
    ).toBe(1);
  });

  it("charges cacheWriteTokens at the full prompt price (Anthropic semantics)", () => {
    // 100_000 cacheWrite × $3/M = $0.30 → 30c
    expect(
      calculateHopCostCents({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 100_000 }, sonnet),
    ).toBe(30);
  });

  it("treats undefined cacheRead/cacheWrite as zero", () => {
    // Same as the basic input/output test above. Missing cache fields
    // must NOT default to a positive contribution.
    expect(calculateHopCostCents({ inputTokens: 1000, outputTokens: 500 }, sonnet)).toBe(2);
  });

  it("enforces a 1-cent floor — never charges 0 for a real call", () => {
    // 1 input token, 1 output token → fractions of a cent, but the
    // platform should still bill 1c so cost-reporting can attribute
    // the call. (Otherwise free-tier abuse would be a $0 audit trail.)
    expect(calculateHopCostCents({ inputTokens: 1, outputTokens: 1 }, sonnet)).toBe(1);
    expect(calculateHopCostCents({ inputTokens: 0, outputTokens: 0 }, sonnet)).toBe(1);
  });

  it("rounds up — even a fraction-of-a-cent overage costs the next whole cent", () => {
    // 1100 input × $3/M = $0.0033 → 0.33c → ceil to 1c
    // 1200 input × $3/M = $0.0036 → 0.36c → ceil to 1c
    // 1   output × $15/M = $0.000015 → adds nothing
    expect(calculateHopCostCents({ inputTokens: 1100, outputTokens: 0 }, sonnet)).toBe(1);
    // 4000 input × $3/M = $0.012 → 1.2c → ceil to 2c
    expect(calculateHopCostCents({ inputTokens: 4000, outputTokens: 0 }, sonnet)).toBe(2);
  });

  it("sums all four buckets correctly for a realistic delegation hop", () => {
    // Realistic Sonnet hop with cache:
    //   8000 input × $3/M    = $0.024
    //   2000 output × $15/M  = $0.030
    //   12000 cacheRead × $0.3/M = $0.0036
    //   500 cacheWrite × $3/M    = $0.0015
    //   sum                  = $0.0591 → 5.91c → ceil to 6c
    expect(
      calculateHopCostCents(
        { inputTokens: 8000, outputTokens: 2000, cacheReadTokens: 12_000, cacheWriteTokens: 500 },
        sonnet,
      ),
    ).toBe(6);
  });

  it("scales linearly with token count", () => {
    const a = calculateHopCostCents({ inputTokens: 100_000, outputTokens: 0 }, sonnet);
    const b = calculateHopCostCents({ inputTokens: 200_000, outputTokens: 0 }, sonnet);
    // 100k → $0.30 → 30c. 200k → $0.60 → 60c.
    expect(a).toBe(30);
    expect(b).toBe(60);
    expect(b).toBe(2 * a);
  });
});

// ── getModelPricing — fallback resolution ────────────────────────────────────

describe("getModelPricing fallback chain", () => {
  it("returns the hardcoded fallback for known fallback-table models when network is unavailable", async () => {
    // No OPENROUTER_API_KEY → bulkFetch is a no-op → must fall back.
    const pricing = await getModelPricing("anthropic/claude-sonnet-4");
    expect(pricing.promptPricePerToken).toBeCloseTo(3 / 1_000_000, 12);
    expect(pricing.completionPricePerToken).toBeCloseTo(15 / 1_000_000, 12);
  });

  it("normalizes a model id with a date suffix to its base form", () => {
    // OpenRouter often hands back "anthropic/claude-sonnet-4-20250514".
    // Pricing is keyed by the base model — the date suffix is stripped.
    // (Indirectly observable via the fact that we get sonnet-4 pricing,
    // not the conservative default.)
    return expect(
      getModelPricing("anthropic/claude-sonnet-4-20250514"),
    ).resolves.toMatchObject({
      promptPricePerToken: 3 / 1_000_000,
      completionPricePerToken: 15 / 1_000_000,
    });
  });

  it("returns conservative Sonnet-shaped pricing for an unknown model", async () => {
    // No fallback for "fictional/model-x" — the function must still
    // return something usable so billing doesn't NaN-out.
    const pricing = await getModelPricing("fictional/model-x");
    expect(pricing.promptPricePerToken).toBeGreaterThan(0);
    expect(pricing.completionPricePerToken).toBeGreaterThan(0);
    // Conservative default = Sonnet pricing.
    expect(pricing.promptPricePerToken).toBeCloseTo(3 / 1_000_000, 12);
  });

  it("returns Haiku pricing for the Haiku fallback entry", async () => {
    const pricing = await getModelPricing("anthropic/claude-haiku-4-5");
    // Haiku is significantly cheaper than Sonnet.
    expect(pricing.promptPricePerToken).toBeCloseTo(0.8 / 1_000_000, 12);
    expect(pricing.completionPricePerToken).toBeCloseTo(4 / 1_000_000, 12);
    expect(pricing.promptPricePerToken).toBeLessThan(3 / 1_000_000);
  });

  it("returns gpt-4o-mini pricing as another distinct fallback shape", async () => {
    const pricing = await getModelPricing("openai/gpt-4o-mini");
    expect(pricing.promptPricePerToken).toBeCloseTo(0.15 / 1_000_000, 12);
    expect(pricing.completionPricePerToken).toBeCloseTo(0.6 / 1_000_000, 12);
  });
});
