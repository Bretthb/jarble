/**
 * ═══════════════════════════════════════════════════════════════════════
 * Wizard Step Config — Single source of truth for onboarding wizard steps
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
 */

import {
  Bot,
  FileCode,
  Sparkles,
  Rocket,
  MessageCircle,
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
