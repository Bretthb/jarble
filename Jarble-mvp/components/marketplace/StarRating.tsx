"use client";

import { cn } from "@/lib/utils";
import { Star } from "lucide-react";

interface StarRatingProps {
  rating: number;
  count?: number;
  size?: "sm" | "md";
  className?: string;
}

export function StarRating({ rating, count, size = "sm", className }: StarRatingProps) {
  const starSize = size === "sm" ? "size-3.5" : "size-4";

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 5 }, (_, i) => {
          const filled = rating - i;
          return (
            <Star
              key={i}
              className={cn(
                starSize,
                filled >= 1
                  ? "fill-amber-400 text-amber-400"
                  : filled >= 0.5
                    ? "fill-amber-400/50 text-amber-400"
                    : "fill-transparent text-muted-foreground/40"
              )}
            />
          );
        })}
      </div>
      {count !== undefined && (
        <span className="text-xs text-muted-foreground">({count})</span>
      )}
    </div>
  );
}
