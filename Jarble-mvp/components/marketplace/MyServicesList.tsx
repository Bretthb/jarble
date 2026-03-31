"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Package, Puzzle, Wrench, Clock, Pencil, Eye, Send, Play, Loader2, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import DeploymentPicker from "@/components/marketplace/DeploymentPicker";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-gray-500/15 text-gray-700 dark:text-gray-400 border-gray-500/20" },
  pending_review: { label: "Pending Review", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20" },
  published: { label: "Published", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20" },
  rejected: { label: "Rejected", className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20" },
};

const HOSTING_LABELS: Record<string, string> = {
  self_hosted: "Self-hosted", remote: "Cloud", hybrid: "Hybrid",
};

interface MyService {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  hostingModel: string;
  status: string;
  pricingModel: string;
  componentCount: number;
  skillCount: number;
  testInstallCount: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export function MyServicesList() {
  const servicesQuery = trpc.services.listMyServices.useQuery({ status: undefined });
  const services: MyService[] | undefined = servicesQuery.data?.items;

  if (servicesQuery.isLoading) return <MyServicesGridSkeleton />;

  if (!services || services.length === 0) {
    return (
      <Empty className="py-20 border border-dashed border-border rounded-xl">
        <EmptyMedia variant="icon"><Package /></EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>No services yet</EmptyTitle>
          <EmptyDescription>
            You haven&apos;t created any services yet. Create your first service to get started.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {services.map((svc, i) => (
        <motion.div
          key={svc.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: i * 0.04 }}
        >
          <MyServiceCard service={svc} onMutate={() => servicesQuery.refetch()} />
        </motion.div>
      ))}
    </div>
  );
}

function MyServiceCard({ service, onMutate }: { service: MyService; onMutate: () => void }) {
  const statusCfg = STATUS_CONFIG[service.status] ?? STATUS_CONFIG.draft;
  const hostingLabel = HOSTING_LABELS[service.hostingModel] ?? service.hostingModel;

  return (
    <Card className="border border-border bg-card h-full flex flex-col">
      <CardContent className="pt-5 pb-4 space-y-3 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-foreground leading-snug">{service.displayName}</h3>
          <Badge variant="outline" className={cn("text-[11px] shrink-0", statusCfg.className)}>
            {statusCfg.label}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
          {service.description ?? "No description"}
        </p>
        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Package className="size-3" />{hostingLabel}</span>
          {service.componentCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Puzzle className="size-3" />{service.componentCount} component{service.componentCount !== 1 ? "s" : ""}
            </span>
          )}
          {service.skillCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Wrench className="size-3" />{service.skillCount} skill{service.skillCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex-1" />
        <ServiceActions service={service} onMutate={onMutate} />
      </CardContent>
    </Card>
  );
}

function ServiceActions({ service, onMutate }: { service: MyService; onMutate: () => void }) {
  const [showPicker, setShowPicker] = useState(false);
  const [deploymentId, setDeploymentId] = useState<string | null>(null);

  const testInstall = trpc.services.testInstall.useMutation({
    onSuccess: () => { setShowPicker(false); setDeploymentId(null); onMutate(); },
  });
  const submitForReview = trpc.services.submitForReview.useMutation({
    onSuccess: () => onMutate(),
  });

  if (service.status === "draft") {
    return (
      <div className="space-y-2 pt-1">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild className="flex-1">
            <Link href={`/marketplace/services/${service.id}/draft`}>
              <Pencil className="size-3.5 mr-1.5" />Edit
            </Link>
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowPicker((v) => !v)}>
            <Play className="size-3.5 mr-1.5" />Test Install
          </Button>
        </div>
        {showPicker && (
          <div className="space-y-2">
            <DeploymentPicker selectedId={deploymentId} onSelect={setDeploymentId} />
            <Button
              size="sm"
              className="w-full"
              disabled={!deploymentId || testInstall.isPending}
              onClick={() => deploymentId && testInstall.mutate({ serviceId: service.id, deploymentId })}
            >
              {testInstall.isPending
                ? <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                : <CheckCircle2 className="size-3.5 mr-1.5" />}
              Install to deployment
            </Button>
            {testInstall.error && <p className="text-xs text-destructive">{testInstall.error.message}</p>}
          </div>
        )}
        <Button
          variant="default"
          size="sm"
          className="w-full"
          disabled={submitForReview.isPending}
          onClick={() => submitForReview.mutate({ serviceId: service.id })}
        >
          {submitForReview.isPending
            ? <Loader2 className="size-3.5 mr-1.5 animate-spin" />
            : <Send className="size-3.5 mr-1.5" />}
          Submit for Review
        </Button>
        {submitForReview.error && <p className="text-xs text-destructive">{submitForReview.error.message}</p>}
      </div>
    );
  }

  if (service.status === "pending_review") {
    return (
      <div className="flex items-center gap-2 pt-1 text-sm text-amber-600 dark:text-amber-400">
        <Clock className="size-4" /><span>Waiting for review</span>
      </div>
    );
  }

  if (service.status === "published") {
    return (
      <div className="pt-1">
        <Button variant="outline" size="sm" asChild className="w-full">
          <Link href={`/marketplace/services/${service.id}`}>
            <Eye className="size-3.5 mr-1.5" />View in Marketplace
          </Link>
        </Button>
      </div>
    );
  }

  if (service.status === "rejected") {
    return (
      <div className="pt-1">
        <Button variant="outline" size="sm" asChild className="w-full">
          <Link href={`/marketplace/services/${service.id}/draft`}>
            <Pencil className="size-3.5 mr-1.5" />Edit &amp; Resubmit
          </Link>
        </Button>
      </div>
    );
  }

  // Default: treat unknown statuses (e.g. "submitted") as draft-like - show edit link
  return (
    <div className="pt-1">
      <Button variant="outline" size="sm" asChild className="w-full">
        <Link href={`/marketplace/services/${service.id}/draft`}>
          <Pencil className="size-3.5 mr-1.5" />View Details
        </Link>
      </Button>
    </div>
  );
}

function MyServicesGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-start justify-between">
            <Skeleton className="h-5 w-32" /><Skeleton className="h-5 w-16 rounded-md" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <div className="flex gap-2"><Skeleton className="h-4 w-20" /><Skeleton className="h-4 w-16" /></div>
          <div className="flex gap-2 pt-2"><Skeleton className="h-8 w-full rounded-md" /><Skeleton className="h-8 w-full rounded-md" /></div>
        </div>
      ))}
    </div>
  );
}
