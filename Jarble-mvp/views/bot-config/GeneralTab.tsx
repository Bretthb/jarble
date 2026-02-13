import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TabProps } from "./types";

export function GeneralTab({ formData, updateFormData }: TabProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">General Settings</h2>
        <p className="text-muted-foreground text-sm">Basic information about your bot</p>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="name" className="mb-2 block">Bot Name</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => updateFormData("name", e.target.value)}
            className="bg-secondary/80 border-border text-foreground"
            placeholder="My Awesome Bot"
          />
        </div>

        <div>
          <Label htmlFor="description" className="mb-2 block">Description</Label>
          <textarea
            id="description"
            value={formData.description}
            onChange={(e) => updateFormData("description", e.target.value)}
            className="w-full min-h-[100px] px-3 py-2 bg-secondary/80 border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            placeholder="Describe what your bot does..."
          />
        </div>

        <div>
          <Label htmlFor="systemPrompt" className="mb-2 block">System Prompt</Label>
          <textarea
            id="systemPrompt"
            value={formData.systemPrompt}
            onChange={(e) => updateFormData("systemPrompt", e.target.value)}
            className="w-full min-h-[150px] px-3 py-2 bg-secondary/80 border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent font-mono text-sm"
            placeholder="You are a helpful assistant..."
          />
          <p className="text-xs text-muted-foreground mt-2">
            This prompt defines your bot's personality and behavior. Be specific about how it should respond.
          </p>
        </div>
      </div>
    </div>
  );
}
