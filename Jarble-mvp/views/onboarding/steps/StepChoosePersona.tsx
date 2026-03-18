"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, Loader2, ChevronRight, Eye } from "lucide-react";

// Category display config
const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "general", label: "General" },
  { id: "business", label: "Business" },
  { id: "technical", label: "Technical" },
  { id: "creative", label: "Creative" },
  { id: "education", label: "Education" },
] as const;

export interface PersonaTemplate {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string | null;
  systemPrompt: string;
  recommendedTools: string[];
  defaultTheme: { preset?: string; skin?: string } | null;
  suggestedLlm: string | null;
  icon: string | null;
  exampleConversation: unknown[];
  showcasePrompts: string[];
  sortOrder: number;
}

interface StepChoosePersonaProps {
  selectedPersonaId: string | null;
  onSelect: (persona: PersonaTemplate | null) => void;
  onSkip: () => void;
}

export default function StepChoosePersona({
  selectedPersonaId,
  onSelect,
  onSkip,
}: StepChoosePersonaProps) {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [previewId, setPreviewId] = useState<string | null>(null);

  const personasQuery = trpc.template.list.useQuery();
  const personas = (personasQuery.data ?? []) as PersonaTemplate[];

  const filtered =
    activeCategory === "all"
      ? personas
      : personas.filter((p) => p.category === activeCategory);

  const previewPersona = previewId
    ? personas.find((p) => p.id === previewId)
    : null;

  if (personasQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Choose a Persona</h2>
        <p className="text-muted-foreground">
          Pick a pre-configured personality for your bot, or skip to use a
          blank slate.
        </p>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => {
          const count =
            cat.id === "all"
              ? personas.length
              : personas.filter((p) => p.category === cat.id).length;
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {cat.label}
              <span className="ml-1 opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Persona grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((persona) => {
          const isSelected = selectedPersonaId === persona.id;
          return (
            <button
              key={persona.id}
              onClick={() => onSelect(isSelected ? null : persona)}
              className={`relative text-left p-4 rounded-xl border-2 transition-all group ${
                isSelected
                  ? "border-primary bg-primary/10 shadow-sm"
                  : "border-border hover:border-primary/50 bg-secondary/30 hover:bg-secondary/40"
              }`}
            >
              {/* Preview button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setPreviewId(previewId === persona.id ? null : persona.id);
                }}
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-background/80 border border-border/50 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-background"
                title="Preview persona"
              >
                <Eye className="w-3.5 h-3.5 text-muted-foreground" />
              </button>

              <div className="flex items-start gap-3">
                <span className="text-2xl shrink-0 mt-0.5" role="img">
                  {persona.icon || "\u{1F916}"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm truncate">
                      {persona.name}
                    </h3>
                    {isSelected && (
                      <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {persona.description}
                  </p>
                  <span className="inline-block mt-2 px-2 py-0.5 rounded-full bg-secondary/60 text-[10px] font-medium text-muted-foreground capitalize">
                    {persona.category}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Preview popover (shown below the grid when a persona is being previewed) */}
      {previewPersona && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3">
            <span className="text-3xl" role="img">
              {previewPersona.icon || "\u{1F916}"}
            </span>
            <div>
              <h3 className="font-semibold text-lg">{previewPersona.name}</h3>
              <p className="text-sm text-muted-foreground">
                {previewPersona.description}
              </p>
            </div>
          </div>

          {/* System prompt excerpt */}
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              System Prompt
            </h4>
            <p className="text-sm text-foreground/80 bg-secondary/50 rounded-lg p-3 leading-relaxed">
              {previewPersona.systemPrompt.length > 300
                ? previewPersona.systemPrompt.slice(0, 300) + "..."
                : previewPersona.systemPrompt}
            </p>
          </div>

          {/* Showcase prompts */}
          {previewPersona.showcasePrompts.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                Example Prompts
              </h4>
              <div className="space-y-1.5">
                {previewPersona.showcasePrompts.map((prompt, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-sm text-foreground/70"
                  >
                    <ChevronRight className="w-3 h-3 text-primary shrink-0" />
                    <span>{prompt}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Suggested LLM + theme */}
          <div className="flex flex-wrap gap-3 text-xs">
            {previewPersona.suggestedLlm && (
              <span className="px-2.5 py-1 rounded-full bg-secondary/60 text-muted-foreground">
                Suggested: {previewPersona.suggestedLlm.split("/").pop()}
              </span>
            )}
            {previewPersona.defaultTheme?.skin && (
              <span className="px-2.5 py-1 rounded-full bg-secondary/60 text-muted-foreground">
                Theme: {previewPersona.defaultTheme.skin}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Skip option */}
      <div className="flex items-center justify-center pt-2">
        <button
          onClick={onSkip}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip — start with a blank slate
        </button>
      </div>
    </div>
  );
}
