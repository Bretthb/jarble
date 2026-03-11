"use client";

import { memo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { X, ArrowLeft, Server, Loader2, Cloud } from "lucide-react";
import { HostedServiceSummaryCard } from "./HostedServiceSummaryCard";
import { HostedServiceDetail } from "./HostedServiceDetail";

interface HostedServicesPanelProps {
  deploymentId: string;
  onClose: () => void;
}

function HostedServicesPanelInner({ deploymentId, onClose }: HostedServicesPanelProps) {
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);

  const { data: services, isLoading } = trpc.services.listHostedByDeployment.useQuery(
    { deploymentId },
    { refetchInterval: 60_000 },
  );

  return (
    <div className="h-full w-[400px] shrink-0 border-r border-border/60 bg-background flex flex-col relative">
      {/* Left accent line */}
      <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-primary/40 via-primary/20 to-transparent" />

      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          {selectedServiceId ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedServiceId(null)}
              className="h-7 w-7 p-0 rounded-md hover:bg-secondary/80 transition-colors"
              aria-label="Back to list"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
          ) : (
            <Server className="w-4 h-4 text-primary/70" />
          )}
          <div>
            <span className="text-sm font-semibold text-foreground">
              {selectedServiceId ? "Service Details" : "Hosted Services"}
            </span>
            <p className="text-[10px] text-muted-foreground leading-tight">
              {selectedServiceId ? "Usage & installs" : "Services running on this deployment"}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-8 w-8 p-0 rounded-md hover:bg-secondary/80 transition-colors"
          aria-label="Close hosted services panel"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {selectedServiceId ? (
          <HostedServiceDetail serviceId={selectedServiceId} />
        ) : isLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : services && services.length > 0 ? (
          <div className="p-4 space-y-2">
            {services.map((svc) => (
              <HostedServiceSummaryCard
                key={svc.id}
                service={svc}
                onClick={() => setSelectedServiceId(svc.id)}
              />
            ))}
          </div>
        ) : (
          /* Empty state */
          <div className="flex flex-col items-center text-center px-6 pt-16 space-y-4">
            <div className="w-12 h-12 rounded-full bg-secondary/60 flex items-center justify-center">
              <Cloud className="w-6 h-6 text-muted-foreground/70" />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground/70">No hosted services</p>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-[260px]">
                When you publish a service with this deployment as its host, it will appear here with live stats and management controls.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(HostedServicesPanelInner);
