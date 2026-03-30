"use client";

import Image from "next/image";
import {
  CheckCircle2,
  Loader2,
  HelpCircle,
  Cpu,
  HardDrive,
  MemoryStick,
} from "lucide-react";
import type { RuntimeEntry } from "../types";

const RUNTIME_LOGOS: Record<string, string> = {
  openclaw: "/openclaw-logo.svg",
  zeroclaw: "/zeroclaw.png",
};

interface StepChooseRuntimeProps {
  runtimes: RuntimeEntry[];
  isLoading: boolean;
  isError?: boolean;
  onRetry?: () => void;
  selectedId: number | null;
  onSelect: (id: number, slug: string) => void;
}

export default function StepChooseRuntime({
  runtimes,
  isLoading,
  isError,
  onRetry,
  selectedId,
  onSelect,
}: StepChooseRuntimeProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground mb-3">Failed to load available runtimes</p>
        {onRetry && (
          <button onClick={onRetry} className="text-sm text-primary hover:underline">
            Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Choose Runtime</h2>
        <p className="text-muted-foreground">
          Select a runtime for your deployment. The remaining setup steps will
          adapt to your choice.
        </p>
      </div>

      <div className="grid gap-4">
        {runtimes.map((runtime) => {
          const isSelected = selectedId === runtime.id;
          return (
            <button
              key={runtime.id}
              onClick={() => onSelect(runtime.id, runtime.slug)}
              className={`w-full text-left p-6 rounded-xl border-2 transition-all ${
                isSelected
                  ? "border-primary bg-primary/10 shadow-sm"
                  : "border-border hover:border-primary/50 bg-secondary/30 hover:bg-secondary/40"
              }`}
            >
              <div className="flex items-center gap-4">
                <Image
                  src={RUNTIME_LOGOS[runtime.slug] ?? "/openclaw-logo.svg"}
                  alt={`${runtime.name} logo`}
                  width={64}
                  height={64}
                  className="w-16 h-16 rounded-xl"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-lg">{runtime.name}</h3>
                    {runtime.monthlyPriceCents > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-xs font-medium">
                        ${(runtime.monthlyPriceCents / 100).toFixed(0)}/mo
                      </span>
                    )}
                    {isSelected && (
                      <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                        Selected
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {runtime.description}
                  </p>
                </div>
                {isSelected && (
                  <CheckCircle2 className="w-6 h-6 text-primary shrink-0" />
                )}
              </div>

              {/* Hardware specs */}
              <div className="mt-4 flex flex-wrap gap-3">
                <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-secondary/60 text-muted-foreground">
                  <Cpu className="w-3 h-3" /> {runtime.cpuLimit} vCPU
                </span>
                <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-secondary/60 text-muted-foreground">
                  <MemoryStick className="w-3 h-3" /> {runtime.memoryMb >= 1024 ? `${runtime.memoryMb / 1024} GB` : `${runtime.memoryMb} MB`} RAM
                </span>
                <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-secondary/60 text-muted-foreground">
                  <HardDrive className="w-3 h-3" /> {runtime.storageMb} GB
                  Storage
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-start gap-3 p-4 rounded-lg bg-secondary/50 border border-border">
        <HelpCircle className="w-5 h-5 text-muted-foreground mt-0.5" />
        <p className="text-sm text-muted-foreground">
          More runtimes coming soon! After launch, you&apos;ll be able to choose
          from additional runtimes with different capabilities and hardware
          configurations.
        </p>
      </div>
    </div>
  );
}
