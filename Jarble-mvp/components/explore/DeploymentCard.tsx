"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StarRating } from "@/components/marketplace/StarRating";
import { GitFork, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export interface DeploymentCardData {
  id: string;
  name: string;
  description?: string | null;
  specialties?: string[];
  forkCount?: number;
  overallScore?: number;
  ratingCount?: number;
}

interface DeploymentCardProps {
  deployment: DeploymentCardData;
  className?: string;
}

export function DeploymentCard({ deployment, className }: DeploymentCardProps) {
  const forkMutation = trpc.deployment.fork.useMutation({
    onSuccess: () => {
      toast.success(`Forked "${deployment.name}" successfully`);
    },
    onError: (error: { message?: string }) => {
      toast.error(error?.message || "Failed to fork deployment");
    },
  });

  // Convert overallScore (0-100) to a 1-5 star scale
  const starRating = deployment.overallScore
    ? (deployment.overallScore / 100) * 5
    : 0;

  return (
    <Card
      className={cn(
        "border border-border bg-card hover:border-primary/30 hover:shadow-md transition-all duration-200 h-full",
        className
      )}
    >
      <CardContent className="pt-5 pb-4 space-y-3">
        {/* Name */}
        <h3 className="font-semibold text-foreground leading-snug truncate">
          {deployment.name}
        </h3>

        {/* Description */}
        <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed min-h-[2.5rem]">
          {deployment.description || "No description"}
        </p>

        {/* Specialties */}
        {deployment.specialties && deployment.specialties.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {deployment.specialties.slice(0, 3).map((specialty) => (
              <Badge
                key={specialty}
                variant="secondary"
                className="text-[11px]"
              >
                {specialty}
              </Badge>
            ))}
            {deployment.specialties.length > 3 && (
              <span className="text-[11px] text-muted-foreground">
                +{deployment.specialties.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Rating + Fork count */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-3">
            <StarRating
              rating={starRating}
              count={deployment.ratingCount ?? 0}
            />
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <GitFork className="size-3" />
              {deployment.forkCount ?? 0}
            </span>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            disabled={forkMutation.isPending}
            onClick={() => forkMutation.mutate({ id: deployment.id })}
          >
            {forkMutation.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <GitFork className="size-3" />
            )}
            Fork
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
