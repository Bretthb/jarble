"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Server } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface StepNameProps {
  name: string;
  setName: (name: string) => void;
}

function ServerSlots() {
  const { data } = trpc.deployment.getCapacity.useQuery(undefined, {
    refetchInterval: 30000,
  });

  if (!data || data.maxManagedNodes === 0) return null;

  const used = data.managedNodes;
  const total = data.maxManagedNodes;
  const available = Math.max(0, total - used);

  const color = available === 0
    ? "text-red-400"
    : available === 1
      ? "text-yellow-400"
      : "text-emerald-400";

  const bgColor = available === 0
    ? "bg-red-500/10 border-red-500/20"
    : available === 1
      ? "bg-yellow-500/10 border-yellow-500/20"
      : "bg-emerald-500/10 border-emerald-500/20";

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${bgColor}`}>
      <div className="flex gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <Server
            key={i}
            className={`w-4 h-4 ${i < used ? "text-muted-foreground/40" : color}`}
            fill={i < used ? "currentColor" : "none"}
            strokeWidth={i < used ? 1.5 : 2}
          />
        ))}
      </div>
      <span className={`text-sm font-medium ${color}`}>
        {available === 0
          ? "All server slots in use - stop a deployment to free a slot"
          : `${available} of ${total} server slots available`}
      </span>
    </div>
  );
}

export default function StepName({ name, setName }: StepNameProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Name Your Deployment</h2>
        <p className="text-muted-foreground">
          Give your AI deployment a name
        </p>
      </div>
      <ServerSlots />
      <div>
        <Label htmlFor="deploymentName" className="mb-2 block">
          Deployment Name
        </Label>
        <Input
          id="deploymentName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-secondary/50 border-border text-foreground text-lg py-6 rounded-lg"
          placeholder="My Deployment"
          autoFocus
        />
        <p className="text-xs text-muted-foreground mt-2">
          This is how your deployment will be identified. You can change it
          later.
        </p>
      </div>
      {name.trim().length >= 2 && (
        <div className="flex items-center gap-2 text-primary text-sm">
          <CheckCircle2 className="w-4 h-4" />
          Great name!
        </div>
      )}
    </div>
  );
}
