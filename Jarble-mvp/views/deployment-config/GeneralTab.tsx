import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TabProps } from "./types";

export function GeneralTab({ formData, updateFormData }: TabProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">General Settings</h2>
        <p className="text-muted-foreground text-sm">Basic information about your deployment</p>
      </div>

      <div className="space-y-5 bg-secondary/20 border border-border/40 p-5 rounded-lg">
        <div>
          <Label htmlFor="name" className="mb-2 block">Deployment Name</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => updateFormData("name", e.target.value)}
            className="bg-secondary/50 border-border text-foreground"
            placeholder="My Deployment"
          />
        </div>

        <div>
          <Label htmlFor="description" className="mb-2 block">Description</Label>
          <textarea
            id="description"
            value={formData.description}
            onChange={(e) => updateFormData("description", e.target.value)}
            className="w-full min-h-[100px] px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            placeholder="Describe what your deployment does..."
          />
        </div>

        <div>
          <Label htmlFor="systemPrompt" className="mb-2 block font-mono">soul.md</Label>
          <textarea
            id="systemPrompt"
            value={formData.systemPrompt}
            onChange={(e) => updateFormData("systemPrompt", e.target.value)}
            className="w-full min-h-[150px] px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent font-mono text-sm"
            placeholder="You are a helpful assistant..."
          />
          <p className="text-xs text-muted-foreground mt-2">
            The soul file defines your bot's personality and behavior. This syncs to <code className="bg-secondary px-1 rounded">/data/config/soul.md</code> on the pod.
          </p>
        </div>
      </div>
    </div>
  );
}
