/**
 * Marketplace frontend types.
 *
 * These types align with the tRPC marketplace router response shapes
 * defined in jarble-api-main/src/trpc/routers/marketplace.ts.
 */

/** Shape returned by marketplace.getById */
export interface MarketplaceComponent {
  id: string;
  name: string;
  displayName: string;
  description: string;
  tier: "template" | "sandbox";
  category: string;
  tags: string[];
  totalInstalls: number;
  averageRating: number;
  ratingCount: number;
  pricingModel: "free" | "one_time" | "subscription";
  priceUsdCents: number;
  creatorId: string;
  propsSchema?: string;
  exampleProps?: string | null;
  examplePrompts?: string[];
  botDescription?: string | null;
  status: string;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Nested creator profile from getById */
  creator: {
    id: string;
    displayName: string;
    bio?: string | null;
    websiteUrl?: string | null;
  } | null;
  /** Version history from getById */
  versions: Array<{
    id: string;
    version: string;
    changelog: string | null;
    createdAt: string;
  }>;
  /** Review summary from getById */
  reviewSummary: {
    averageRating: number;
    count: number;
    distribution: Record<number, number>;
  };
}

/** Shape of individual review items from marketplace.getReviews */
export interface MarketplaceReview {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  createdAt: Date | string;
  user: {
    id: string;
    name: string | null;
  } | null;
}

/** Full response from marketplace.getReviews */
export interface MarketplaceReviewsResponse {
  items: MarketplaceReview[];
  nextCursor: string | undefined;
  summary: {
    averageRating: number;
    count: number;
  };
}

export interface BrowseFilters {
  category: string;
  tier: string;
  pricing: string;
  sort: string;
  search: string;
}

export const MARKETPLACE_CATEGORIES = [
  "all",
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

export const SORT_OPTIONS = [
  { value: "popular", label: "Most Popular" },
  { value: "newest", label: "Newest" },
  { value: "top_rated", label: "Highest Rated" },
  { value: "trending", label: "Trending" },
] as const;
