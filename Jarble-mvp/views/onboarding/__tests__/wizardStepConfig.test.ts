/**
 * Wizard Step Config — Tests
 *
 * Tests the config-driven wizard step system, LLM provider definitions,
 * model definitions, credit plans, hardware options, and helper functions.
 */

import { describe, it, expect } from "vitest";
import {
  UNIVERSAL_STEPS,
  UNIVERSAL_CONFIG_TABS,
  LLM_PROVIDERS,
  LLM_MODELS,
  CREDIT_PLANS,
  DEFAULT_CREDIT_PLAN,
  DEFAULT_INCLUDED_MODEL,
  MANAGED_KEY_PLANS,
  DEFAULT_MANAGED_KEY_PLAN,
  CPU_OPTIONS,
  MEMORY_OPTIONS,
  STORAGE_OPTIONS,
  getWizardSteps,
  getConfigTabs,
  runtimeNeedsLlm,
  detectProviderFromKey,
  getProviderById,
  getModelsForProvider,
  getDefaultModelForProvider,
  type WizardStepDef,
  type ConfigTabDef,
  type LLMProviderDef,
} from "../wizardStepConfig";

// ── Universal Steps ─────────────────────────────────────────────────────────

describe("UNIVERSAL_STEPS", () => {
  it("has exactly 2 universal steps", () => {
    expect(UNIVERSAL_STEPS.length).toBe(2);
  });

  it("first step is Name", () => {
    expect(UNIVERSAL_STEPS[0].id).toBe("name");
    expect(UNIVERSAL_STEPS[0].title).toBe("Name");
  });

  it("second step is Choose Runtime", () => {
    expect(UNIVERSAL_STEPS[1].id).toBe("runtime");
    expect(UNIVERSAL_STEPS[1].title).toBe("Choose Runtime");
  });

  it("each step has required fields", () => {
    for (const step of UNIVERSAL_STEPS) {
      expect(typeof step.id).toBe("string");
      expect(typeof step.title).toBe("string");
      expect(step.icon).toBeDefined();
    }
  });
});

// ── getWizardSteps ──────────────────────────────────────────────────────────

describe("getWizardSteps", () => {
  it("returns only universal steps when runtime is null", () => {
    const steps = getWizardSteps(null);
    expect(steps.length).toBe(2);
    expect(steps[0].id).toBe("name");
    expect(steps[1].id).toBe("runtime");
  });

  it("returns universal + openclaw steps for openclaw runtime", () => {
    const steps = getWizardSteps("openclaw");
    expect(steps.length).toBeGreaterThan(2);
    expect(steps[0].id).toBe("name");
    expect(steps[1].id).toBe("runtime");
    expect(steps.some(s => s.id === "llm")).toBe(true);
    expect(steps.some(s => s.id === "deploy")).toBe(true);
  });

  it("returns universal + zeroclaw steps for zeroclaw runtime", () => {
    const steps = getWizardSteps("zeroclaw");
    expect(steps.length).toBeGreaterThan(2);
    expect(steps.some(s => s.id === "deploy")).toBe(true);
  });

  it("returns fallback steps for unknown runtime", () => {
    const steps = getWizardSteps("unknown_runtime_xyz");
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps[steps.length - 1].id).toBe("deploy");
  });

  it("openclaw and zeroclaw both have LLM step", () => {
    expect(getWizardSteps("openclaw").some(s => s.id === "llm")).toBe(true);
    expect(getWizardSteps("zeroclaw").some(s => s.id === "llm")).toBe(true);
  });

  it("step IDs are unique within each runtime", () => {
    for (const runtime of ["openclaw", "zeroclaw", null]) {
      const steps = getWizardSteps(runtime);
      const ids = steps.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("all steps have icon components", () => {
    for (const runtime of ["openclaw", "zeroclaw"]) {
      const steps = getWizardSteps(runtime);
      for (const step of steps) {
        expect(step.icon).toBeDefined();
      }
    }
  });
});

// ── runtimeNeedsLlm ────────────────────────────────────────────────────────

describe("runtimeNeedsLlm", () => {
  it("returns true for openclaw", () => {
    expect(runtimeNeedsLlm("openclaw")).toBe(true);
  });

  it("returns true for zeroclaw", () => {
    expect(runtimeNeedsLlm("zeroclaw")).toBe(true);
  });

  it("returns false for null", () => {
    expect(runtimeNeedsLlm(null)).toBe(false);
  });

  it("returns false for unknown runtime (fallback has no llm step)", () => {
    expect(runtimeNeedsLlm("unknown_runtime")).toBe(false);
  });
});

// ── getConfigTabs ───────────────────────────────────────────────────────────

describe("getConfigTabs", () => {
  it("returns tabs including General for openclaw", () => {
    const tabs = getConfigTabs("openclaw");
    expect(tabs[0].id).toBe("general");
  });

  it("returns tabs ending with Advanced for any runtime", () => {
    for (const runtime of ["openclaw", "zeroclaw", null]) {
      const tabs = getConfigTabs(runtime);
      expect(tabs[tabs.length - 1].id).toBe("advanced");
    }
  });

  it("includes Logs tab before Advanced", () => {
    const tabs = getConfigTabs("openclaw");
    const logsIndex = tabs.findIndex(t => t.id === "logs");
    const advancedIndex = tabs.findIndex(t => t.id === "advanced");
    expect(logsIndex).toBeGreaterThan(-1);
    expect(logsIndex).toBeLessThan(advancedIndex);
  });

  it("openclaw has model, platforms, skills, and components tabs", () => {
    const tabs = getConfigTabs("openclaw");
    const ids = tabs.map(t => t.id);
    expect(ids).toContain("model");
    expect(ids).toContain("platforms");
    expect(ids).toContain("skills");
    expect(ids).toContain("components");
  });

  it("zeroclaw has platforms and components but not model or skills", () => {
    const tabs = getConfigTabs("zeroclaw");
    const ids = tabs.map(t => t.id);
    expect(ids).toContain("platforms");
    expect(ids).toContain("components");
    expect(ids).not.toContain("model");
    expect(ids).not.toContain("skills");
  });

  it("null runtime returns fallback tabs", () => {
    const tabs = getConfigTabs(null);
    expect(tabs.length).toBeGreaterThan(2);
  });

  it("each tab has required fields", () => {
    const tabs = getConfigTabs("openclaw");
    for (const tab of tabs) {
      expect(typeof tab.id).toBe("string");
      expect(typeof tab.label).toBe("string");
      expect(tab.icon).toBeDefined();
    }
  });

  it("tab IDs are unique", () => {
    for (const runtime of ["openclaw", "zeroclaw"]) {
      const tabs = getConfigTabs(runtime);
      const ids = tabs.map(t => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

// ── LLM_PROVIDERS ──────────────────────────────────────────────────────────

describe("LLM_PROVIDERS", () => {
  it("has 4 providers", () => {
    expect(LLM_PROVIDERS.length).toBe(4);
  });

  it("includes openrouter, openai, anthropic, google", () => {
    const ids = LLM_PROVIDERS.map(p => p.id);
    expect(ids).toContain("openrouter");
    expect(ids).toContain("openai");
    expect(ids).toContain("anthropic");
    expect(ids).toContain("google");
  });

  it("openrouter is marked as recommended", () => {
    const openrouter = LLM_PROVIDERS.find(p => p.id === "openrouter");
    expect(openrouter?.recommended).toBe(true);
  });

  it("only one provider is recommended", () => {
    const recommended = LLM_PROVIDERS.filter(p => p.recommended);
    expect(recommended.length).toBe(1);
  });

  it("each provider has required fields", () => {
    for (const provider of LLM_PROVIDERS) {
      expect(typeof provider.id).toBe("string");
      expect(typeof provider.name).toBe("string");
      expect(typeof provider.description).toBe("string");
      expect(typeof provider.keyPrefix).toBe("string");
      expect(typeof provider.keyPlaceholder).toBe("string");
      expect(typeof provider.keyUrl).toBe("string");
    }
  });

  it("key URLs are valid URLs", () => {
    for (const provider of LLM_PROVIDERS) {
      expect(provider.keyUrl.startsWith("https://")).toBe(true);
    }
  });

  it("key prefixes are unique", () => {
    const prefixes = LLM_PROVIDERS.map(p => p.keyPrefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

// ── detectProviderFromKey ────────────────────────────────────────────────────

describe("detectProviderFromKey", () => {
  it("detects openrouter from sk-or- prefix", () => {
    expect(detectProviderFromKey("sk-or-v1-abc123")).toBe("openrouter");
  });

  it("detects anthropic from sk-ant- prefix", () => {
    expect(detectProviderFromKey("sk-ant-api03-xyz")).toBe("anthropic");
  });

  it("detects openai from sk- prefix (not sk-or- or sk-ant-)", () => {
    expect(detectProviderFromKey("sk-proj-abc123")).toBe("openai");
  });

  it("detects google from AIza prefix", () => {
    expect(detectProviderFromKey("AIzaSyAbc123def456")).toBe("google");
  });

  it("returns null for unknown prefix", () => {
    expect(detectProviderFromKey("unknown-key-format")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(detectProviderFromKey("")).toBeNull();
  });

  it("returns null for very short string", () => {
    expect(detectProviderFromKey("ab")).toBeNull();
  });

  it("longer prefix matches first (sk-ant- before sk-)", () => {
    // sk-ant- should match anthropic, not openai
    expect(detectProviderFromKey("sk-ant-secret")).toBe("anthropic");
  });
});

// ── getProviderById / getModelsForProvider / getDefaultModelForProvider ──

describe("getProviderById", () => {
  it("returns provider for valid ID", () => {
    const provider = getProviderById("openai");
    expect(provider).toBeDefined();
    expect(provider?.name).toBe("OpenAI");
  });

  it("returns undefined for invalid ID", () => {
    expect(getProviderById("nonexistent")).toBeUndefined();
  });
});

describe("getModelsForProvider", () => {
  it("returns models for openai", () => {
    const models = getModelsForProvider("openai");
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(m.provider).toBe("openai");
    }
  });

  it("returns models for each provider", () => {
    for (const provider of LLM_PROVIDERS) {
      const models = getModelsForProvider(provider.id);
      expect(models.length).toBeGreaterThan(0);
    }
  });

  it("returns empty array for unknown provider", () => {
    const models = getModelsForProvider("nonexistent");
    expect(models).toEqual([]);
  });
});

describe("getDefaultModelForProvider", () => {
  it("returns a model for each provider", () => {
    for (const provider of LLM_PROVIDERS) {
      const model = getDefaultModelForProvider(provider.id);
      expect(model).toBeDefined();
      expect(model?.provider).toBe(provider.id);
    }
  });

  it("returns model with isDefault when available", () => {
    const model = getDefaultModelForProvider("openai");
    expect(model?.isDefault).toBe(true);
  });
});

// ── LLM_MODELS ──────────────────────────────────────────────────────────────

describe("LLM_MODELS", () => {
  it("has models", () => {
    expect(LLM_MODELS.length).toBeGreaterThan(0);
  });

  it("each model has required fields", () => {
    for (const model of LLM_MODELS) {
      expect(typeof model.id).toBe("string");
      expect(typeof model.name).toBe("string");
      expect(typeof model.provider).toBe("string");
      expect(typeof model.description).toBe("string");
    }
  });

  it("model IDs are unique", () => {
    const ids = LLM_MODELS.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each provider has exactly one default model", () => {
    for (const provider of LLM_PROVIDERS) {
      const defaults = LLM_MODELS.filter(
        m => m.provider === provider.id && m.isDefault
      );
      expect(defaults.length).toBe(1);
    }
  });
});

// ── Credit Plans ────────────────────────────────────────────────────────────

describe("CREDIT_PLANS", () => {
  it("has at least 3 plans", () => {
    expect(CREDIT_PLANS.length).toBeGreaterThanOrEqual(3);
  });

  it("values are in ascending order", () => {
    for (let i = 1; i < CREDIT_PLANS.length; i++) {
      expect(CREDIT_PLANS[i].value).toBeGreaterThan(CREDIT_PLANS[i - 1].value);
    }
  });

  it("has exactly one default plan", () => {
    const defaults = CREDIT_PLANS.filter(p => p.isDefault);
    expect(defaults.length).toBe(1);
  });

  it("DEFAULT_CREDIT_PLAN matches the default plan value", () => {
    const defaultPlan = CREDIT_PLANS.find(p => p.isDefault);
    expect(DEFAULT_CREDIT_PLAN).toBe(defaultPlan?.value);
  });
});

// ── Hardware Options ──────────────────────────────────────────────────────

describe("Hardware options", () => {
  it("CPU_OPTIONS has values", () => {
    expect(CPU_OPTIONS.length).toBeGreaterThan(0);
  });

  it("MEMORY_OPTIONS has values in ascending order", () => {
    for (let i = 1; i < MEMORY_OPTIONS.length; i++) {
      expect(MEMORY_OPTIONS[i].value).toBeGreaterThan(
        MEMORY_OPTIONS[i - 1].value as number
      );
    }
  });

  it("STORAGE_OPTIONS has values in ascending order", () => {
    for (let i = 1; i < STORAGE_OPTIONS.length; i++) {
      expect(STORAGE_OPTIONS[i].value).toBeGreaterThan(
        STORAGE_OPTIONS[i - 1].value as number
      );
    }
  });

  it("each option has value and label", () => {
    const allOptions = [...CPU_OPTIONS, ...MEMORY_OPTIONS, ...STORAGE_OPTIONS];
    for (const opt of allOptions) {
      expect(opt.value).toBeDefined();
      expect(typeof opt.label).toBe("string");
    }
  });
});

// ── DEFAULT_INCLUDED_MODEL ──────────────────────────────────────────────────

describe("DEFAULT_INCLUDED_MODEL", () => {
  it("is openrouter/auto", () => {
    expect(DEFAULT_INCLUDED_MODEL).toBe("openrouter/auto");
  });

  it("exists in LLM_MODELS", () => {
    const found = LLM_MODELS.find(m => m.id === DEFAULT_INCLUDED_MODEL);
    expect(found).toBeDefined();
  });
});

// ── Managed Key Plans ──────────────────────────────────────────────────────

describe("MANAGED_KEY_PLANS", () => {
  it("has exactly 5 entries", () => {
    expect(MANAGED_KEY_PLANS.length).toBe(5);
  });

  it("each plan has value, label, and description", () => {
    for (const plan of MANAGED_KEY_PLANS) {
      expect(typeof plan.value).toBe("number");
      expect(typeof plan.label).toBe("string");
      expect(typeof plan.description).toBe("string");
    }
  });

  it("exactly one plan has isDefault: true", () => {
    const defaults = MANAGED_KEY_PLANS.filter(p => p.isDefault === true);
    expect(defaults.length).toBe(1);
  });

  it("values are in ascending order", () => {
    for (let i = 1; i < MANAGED_KEY_PLANS.length; i++) {
      expect(MANAGED_KEY_PLANS[i].value).toBeGreaterThan(
        MANAGED_KEY_PLANS[i - 1].value
      );
    }
  });

  it("DEFAULT_MANAGED_KEY_PLAN matches the default plan value", () => {
    const defaultPlan = MANAGED_KEY_PLANS.find(p => p.isDefault);
    expect(DEFAULT_MANAGED_KEY_PLAN).toBe(defaultPlan?.value);
  });

  it("DEFAULT_MANAGED_KEY_PLAN is 5", () => {
    expect(DEFAULT_MANAGED_KEY_PLAN).toBe(5);
  });
});
