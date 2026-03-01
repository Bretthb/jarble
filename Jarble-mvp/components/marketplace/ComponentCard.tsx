"use client";

import Link from "next/link";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Download, User } from "lucide-react";
import { StarRating } from "./StarRating";
import { CategoryBadge } from "./CategoryBadge";
import { TierBadge } from "./TierBadge";

export interface MarketplaceComponentData {
  id: string;
  name: string;
  displayName: string;
  description: string;
  tier: "template" | "sandbox";
  category: string;
  installs: number;
  rating: number;
  reviewCount: number;
  pricingModel: "free" | "one_time" | "subscription";
  priceUsdCents: number;
  creatorName: string;
}

interface ComponentCardProps {
  component: MarketplaceComponentData;
  className?: string;
}

function formatInstalls(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
  }
  return count.toString();
}

function formatPrice(model: string, cents: number): string {
  if (model === "free" || cents === 0) return "Free";
  const dollars = cents / 100;
  const formatted = dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2);
  return `$${formatted}`;
}

export function ComponentCard({ component, className }: ComponentCardProps) {
  const price = formatPrice(component.pricingModel, component.priceUsdCents);

  return (
    <Link href={`/marketplace/${component.id}`} className="block group">
      <Card
        className={cn(
          "border border-border bg-card hover:border-primary/30 hover:shadow-md transition-all duration-200 h-full",
          className
        )}
      >
        <CardContent className="pt-5 pb-3 space-y-3">
          {/* Header: name + price */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-foreground leading-snug group-hover:text-primary transition-colors">
              {component.displayName}
            </h3>
            <span
              className={cn(
                "text-sm font-semibold shrink-0",
                price === "Free"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-foreground"
              )}
            >
              {price}
            </span>
          </div>

          {/* Description */}
          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
            {component.description}
          </p>

          {/* Badges */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <TierBadge tier={component.tier} />
            <CategoryBadge category={component.category} />
          </div>
        </CardContent>

        <CardFooter className="pt-0 pb-4 flex items-center justify-between text-xs text-muted-foreground">
          {/* Rating + installs */}
          <div className="flex items-center gap-3">
            <StarRating rating={component.rating} count={component.reviewCount} />
            <span className="flex items-center gap-1">
              <Download className="size-3" />
              {formatInstalls(component.installs)}
            </span>
          </div>

          {/* Creator */}
          <span className="flex items-center gap-1 truncate max-w-[120px]">
            <User className="size-3 shrink-0" />
            <span className="truncate">{component.creatorName}</span>
          </span>
        </CardFooter>
      </Card>
    </Link>
  );
}
