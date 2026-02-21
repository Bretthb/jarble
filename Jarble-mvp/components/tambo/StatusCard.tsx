"use client";

import { StatusBadge } from "@/components/StatusBadge";
import { Bot, Cpu, HardDrive, Link2 } from "lucide-react";

interface StatusCardProps {
  name: string;
  status: string;
  runtime: string;
  llmProvider: string;
  llmModel: string;
  platforms: string[];
  storageUsedGb?: number;
  storageAllocatedGb?: number;
}

export default function StatusCard({
  name,
  status,
  runtime,
  llmProvider,
  llmModel,
  platforms,
  storageUsedGb,
  storageAllocatedGb,
}: StatusCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Bot className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-base">{name}</h3>
            <p className="text-xs text-muted-foreground">{runtime}</p>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-secondary/50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
            LLM
          </p>
          <p className="text-sm font-medium truncate">
            {llmProvider} / {llmModel}
          </p>
        </div>

        <div className="rounded-lg bg-secondary/50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
            Platforms
          </p>
          <div className="flex items-center gap-1.5">
            {platforms.length > 0 ? (
              platforms.map((p) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium"
                >
                  <Link2 className="w-3 h-3" />
                  {p}
                </span>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">None</span>
            )}
          </div>
        </div>
      </div>

      {/* Storage */}
      {storageUsedGb != null && storageAllocatedGb != null && storageAllocatedGb > 0 && (
        <div className="rounded-lg bg-secondary/50 px-3 py-2">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <HardDrive className="w-3 h-3" /> Storage
            </p>
            <p className="text-xs text-muted-foreground">
              {storageUsedGb.toFixed(1)} / {storageAllocatedGb} GB
            </p>
          </div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{
                width: `${Math.min(100, (storageUsedGb / storageAllocatedGb) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
