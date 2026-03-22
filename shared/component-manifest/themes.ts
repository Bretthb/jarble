/**
 * Theme presets for per-deployment custom themes.
 *
 * Each preset is a complete set of CSS variable overrides (hex colors).
 * Consumed by:
 * - Frontend (page.tsx) — applies as inline CSS variables
 * - API (theme validation) — resolves preset names to color values
 * - MCP server (set_theme tool) — via generated JSON or inline copy
 */

export interface ThemeConfig {
  /** Preset name. "default" resets to platform defaults. */
  preset?: string;
  /** Custom color overrides (hex values). Merged on top of preset. */
  colors?: Partial<Record<ThemeColorKey, string>>;
  /** Border radius, e.g. "0.75rem", "0", "1rem" */
  radius?: string;
  /** CSS font-family for body text */
  fontFamily?: string;
  /** CSS font-family for headings */
  headingFontFamily?: string;
  /** Chat skin name — controls layout/style overrides on the chat UI */
  skin?: string;
}

export type ThemeColorKey =
  | "background" | "foreground"
  | "card" | "card-foreground"
  | "primary" | "primary-foreground"
  | "secondary" | "secondary-foreground"
  | "muted" | "muted-foreground"
  | "accent" | "accent-foreground"
  | "destructive" | "destructive-foreground"
  | "border" | "input" | "ring"
  | "chart-1" | "chart-2" | "chart-3" | "chart-4" | "chart-5";

/** All valid CSS variable keys that themes can override */
export const THEME_COLOR_KEYS: ThemeColorKey[] = [
  "background", "foreground",
  "card", "card-foreground",
  "primary", "primary-foreground",
  "secondary", "secondary-foreground",
  "muted", "muted-foreground",
  "accent", "accent-foreground",
  "destructive", "destructive-foreground",
  "border", "input", "ring",
  "chart-1", "chart-2", "chart-3", "chart-4", "chart-5",
];

const THEME_COLOR_KEY_SET = new Set<string>(THEME_COLOR_KEYS);

/** Check if a string is a valid theme color key */
export function isThemeColorKey(key: string): key is ThemeColorKey {
  return THEME_COLOR_KEY_SET.has(key);
}

// ── Presets ───────────────────────────────────────────────────────────────────

export const THEME_PRESETS: Record<string, Record<ThemeColorKey, string>> = {
  midnight: {
    background: "#0a0e1a",
    foreground: "#e2e8f0",
    card: "#111827",
    "card-foreground": "#e2e8f0",
    primary: "#38bdf8",
    "primary-foreground": "#0a0e1a",
    secondary: "#1e293b",
    "secondary-foreground": "#e2e8f0",
    muted: "#1e293b",
    "muted-foreground": "#94a3b8",
    accent: "#1e293b",
    "accent-foreground": "#e2e8f0",
    destructive: "#ef4444",
    "destructive-foreground": "#ffffff",
    border: "#1e3a5f",
    input: "#1e293b",
    ring: "#38bdf8",
    "chart-1": "#38bdf8",
    "chart-2": "#818cf8",
    "chart-3": "#34d399",
    "chart-4": "#fbbf24",
    "chart-5": "#f472b6",
  },
  forest: {
    background: "#0c1a0e",
    foreground: "#d4e8d0",
    card: "#132216",
    "card-foreground": "#d4e8d0",
    primary: "#4ade80",
    "primary-foreground": "#0c1a0e",
    secondary: "#1a2e1d",
    "secondary-foreground": "#d4e8d0",
    muted: "#1a2e1d",
    "muted-foreground": "#7dab82",
    accent: "#1a2e1d",
    "accent-foreground": "#d4e8d0",
    destructive: "#ef4444",
    "destructive-foreground": "#ffffff",
    border: "#2d4a32",
    input: "#1a2e1d",
    ring: "#4ade80",
    "chart-1": "#4ade80",
    "chart-2": "#fbbf24",
    "chart-3": "#a78bfa",
    "chart-4": "#fb923c",
    "chart-5": "#38bdf8",
  },
  cyberpunk: {
    background: "#0d0015",
    foreground: "#e0d4f5",
    card: "#1a0029",
    "card-foreground": "#e0d4f5",
    primary: "#f0abfc",
    "primary-foreground": "#0d0015",
    secondary: "#2d0047",
    "secondary-foreground": "#e0d4f5",
    muted: "#2d0047",
    "muted-foreground": "#a78bfa",
    accent: "#2d0047",
    "accent-foreground": "#e0d4f5",
    destructive: "#ff3366",
    "destructive-foreground": "#ffffff",
    border: "#4c0080",
    input: "#2d0047",
    ring: "#f0abfc",
    "chart-1": "#f0abfc",
    "chart-2": "#22d3ee",
    "chart-3": "#a3e635",
    "chart-4": "#ff3366",
    "chart-5": "#fbbf24",
  },
  ocean: {
    background: "#0a1628",
    foreground: "#d0e8f0",
    card: "#0f2035",
    "card-foreground": "#d0e8f0",
    primary: "#06b6d4",
    "primary-foreground": "#0a1628",
    secondary: "#162d45",
    "secondary-foreground": "#d0e8f0",
    muted: "#162d45",
    "muted-foreground": "#7db3c4",
    accent: "#162d45",
    "accent-foreground": "#d0e8f0",
    destructive: "#ef4444",
    "destructive-foreground": "#ffffff",
    border: "#1e4060",
    input: "#162d45",
    ring: "#06b6d4",
    "chart-1": "#06b6d4",
    "chart-2": "#34d399",
    "chart-3": "#818cf8",
    "chart-4": "#fbbf24",
    "chart-5": "#f472b6",
  },
  rose: {
    background: "#1a0a10",
    foreground: "#f0d4e0",
    card: "#251018",
    "card-foreground": "#f0d4e0",
    primary: "#f472b6",
    "primary-foreground": "#1a0a10",
    secondary: "#351828",
    "secondary-foreground": "#f0d4e0",
    muted: "#351828",
    "muted-foreground": "#c4789a",
    accent: "#351828",
    "accent-foreground": "#f0d4e0",
    destructive: "#ef4444",
    "destructive-foreground": "#ffffff",
    border: "#4a2038",
    input: "#351828",
    ring: "#f472b6",
    "chart-1": "#f472b6",
    "chart-2": "#a78bfa",
    "chart-3": "#38bdf8",
    "chart-4": "#4ade80",
    "chart-5": "#fbbf24",
  },
  amber: {
    background: "#1a1408",
    foreground: "#f0e8d0",
    card: "#251e0e",
    "card-foreground": "#f0e8d0",
    primary: "#f59e0b",
    "primary-foreground": "#1a1408",
    secondary: "#352a14",
    "secondary-foreground": "#f0e8d0",
    muted: "#352a14",
    "muted-foreground": "#c4a860",
    accent: "#352a14",
    "accent-foreground": "#f0e8d0",
    destructive: "#ef4444",
    "destructive-foreground": "#ffffff",
    border: "#4a3820",
    input: "#352a14",
    ring: "#f59e0b",
    "chart-1": "#f59e0b",
    "chart-2": "#ef4444",
    "chart-3": "#4ade80",
    "chart-4": "#38bdf8",
    "chart-5": "#a78bfa",
  },
  terminal: {
    background: "#000000",
    foreground: "#00ff00",
    card: "#0a0a0a",
    "card-foreground": "#00ff00",
    primary: "#00ff00",
    "primary-foreground": "#000000",
    secondary: "#111111",
    "secondary-foreground": "#00ff00",
    muted: "#111111",
    "muted-foreground": "#00aa00",
    accent: "#111111",
    "accent-foreground": "#00ff00",
    destructive: "#ff0000",
    "destructive-foreground": "#000000",
    border: "#003300",
    input: "#111111",
    ring: "#00ff00",
    "chart-1": "#00ff00",
    "chart-2": "#00ccff",
    "chart-3": "#ffff00",
    "chart-4": "#ff00ff",
    "chart-5": "#ff6600",
  },
  retro: {
    background: "#e0d8c0",
    foreground: "#212529",
    card: "#f0e8d0",
    "card-foreground": "#212529",
    primary: "#209cee",
    "primary-foreground": "#ffffff",
    secondary: "#d4cbb3",
    "secondary-foreground": "#212529",
    muted: "#c8bfa6",
    "muted-foreground": "#6c6c6c",
    accent: "#92cc41",
    "accent-foreground": "#212529",
    destructive: "#e76e55",
    "destructive-foreground": "#ffffff",
    border: "#212529",
    input: "#f0e8d0",
    ring: "#209cee",
    "chart-1": "#209cee",
    "chart-2": "#92cc41",
    "chart-3": "#f7d51d",
    "chart-4": "#e76e55",
    "chart-5": "#9b59b6",
  },
  win98: {
    background: "#c0c0c0",
    foreground: "#000000",
    card: "#c0c0c0",
    "card-foreground": "#000000",
    primary: "#000080",
    "primary-foreground": "#ffffff",
    secondary: "#c0c0c0",
    "secondary-foreground": "#000000",
    muted: "#808080",
    "muted-foreground": "#404040",
    accent: "#000080",
    "accent-foreground": "#ffffff",
    destructive: "#ff0000",
    "destructive-foreground": "#ffffff",
    border: "#808080",
    input: "#ffffff",
    ring: "#000080",
    "chart-1": "#000080",
    "chart-2": "#008080",
    "chart-3": "#808000",
    "chart-4": "#800080",
    "chart-5": "#008000",
  },
};

export const THEME_PRESET_NAMES = Object.keys(THEME_PRESETS);

/** Available chat skin names */
export const SKIN_NAMES = ["default", "minimal", "terminal", "neobrutalist", "glass", "retro", "handdrawn", "win98"] as const;

export type SkinName = typeof SKIN_NAMES[number];

// ── Validation helpers ───────────────────────────────────────────────────────

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const RADIUS_RE = /^\d+(\.\d+)?(rem|px|em)$/;
const FONT_BLOCKLIST_RE = /url\(|expression\(|javascript:|<script|<\/script/i;
const MAX_THEME_JSON_SIZE = 4096;

/** Validate a ThemeConfig object. Returns error message or null if valid. */
export function validateThemeConfig(config: unknown): string | null {
  if (!config || typeof config !== "object") return "Theme config must be an object";
  const c = config as Record<string, unknown>;

  // Check JSON size
  const json = JSON.stringify(c);
  if (json.length > MAX_THEME_JSON_SIZE) return `Theme config too large (${json.length} > ${MAX_THEME_JSON_SIZE} bytes)`;

  // Validate preset
  if (c.preset !== undefined) {
    if (typeof c.preset !== "string") return "preset must be a string";
    if (c.preset !== "default" && !THEME_PRESETS[c.preset]) {
      return `Unknown preset "${c.preset}". Valid: default, ${THEME_PRESET_NAMES.join(", ")}`;
    }
  }

  // Validate colors
  if (c.colors !== undefined) {
    if (typeof c.colors !== "object" || c.colors === null) return "colors must be an object";
    for (const [key, value] of Object.entries(c.colors as Record<string, unknown>)) {
      if (!isThemeColorKey(key)) return `Unknown color key "${key}"`;
      if (typeof value !== "string") return `Color "${key}" must be a string`;
      if (!HEX_COLOR_RE.test(value)) return `Color "${key}" must be a hex color (e.g. #ff0000), got "${value}"`;
    }
  }

  // Validate radius
  if (c.radius !== undefined) {
    if (typeof c.radius !== "string") return "radius must be a string";
    if (!RADIUS_RE.test(c.radius)) return `Invalid radius "${c.radius}". Use e.g. "0.75rem", "8px"`;
  }

  // Validate font families
  for (const key of ["fontFamily", "headingFontFamily"] as const) {
    if (c[key] !== undefined) {
      if (typeof c[key] !== "string") return `${key} must be a string`;
      if ((c[key] as string).length > 200) return `${key} too long (max 200 chars)`;
      if (FONT_BLOCKLIST_RE.test(c[key] as string)) return `${key} contains disallowed content`;
    }
  }

  // Validate skin
  if (c.skin !== undefined) {
    if (typeof c.skin !== "string") return "skin must be a string";
    if (!(SKIN_NAMES as readonly string[]).includes(c.skin)) {
      return `Unknown skin "${c.skin}". Valid: ${SKIN_NAMES.join(", ")}`;
    }
  }

  return null;
}

/**
 * Resolve a ThemeConfig into a flat CSS variable map.
 * Merges preset colors with custom overrides.
 */
export function resolveThemeVars(config: ThemeConfig): Record<string, string> {
  const vars: Record<string, string> = {};

  // Apply preset colors first
  if (config.preset && config.preset !== "default" && THEME_PRESETS[config.preset]) {
    for (const [key, value] of Object.entries(THEME_PRESETS[config.preset])) {
      vars[`--${key}`] = value;
    }
  }

  // Apply custom color overrides on top
  if (config.colors) {
    for (const [key, value] of Object.entries(config.colors)) {
      if (typeof value === "string" && HEX_COLOR_RE.test(value) && isThemeColorKey(key)) {
        vars[`--${key}`] = value;
      }
    }
  }

  // Apply radius
  if (config.radius) {
    vars["--radius"] = config.radius;
  }

  // Apply font families
  if (config.fontFamily) {
    vars["--font-sans"] = config.fontFamily;
  }
  if (config.headingFontFamily) {
    vars["--font-serif"] = config.headingFontFamily;
  }

  // Apply skin
  if (config.skin) {
    vars["--jarble-skin"] = config.skin;
  }

  // Derive RGB triplets for glass skin (backdrop-filter needs rgba())
  const primaryHex = vars["--primary"];
  if (primaryHex) {
    const rgb = hexToRgb(primaryHex);
    if (rgb) vars["--primary-rgb"] = rgb;
  }

  return vars;
}

/** Convert #rrggbb hex to "r g b" string for use in rgba() */
function hexToRgb(hex: string): string | null {
  const h = hex.replace("#", "");
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return `${r} ${g} ${b}`;
  }
  if (h.length >= 6) {
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `${r} ${g} ${b}`;
  }
  return null;
}
