/**
 * Marketplace frontend types.
 *
 * These are used by the browse page, detail page, and shared components.
 * When the tRPC marketplace router is added to the API, these types should
 * be replaced by the inferred tRPC output types.
 */

export interface MarketplaceComponent {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  tier: "template" | "sandbox";
  category: string;
  tags: string[];
  installs: number;
  rating: number;
  reviewCount: number;
  pricingModel: "free" | "one_time" | "subscription";
  priceUsdCents: number;
  creatorId: string;
  creatorName: string;
  creatorBio?: string;
  creatorUrl?: string;
  propsSchema?: Record<string, unknown>;
  exampleProps?: Record<string, unknown>;
  examplePrompts?: string[];
  botDescription?: string;
  readme?: string;
  previewImageUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceReview {
  id: string;
  componentId: string;
  userId: string;
  userName: string;
  rating: number;
  title: string;
  body: string;
  createdAt: string;
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
  { value: "rating", label: "Highest Rated" },
  { value: "installs", label: "Most Installed" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
] as const;
