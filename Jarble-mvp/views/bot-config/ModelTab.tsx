import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TabProps } from "./types";

const PROVIDERS = [
  { id: "jarble", name: "Jarble Managed", description: "We handle everything" },
  { id: "anthropic", name: "Anthropic", description: "Claude models" },
  { id: "openai", name: "OpenAI", description: "GPT models" },
  { id: "google", name: "Google", description: "Gemini models" },
];

const MODELS: Record<string, { id: string; name: string }[]> = {
  jarble: [{ id: "auto", name: "Auto (Recommended)" }],
  anthropic: [
    { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
    { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
    { id: "claude-haiku", name: "Claude Haiku" },
  ],
  openai: [
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
    { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
  ],
  google: [
    { id: "gemini-2.0-pro", name: "Gemini 2.0 Pro" },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
  ],
};

export function ModelTab({ formData, updateFormData }: TabProps) {
  const showApiKey = formData.modelProvider && formData.modelProvider !== "jarble";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Model Configuration</h2>
        <p className="text-muted-foreground text-sm">Choose and configure your AI model</p>
      </div>

      <div className="space-y-4">
        <div>
          <Label className="mb-2 block">Provider</Label>
          <div className="grid grid-cols-2 gap-3">
            {PROVIDERS.map((provider) => (
              <button
                key={provider.id}
                onClick={() => {
                  updateFormData("modelProvider", provider.id);
                  updateFormData("modelName", MODELS[provider.id]?.[0]?.id || "");
                }}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  formData.modelProvider === provider.id
                    ? "border-primary bg-primary/10"
                    : "border-border bg-secondary/80/50 hover:border-border"
                }`}
              >
                <h3 className="font-semibold">{provider.name}</h3>
                <p className="text-sm text-muted-foreground">{provider.description}</p>
              </button>
            ))}
          </div>
        </div>

        {formData.modelProvider && (
          <div>
            <Label htmlFor="modelName" className="mb-2 block">Model</Label>
            <select
              id="modelName"
              value={formData.modelName}
              onChange={(e) => updateFormData("modelName", e.target.value)}
              className="w-full px-3 py-2 bg-secondary/80 border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {MODELS[formData.modelProvider]?.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {showApiKey && (
          <div>
            <Label htmlFor="apiKey" className="mb-2 block">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              value={formData.apiKey}
              onChange={(e) => updateFormData("apiKey", e.target.value)}
              className="bg-secondary/80 border-border text-foreground font-mono"
              placeholder="sk-..."
            />
            <p className="text-xs text-muted-foreground mt-2">
              Your API key is encrypted and stored securely.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="temperature" className="mb-2 block">
              Temperature: {formData.temperature}
            </Label>
            <input
              id="temperature"
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={formData.temperature}
              onChange={(e) => updateFormData("temperature", parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>Precise</span>
              <span>Creative</span>
            </div>
          </div>

          <div>
            <Label htmlFor="maxTokens" className="mb-2 block">Max Tokens</Label>
            <Input
              id="maxTokens"
              type="number"
              value={formData.maxTokens}
              onChange={(e) => updateFormData("maxTokens", parseInt(e.target.value))}
              className="bg-secondary/80 border-border text-foreground"
              min={256}
              max={8192}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
