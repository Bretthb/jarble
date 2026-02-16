/**
 * ═══════════════════════════════════════════════════════════════════════
 * Wizard Step Config — Single source of truth for onboarding wizard steps
 * AND deployment config dashboard tabs
 * ═══════════════════════════════════════════════════════════════════════
 *
 * HOW THE WIZARD WORKS:
 *   The wizard always shows 2 universal steps first (Name + Choose Runtime).
 *   After the user picks a runtime, the remaining steps are looked up from
 *   RUNTIME_EXTRA_STEPS below. The progress bar, navigation, and step
 *   count all update automatically.
 *
 * HOW TO ADD A NEW RUNTIME'S STEPS:
 *   1. Add an entry to RUNTIME_EXTRA_STEPS with the runtime's slug as key
 *   2. List the step objects in order — each needs { id, title, icon }
 *   3. If any step ID is new (not "llm", "deploy", or "whatsapp"),
 *      go to OnboardingWizard.tsx and add a render block:
 *        {currentStepId === "yourid" && <YourStepComponent />}
 *   4. Optionally add a canProceed case in OnboardingWizard.tsx if the
 *      step needs validation before the user can click "Next"
 *
 * HOW TO ADD A NEW LLM PROVIDER:
 *   1. Add an entry to LLM_PROVIDERS below
 *   2. Add the provider to the backend validation in
 *      jarble-api-main/src/trpc/routers/openrouter.ts → validateProviderKey
 *   3. Add the provider to the Zod enum in
 *      jarble-api-main/src/trpc/routers/deployment.ts → create + update
 *
 * HOW TO CHANGE HARDWARE OPTIONS:
 *   Edit CPU_OPTIONS, MEMORY_OPTIONS, or STORAGE_OPTIONS below.
 *   Each has { value, label } — the wizard buttons update automatically.
 *   The "recommended" badge comes from the runtime_catalog DB table,
 *   not from these arrays.
 *
 * EXAMPLE — Adding a "discordbot" runtime with Discord + Deploy steps:
 *
 *   // 1. In this file, add to RUNTIME_EXTRA_STEPS:
 *   discordbot: [
 *     { id: "discord", title: "Connect Discord", icon: MessageCircle },
 *     { id: "deploy", title: "Deploy", icon: Rocket },
 *   ],
 *
 *   // 2. In OnboardingWizard.tsx, add the render block:
 *   {currentStepId === "discord" && <StepConnectDiscord ... />}
 *
 *   // 3. Create the StepConnectDiscord component (inline or separate file)
 *
 *   That's it — progress bar, navigation, and button text adapt automatically.
 *
 * HOW TO CHANGE CONFIG DASHBOARD TABS FOR A RUNTIME:
 *   1. Edit RUNTIME_CONFIG_TABS below (same pattern as RUNTIME_EXTRA_STEPS)
 *   2. If a new tab ID is used, add the matching render block in
 *      DeploymentConfiguration.tsx:
 *        {activeTab === "yourid" && <YourTabComponent />}
 *   3. Universal tabs (General, Advanced) are always shown for every runtime.
 *
 *   Example — Adding a "discordbot" runtime with Model + Platforms tabs:
 *     discordbot: [
 *       { id: "model", label: "Model", icon: Bot },
 *       { id: "platforms", label: "Platforms", icon: Link2 },
 *     ],
 */

import {
  Bot,
  FileCode,
  Sparkles,
  Rocket,
  MessageCircle,
  Settings,
  Link2,
  Shield,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────

export interface WizardStepDef {
  id: string;       // Unique step ID — used to match render blocks in OnboardingWizard.tsx
  title: string;    // Shown in the progress bar
  icon: LucideIcon; // Lucide icon component shown in the progress circle
}

export interface LLMProviderDef {
  id: "openrouter" | "openai" | "anthropic" | "google";
  name: string;         // Display name in the provider grid
  description: string;  // Short description shown under the name
  keyPrefix: string;    // Used for auto-detection — matched longest-first (e.g. "sk-ant-" before "sk-")
  keyPlaceholder: string; // Placeholder text for the API key input
  keyUrl: string;       // Link to where users can get their API key
  recommended?: boolean; // Shows a "Recommended" badge on the provider card
}

export interface LLMModelDef {
  id: string;           // Model ID sent to the API (e.g. "openrouter/auto", "gpt-4o")
  name: string;         // Display name in the selector
  provider: LLMProviderDef["id"]; // Which provider this model belongs to
  description: string;  // Short description shown in the dropdown
  isDefault?: boolean;  // Pre-selected default (one per provider)
}

// ─── Universal Steps (always shown first, before runtime-specific steps) ──

export const UNIVERSAL_STEPS: WizardStepDef[] = [
  { id: "name", title: "Name", icon: Bot },
  { id: "runtime", title: "Choose Runtime", icon: FileCode },
];

// ─── Runtime-specific extra steps (appended after universal steps) ────
//
// KEY = runtime slug (must match the slug in the runtime_catalog DB table)
// VALUE = array of steps shown AFTER "Name" and "Choose Runtime"
//
// To add steps for a new runtime, just add a new key here.
// If you use a new step ID, also add the matching render block
// in OnboardingWizard.tsx (see HOW TO at top of file).

const RUNTIME_EXTRA_STEPS: Record<string, WizardStepDef[]> = {
  // OpenClaw — AI WhatsApp bot, needs LLM config + WhatsApp connection
  openclaw: [
    { id: "llm", title: "LLM Setup", icon: Sparkles },
    { id: "deploy", title: "Deploy", icon: Rocket },
    { id: "whatsapp", title: "Connect WhatsApp", icon: MessageCircle },
  ],

  // ZeroClaw — lightweight bot, no LLM config needed
  zeroclaw: [
    { id: "deploy", title: "Deploy", icon: Rocket },
  ],

  // ── Add new runtimes here ──
  // Example:
  // discordbot: [
  //   { id: "llm", title: "LLM Setup", icon: Sparkles },
  //   { id: "discord", title: "Connect Discord", icon: MessageCircle },
  //   { id: "deploy", title: "Deploy", icon: Rocket },
  // ],
};

// Fallback for unknown/new runtimes that aren't listed above — just deploy
const DEFAULT_EXTRA_STEPS: WizardStepDef[] = [
  { id: "deploy", title: "Deploy", icon: Rocket },
];

// ─── Config Dashboard Tabs (shown in the deployment config sidebar) ──
//
// These define which tabs appear in the deployment configuration dashboard
// for each runtime. Works the same way as RUNTIME_EXTRA_STEPS above.
//
// HOW TO CHANGE CONFIG TABS FOR A RUNTIME:
//   Just edit the arrays below. The config dashboard reads from here
//   automatically. If you add a new tab ID, also add the matching
//   render block in DeploymentConfiguration.tsx.
//
// Universal tabs (always shown): General, Advanced
// Runtime-specific tabs: Model, Platforms, Skills, etc.

export interface ConfigTabDef {
  id: string;         // Unique tab ID — used to match render blocks in DeploymentConfiguration.tsx
  label: string;      // Shown in the sidebar navigation
  icon: LucideIcon;   // Lucide icon component
}

// Always shown for all runtimes
export const UNIVERSAL_CONFIG_TABS: ConfigTabDef[] = [
  { id: "general", label: "General", icon: Settings },
];

// Runtime-specific tabs (inserted between General and Advanced)
const RUNTIME_CONFIG_TABS: Record<string, ConfigTabDef[]> = {
  // OpenClaw — AI WhatsApp bot, needs Model + Platforms + Skills
  openclaw: [
    { id: "model", label: "Model", icon: Bot },
    { id: "platforms", label: "Platforms", icon: Link2 },
    { id: "skills", label: "Skills", icon: Sparkles },
  ],

  // ZeroClaw — lightweight bot, only Platforms
  zeroclaw: [
    { id: "platforms", label: "Platforms", icon: Link2 },
  ],

  // ── Add new runtimes here ──
  // Example:
  // discordbot: [
  //   { id: "model", label: "Model", icon: Bot },
  //   { id: "platforms", label: "Platforms", icon: Link2 },
  // ],
};

// Fallback for unknown runtimes — show all tabs
const DEFAULT_CONFIG_TABS: ConfigTabDef[] = [
  { id: "model", label: "Model", icon: Bot },
  { id: "platforms", label: "Platforms", icon: Link2 },
  { id: "skills", label: "Skills", icon: Sparkles },
];

// Always shown last
const ADVANCED_TAB: ConfigTabDef = { id: "advanced", label: "Advanced", icon: Shield };

/**
 * Get the config dashboard tabs for a runtime slug.
 * Returns universal tabs + runtime-specific tabs + Advanced.
 *
 * Example:
 *   getConfigTabs("openclaw")  → [General, Model, Platforms, Skills, Advanced]
 *   getConfigTabs("zeroclaw")  → [General, Platforms, Advanced]
 *   getConfigTabs(null)        → [General, Model, Platforms, Skills, Advanced]  (fallback)
 */
export function getConfigTabs(runtimeSlug: string | null): ConfigTabDef[] {
  const extras = runtimeSlug
    ? (RUNTIME_CONFIG_TABS[runtimeSlug] ?? DEFAULT_CONFIG_TABS)
    : DEFAULT_CONFIG_TABS;

  return [...UNIVERSAL_CONFIG_TABS, ...extras, ADVANCED_TAB];
}

// ─── LLM Providers (shown in the BYOK provider grid) ────────────────
//
// To add a new provider:
//   1. Add it here with a unique keyPrefix for auto-detection
//   2. Add validation logic in openrouter.ts → validateProviderKey
//   3. Add the provider ID to the Zod enum in deployment.ts

export const LLM_PROVIDERS: LLMProviderDef[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Access 200+ models from one API. Best value & flexibility.",
    keyPrefix: "sk-or-",
    keyPlaceholder: "sk-or-v1-...",
    keyUrl: "https://openrouter.ai/keys",
    recommended: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT-4o, o1, and more",
    keyPrefix: "sk-",               // Note: "sk-" is less specific than "sk-or-" and "sk-ant-"
    keyPlaceholder: "sk-proj-...",   // so those match first during auto-detection
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude Opus 4.5, Sonnet 4, Haiku",
    keyPrefix: "sk-ant-",
    keyPlaceholder: "sk-ant-api03-...",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google",
    name: "Google AI",
    description: "Gemini 2.0 Pro & Flash",
    keyPrefix: "AIza",
    keyPlaceholder: "AIzaSy...",
    keyUrl: "https://aistudio.google.com/apikey",
  },
];

// ─── LLM Models (shown in model selector dropdown) ───────────────────
//
// Each model belongs to a provider. The UI filters this list by the
// currently selected provider (or shows all for OpenRouter/included).
// To add a new model, just add it here — the dropdown updates automatically.
//
// The model with isDefault: true is pre-selected when switching providers.
// For "Included Credits" mode, the default is always "openrouter/auto".

export const LLM_MODELS: LLMModelDef[] = [
  // ── OpenRouter models ──
  { id: "openrouter/auto",           name: "Auto (Best Available)",   provider: "openrouter", description: "OpenRouter picks the best model for each request", isDefault: true },
  { id: "openai/gpt-4o",             name: "GPT-4o",                  provider: "openrouter", description: "OpenAI's flagship multimodal model" },
  { id: "openai/gpt-4o-mini",        name: "GPT-4o Mini",             provider: "openrouter", description: "Fast and affordable for simple tasks" },
  { id: "anthropic/claude-sonnet-4-20250514", name: "Claude Sonnet 4",  provider: "openrouter", description: "Anthropic's balanced model" },
  { id: "anthropic/claude-haiku-3.5", name: "Claude Haiku 3.5",       provider: "openrouter", description: "Fast, cheap, and capable" },
  { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash",     provider: "openrouter", description: "Google's fast multimodal model" },

  // ── OpenAI direct models ──
  { id: "gpt-4o",                    name: "GPT-4o",                  provider: "openai", description: "Flagship multimodal model", isDefault: true },
  { id: "gpt-4o-mini",               name: "GPT-4o Mini",             provider: "openai", description: "Fast and affordable" },
  { id: "o1",                        name: "o1",                      provider: "openai", description: "Advanced reasoning model" },

  // ── Anthropic direct models ──
  { id: "claude-sonnet-4-20250514",  name: "Claude Sonnet 4",         provider: "anthropic", description: "Balanced performance and speed", isDefault: true },
  { id: "claude-haiku-3.5",          name: "Claude Haiku 3.5",        provider: "anthropic", description: "Fast and affordable" },
  { id: "claude-opus-4-20250514",    name: "Claude Opus 4",           provider: "anthropic", description: "Most capable model" },

  // ── Google direct models ──
  { id: "gemini-2.0-flash",          name: "Gemini 2.0 Flash",        provider: "google", description: "Fast multimodal model", isDefault: true },
  { id: "gemini-2.0-pro",            name: "Gemini 2.0 Pro",          provider: "google", description: "Most capable Google model" },
];

// Default model for "Included Credits" mode (always via OpenRouter)
export const DEFAULT_INCLUDED_MODEL = "openrouter/auto";

// ─── Hardware Configuration Options (shown in Deploy step) ──────────
//
// These define the selectable values for CPU, RAM, and Storage in the
// hardware configuration panel. Each option has a value and a display label.
//
// HOW TO CHANGE HARDWARE OPTIONS:
//   Just edit the arrays below. The wizard reads from here automatically.
//   The "recommended" value for each deployment comes from the runtime_catalog
//   DB table (cpuLimit, memoryMb, storageMb), NOT from here.
//   These arrays only control what buttons appear in the UI.

export interface HardwareOptionDef {
  value: number | string;  // The actual value (string for CPU, number for RAM in MB / Storage in GB)
  label: string;           // Display label shown on the button
}

export const CPU_OPTIONS: HardwareOptionDef[] = [
  { value: "1", label: "1" },
  { value: "1.50", label: "1.50" },
  { value: "2.0",  label: "2.0" },
  { value: "2.5",  label: "2.5" },
  { value: "3.0",  label: "3.0" },
  { value: "3.5",  label: "3.5" },
];

export const MEMORY_OPTIONS: HardwareOptionDef[] = [
  { value: 256,  label: "256 MB" },
  { value: 512,  label: "512 MB" },
  { value: 1024, label: "1 GB" },
  { value: 2048, label: "2 GB" },
  { value: 4096, label: "4 GB" },
  { value: 8192, label: "8 GB" },
];

export const STORAGE_OPTIONS: HardwareOptionDef[] = [
  { value: 20,   label: "20 GB" },
  { value: 30,  label: "30 GB" },
  { value: 40,  label: "40 GB" },
  { value: 50,  label: "50 GB" },
  { value: 60,  label: "60 GB" },
  { value: 70,  label: "70 GB" },
  { value: 80,  label: "80 GB" },
  { value: 90,  label: "90 GB" },
  { value: 100, label: "100 GB" },
];

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Auto-detect provider from an API key prefix.
 * Matches longest prefix first so "sk-ant-" beats "sk-".
 *
 * Example:
 *   detectProviderFromKey("sk-ant-api03-abc")  → "anthropic"
 *   detectProviderFromKey("sk-or-v1-xyz")      → "openrouter"
 *   detectProviderFromKey("sk-proj-123")       → "openai"
 *   detectProviderFromKey("AIzaSy123")         → "google"
 *   detectProviderFromKey("unknown")           → null
 */
export function detectProviderFromKey(apiKey: string): LLMProviderDef["id"] | null {
  if (!apiKey || apiKey.length < 3) return null;

  // Sort by prefix length descending so more-specific prefixes match first
  const sorted = [...LLM_PROVIDERS].sort(
    (a, b) => b.keyPrefix.length - a.keyPrefix.length
  );

  for (const provider of sorted) {
    if (apiKey.startsWith(provider.keyPrefix)) {
      return provider.id;
    }
  }

  return null;
}

/**
 * Get the full wizard steps for a runtime slug.
 * Returns universal steps + runtime-specific extras.
 * If no runtime is selected yet, returns only the 2 universal steps.
 *
 * Example:
 *   getWizardSteps(null)        → [Name, Runtime]           (2 steps)
 *   getWizardSteps("openclaw")  → [Name, Runtime, LLM, Deploy, WhatsApp]  (5 steps)
 *   getWizardSteps("zeroclaw")  → [Name, Runtime, Deploy]   (3 steps)
 */
export function getWizardSteps(runtimeSlug: string | null): WizardStepDef[] {
  if (!runtimeSlug) {
    return [...UNIVERSAL_STEPS];
  }

  const extras = RUNTIME_EXTRA_STEPS[runtimeSlug] ?? DEFAULT_EXTRA_STEPS;
  return [...UNIVERSAL_STEPS, ...extras];
}

/**
 * Check if a runtime requires LLM configuration.
 * Returns true if the runtime's steps include an "llm" step.
 */
export function runtimeNeedsLlm(runtimeSlug: string | null): boolean {
  if (!runtimeSlug) return false;
  const extras = RUNTIME_EXTRA_STEPS[runtimeSlug] ?? DEFAULT_EXTRA_STEPS;
  return extras.some((s) => s.id === "llm");
}

/**
 * Get provider definition by ID.
 */
export function getProviderById(id: string): LLMProviderDef | undefined {
  return LLM_PROVIDERS.find((p) => p.id === id);
}

/**
 * Get available models for a provider.
 * Returns models filtered by provider ID.
 *
 * Example:
 *   getModelsForProvider("openai")  → [GPT-4o, GPT-4o Mini, o1]
 *   getModelsForProvider("openrouter") → [Auto, GPT-4o, Claude Sonnet 4, ...]
 */
export function getModelsForProvider(providerId: string): LLMModelDef[] {
  return LLM_MODELS.filter((m) => m.provider === providerId);
}

/**
 * Get the default model for a provider.
 * Returns the model with isDefault: true, or the first model if none marked.
 */
export function getDefaultModelForProvider(providerId: string): LLMModelDef | undefined {
  const models = getModelsForProvider(providerId);
  return models.find((m) => m.isDefault) || models[0];
}
