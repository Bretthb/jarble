"use client";

import { cn } from "@/lib/utils";

export interface LeaderboardEntry {
  id: string;
  name: string;
  description?: string | null;
  score: number;
  ratingCount?: number;
}

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  metric: string;
  className?: string;
}

function getRankStyle(rank: number): string {
  switch (rank) {
    case 1:
      return "text-amber-400 font-bold";
    case 2:
      return "text-slate-300 font-semibold";
    case 3:
      return "text-amber-600 font-semibold";
    default:
      return "text-muted-foreground font-medium";
  }
}

function getScoreBarWidth(score: number, maxScore: number): string {
  if (maxScore <= 0) return "0%";
  return `${Math.min(100, (score / maxScore) * 100)}%`;
}

export function LeaderboardTable({
  entries,
  metric,
  className,
}: LeaderboardTableProps) {
  const maxScore = entries.length > 0 ? Math.max(...entries.map((e) => e.score)) : 100;

  if (entries.length === 0) {
    return (
      <div className={cn("text-sm text-muted-foreground text-center py-8", className)}>
        No leaderboard data available yet.
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {/* Header */}
      <div className="grid grid-cols-[2.5rem_1fr_6rem_4rem] gap-2 text-xs text-muted-foreground px-3 pb-1 border-b border-border">
        <span>Rank</span>
        <span>Name</span>
        <span className="text-right capitalize">{metric}</span>
        <span className="text-right">Ratings</span>
      </div>

      {/* Entries */}
      {entries.map((entry, index) => {
        const rank = index + 1;
        return (
          <div
            key={entry.id}
            className="grid grid-cols-[2.5rem_1fr_6rem_4rem] gap-2 items-center px-3 py-2 rounded-lg hover:bg-accent/50 transition-colors"
          >
            {/* Rank */}
            <span className={cn("text-sm", getRankStyle(rank))}>
              #{rank}
            </span>

            {/* Name + description */}
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {entry.name}
              </p>
              {entry.description && (
                <p className="text-xs text-muted-foreground truncate">
                  {entry.description}
                </p>
              )}
            </div>

            {/* Score with bar */}
            <div className="flex flex-col items-end gap-1">
              <span className="text-sm font-semibold text-foreground tabular-nums">
                {entry.score.toFixed(1)}
              </span>
              <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: getScoreBarWidth(entry.score, maxScore) }}
                />
              </div>
            </div>

            {/* Rating count */}
            <span className="text-xs text-muted-foreground text-right tabular-nums">
              {entry.ratingCount ?? 0}
            </span>
          </div>
        );
      })}
    </div>
  );
}
