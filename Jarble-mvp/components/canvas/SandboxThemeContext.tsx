"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Context for passing the parent page's resolved theme CSS variables
 * into sandbox iframes. Sandbox iframes are fully isolated (no same-origin),
 * so theme vars must be explicitly injected into the iframe document.
 */

export interface SandboxThemeContextValue {
  /** CSS variable map, e.g. { "--primary": "#38bdf8", "--jarble-skin": "terminal" } */
  themeVars: Record<string, string>;
}

const SandboxThemeContext = createContext<SandboxThemeContextValue>({
  themeVars: {},
});

export function SandboxThemeProvider({
  themeVars,
  children,
}: {
  themeVars: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <SandboxThemeContext.Provider value={{ themeVars }}>
      {children}
    </SandboxThemeContext.Provider>
  );
}

/** Returns the current theme vars for injection into sandbox iframes. */
export function useSandboxTheme(): SandboxThemeContextValue {
  return useContext(SandboxThemeContext);
}
