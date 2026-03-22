/**
 * Dashboard Theme Token Contract
 *
 * Defines the shared design tokens injected into every agent during
 * parallel dashboard composition. Ensures visual consistency across
 * independently generated components.
 *
 * - Sandbox agents receive tokens as CSS custom properties
 * - Native agents receive chartPalette for color props
 */

import { THEME_PRESETS, resolveThemeVars } from "@jarble/component-manifest";
import type { ThemeColorKey } from "@jarble/component-manifest";

export interface DashboardThemeTokens {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  success: string;
  warning: string;
  error: string;
  chartPalette: string[];
}

const DEFAULT_TOKENS: DashboardThemeTokens = {
  primary: "#7C3AED",
  accent: "#06B6D4",
  background: "#0A0A0F",
  surface: "#111118",
  text: "rgba(255,255,255,0.92)",
  muted: "rgba(255,255,255,0.55)",
  border: "rgba(255,255,255,0.06)",
  success: "#10B981",
  warning: "#F59E0B",
  error: "#F43F5E",
  chartPalette: ["#7C3AED", "#06B6D4", "#10B981", "#F59E0B", "#F43F5E", "#A855F7"],
};

/**
 * Resolve a theme name/hint into DashboardThemeTokens.
 * Falls back to dark defaults if the preset is unknown.
 */
export function resolveThemeTokens(theme?: string): DashboardThemeTokens {
  if (!theme) return DEFAULT_TOKENS;

  const presetName = theme.toLowerCase().trim();

  // Check for a direct preset match
  const preset = THEME_PRESETS[presetName];
  if (preset) {
    return {
      primary: preset.primary,
      accent: preset.accent,
      background: preset.background,
      surface: preset.card,
      text: preset.foreground,
      muted: preset["muted-foreground"],
      border: preset.border,
      success: "#10B981",
      warning: "#F59E0B",
      error: preset.destructive,
      chartPalette: [
        preset["chart-1"],
        preset["chart-2"],
        preset["chart-3"],
        preset["chart-4"],
        preset["chart-5"],
      ],
    };
  }

  // Generic "light" / "dark" fallback
  if (presetName.includes("light")) {
    return {
      primary: "#2563EB",
      accent: "#0891B2",
      background: "#FAFAFA",
      surface: "#FFFFFF",
      text: "#111827",
      muted: "#6B7280",
      border: "rgba(0,0,0,0.06)",
      success: "#059669",
      warning: "#D97706",
      error: "#DC2626",
      chartPalette: ["#2563EB", "#0891B2", "#059669", "#D97706", "#DC2626", "#7C3AED"],
    };
  }

  return DEFAULT_TOKENS;
}

/**
 * Format tokens as a CSS :root block for injection into sandbox agent prompts.
 */
export function tokensToCss(tokens: DashboardThemeTokens): string {
  return `:root {
  --dash-primary: ${tokens.primary};
  --dash-accent: ${tokens.accent};
  --dash-bg: ${tokens.background};
  --dash-surface: ${tokens.surface};
  --dash-text: ${tokens.text};
  --dash-muted: ${tokens.muted};
  --dash-border: ${tokens.border};
  --dash-success: ${tokens.success};
  --dash-warning: ${tokens.warning};
  --dash-error: ${tokens.error};
  --dash-chart-1: ${tokens.chartPalette[0]};
  --dash-chart-2: ${tokens.chartPalette[1]};
  --dash-chart-3: ${tokens.chartPalette[2]};
  --dash-chart-4: ${tokens.chartPalette[3]};
  --dash-chart-5: ${tokens.chartPalette[4]};
}`;
}
