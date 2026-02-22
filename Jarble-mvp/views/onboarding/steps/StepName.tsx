"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2 } from "lucide-react";

interface StepNameProps {
  name: string;
  setName: (name: string) => void;
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
