"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { vanillaClient } from "@/lib/trpc-vanilla";

interface SystemPromptEditorProps {
  deploymentId: string;
  currentPrompt: string;
  suggestedPrompt?: string;
}

export default function SystemPromptEditor({
  deploymentId,
  currentPrompt,
  suggestedPrompt,
}: SystemPromptEditorProps) {
  const [prompt, setPrompt] = useState(suggestedPrompt || currentPrompt);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const promptValue = prompt ?? currentPrompt;
  const isDirty = promptValue !== currentPrompt;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await vanillaClient.deployment.update.mutate({
        id: deploymentId,
        systemPrompt: promptValue,
      });
      setSaved(true);
      toast.success("System prompt updated!");
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      toast.error("Failed to update system prompt");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">System Prompt</h4>
        {suggestedPrompt && suggestedPrompt !== currentPrompt && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
            Suggested
          </span>
        )}
      </div>
      <textarea
        value={promptValue}
        onChange={(e) => setPrompt(e.target.value)}
        rows={8}
        className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
        placeholder="You are a helpful assistant..."
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {promptValue.length} characters
        </p>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!isDirty || isSaving}
          className="h-8"
        >
          {isSaving ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : saved ? (
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
          ) : null}
          {saved ? "Saved" : "Save"}
        </Button>
      </div>
    </div>
  );
}
