"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { vanillaClient } from "@/lib/trpc-vanilla";

interface Skill {
  id: string;
  name: string;
  description: string | null;
  installed: boolean;
}

interface SkillsPanelProps {
  deploymentId: string;
  availableSkills: Skill[];
}

export default function SkillsPanel({
  deploymentId,
  availableSkills,
}: SkillsPanelProps) {
  const [skills, setSkills] = useState<Skill[]>(availableSkills);
  const [toggling, setToggling] = useState<string | null>(null);

  const handleToggle = async (skill: Skill) => {
    setToggling(skill.id);
    try {
      if (skill.installed) {
        await vanillaClient.skills.uninstall.mutate({
          deploymentId,
          skillId: skill.id,
        });
        toast.success(`${skill.name} uninstalled`);
      } else {
        await vanillaClient.skills.install.mutate({
          deploymentId,
          skillId: skill.id,
        });
        toast.success(`${skill.name} installed`);
      }
      setSkills((prev) =>
        prev.map((s) =>
          s.id === skill.id ? { ...s, installed: !s.installed } : s
        )
      );
    } catch {
      toast.error(`Failed to ${skill.installed ? "uninstall" : "install"} ${skill.name}`);
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <h4 className="text-sm font-semibold">Skills</h4>
      </div>
      {skills.length === 0 ? (
        <p className="text-sm text-muted-foreground">No skills available.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {skills.map((skill) => (
            <button
              key={skill.id}
              onClick={() => handleToggle(skill)}
              disabled={toggling === skill.id}
              className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                skill.installed
                  ? "border-primary bg-primary/10"
                  : "border-border bg-secondary/30 hover:border-primary/50"
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{skill.name}</p>
                {skill.description && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                    {skill.description}
                  </p>
                )}
              </div>
              {toggling === skill.id ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
              ) : (
                <div
                  className={`w-8 h-5 rounded-full transition-colors relative shrink-0 ${
                    skill.installed ? "bg-primary" : "bg-secondary"
                  }`}
                >
                  <div
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      skill.installed ? "translate-x-3.5" : "translate-x-0.5"
                    }`}
                  />
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
