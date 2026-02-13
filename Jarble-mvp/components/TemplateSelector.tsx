"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { 
  Sparkles, 
  Github, 
  Package, 
  CheckCircle2,
  ExternalLink,
  AlertCircle
} from "lucide-react";

export type TemplateSource = "jarble" | "github" | "aitmpl";

interface TemplateSelectorProps {
  selectedSource: TemplateSource;
  templateRef: string;
  onSourceChange: (source: TemplateSource) => void;
  onRefChange: (ref: string) => void;
}

const TEMPLATE_OPTIONS = [
  {
    id: "jarble" as TemplateSource,
    name: "Jarble Default",
    description: "Pre-configured bot template with best practices. Recommended for most users.",
    icon: <Sparkles className="w-6 h-6" />,
    recommended: true,
  },
  {
    id: "github" as TemplateSource,
    name: "GitHub Repository",
    description: "Import a custom bot configuration from a public or private GitHub repo.",
    icon: <Github className="w-6 h-6" />,
    recommended: false,
  },
  {
    id: "aitmpl" as TemplateSource,
    name: "Template Marketplace",
    description: "Browse community templates from aitmpl.com (coming soon).",
    icon: <Package className="w-6 h-6" />,
    recommended: false,
    disabled: true,
  },
];

export function TemplateSelector({
  selectedSource,
  templateRef,
  onSourceChange,
  onRefChange,
}: TemplateSelectorProps) {
  const [repoError, setRepoError] = useState<string | null>(null);

  const validateGitHubUrl = (url: string) => {
    if (!url) {
      setRepoError(null);
      return;
    }
    
    // Basic GitHub URL validation
    const githubRegex = /^https?:\/\/(www\.)?github\.com\/[\w-]+\/[\w.-]+\/?$/;
    if (!githubRegex.test(url)) {
      setRepoError("Please enter a valid GitHub repository URL");
    } else {
      setRepoError(null);
    }
  };

  const handleRefChange = (value: string) => {
    onRefChange(value);
    if (selectedSource === "github") {
      validateGitHubUrl(value);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Choose Your Template</h2>
        <p className="text-muted-foreground">
          Start with a pre-built template or bring your own configuration
        </p>
      </div>

      <div className="grid gap-4">
        {TEMPLATE_OPTIONS.map((option) => (
          <Card
            key={option.id}
            className={`
              p-4 cursor-pointer transition-all border-2
              ${option.disabled ? "opacity-50 cursor-not-allowed" : "hover:border-primary/50"}
              ${selectedSource === option.id ? "border-primary bg-primary/5" : "border-border"}
            `}
            onClick={() => !option.disabled && onSourceChange(option.id)}
          >
            <div className="flex items-start gap-4">
              <div className={`
                p-3 rounded-lg
                ${selectedSource === option.id ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}
              `}>
                {option.icon}
              </div>
              
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{option.name}</h3>
                  {option.recommended && (
                    <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                      Recommended
                    </span>
                  )}
                  {option.disabled && (
                    <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">
                      Coming Soon
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {option.description}
                </p>
              </div>

              {selectedSource === option.id && !option.disabled && (
                <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* GitHub URL Input */}
      {selectedSource === "github" && (
        <div className="space-y-3 pt-4 border-t border-border">
          <Label htmlFor="githubUrl">GitHub Repository URL</Label>
          <Input
            id="githubUrl"
            type="url"
            placeholder="https://github.com/username/repo"
            value={templateRef}
            onChange={(e) => handleRefChange(e.target.value)}
            className={repoError ? "border-destructive" : ""}
          />
          
          {repoError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {repoError}
            </p>
          )}
          
          <p className="text-xs text-muted-foreground">
            The repository should contain OpenClaw configuration files (SOUL.md, etc).{" "}
            <a
              href="https://docs.openclaw.ai/configuration"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-0.5"
            >
              Learn more <ExternalLink className="w-3 h-3" />
            </a>
          </p>

          <Card className="p-3 bg-secondary/50">
            <p className="text-xs text-muted-foreground">
              <strong>Private repos:</strong> You'll be prompted to authorize GitHub access during deployment.
            </p>
          </Card>
        </div>
      )}

      {/* Aitmpl Template Browser (placeholder) */}
      {selectedSource === "aitmpl" && (
        <div className="pt-4 border-t border-border">
          <Card className="p-8 text-center bg-secondary/30">
            <Package className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold mb-2">Template Marketplace Coming Soon</h3>
            <p className="text-sm text-muted-foreground">
              Browse and install community-created bot templates from aitmpl.com
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
