"use client";

import { memo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useCanvasAction } from "../CanvasActionContext";
import { useSandboxTheme } from "../SandboxThemeContext";
import { FadeIn } from "../FadeIn";

// Lazy-load Sandpack (no SSR - needs browser APIs)
const SandpackProvider = dynamic(
  () => import("@codesandbox/sandpack-react").then((m) => m.SandpackProvider),
  { ssr: false }
);
const SandpackPreview = dynamic(
  () => import("@codesandbox/sandpack-react").then((m) => m.SandpackPreview),
  { ssr: false }
);

export interface CanvasSandpackSandboxProps {
  /** Files map: { "/App.tsx": "code...", "/data.ts": "..." } */
  files: Record<string, string>;
  /** npm dependencies: { "three": "latest", "d3": "^7" } */
  dependencies?: Record<string, string>;
  /** Sandbox template */
  template?: "react" | "react-ts" | "vanilla" | "vanilla-ts";
  /** Title shown in sandbox header */
  title?: string;
  /** Height in pixels */
  height?: number;
  /** Entry file path (default: "/App.tsx") */
  entryFile?: string;
}

function CanvasSandpackSandboxInner({
  files,
  dependencies,
  template = "react-ts",
  title,
  height,
  entryFile = "/App.tsx",
}: CanvasSandpackSandboxProps) {
  const { dispatch } = useCanvasAction();
  const { themeVars } = useSandboxTheme();
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Convert files to Sandpack format (add leading / if missing)
  const sandpackFiles: Record<string, string> = {};
  for (const [path, code] of Object.entries(files)) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    sandpackFiles[normalizedPath] = code;
  }

  // Inject theme CSS variables as a virtual file so Sandpack content inherits the theme
  if (themeVars && Object.keys(themeVars).length > 0) {
    const themeVarDeclarations = Object.entries(themeVars)
      .map(([key, value]) => `  ${key}: ${value};`)
      .join("\n");
    sandpackFiles["/jarble-theme.css"] = `:root {\n${themeVarDeclarations}\n}\n`;

    // Ensure the theme CSS is imported in the entry file
    const entryKey = sandpackFiles[entryFile] ? entryFile : (sandpackFiles["/App.tsx"] ? "/App.tsx" : "/App.js");
    if (sandpackFiles[entryKey] && !sandpackFiles[entryKey].includes("jarble-theme.css")) {
      sandpackFiles[entryKey] = `import "./jarble-theme.css";\n${sandpackFiles[entryKey]}`;
    }
  }

  // Ensure entry file exists
  if (!sandpackFiles[entryFile] && !sandpackFiles["/App.tsx"] && !sandpackFiles["/App.js"]) {
    // Use the first file as entry
    const firstKey = Object.keys(sandpackFiles)[0];
    if (firstKey) {
      sandpackFiles["/App.tsx"] = sandpackFiles[firstKey];
    }
  }

  return (
    <FadeIn className="h-full w-full">
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded"
      style={{ minHeight: height || 400 }}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
      <SandpackProvider
        template={template}
        files={sandpackFiles}
        customSetup={{
          dependencies: dependencies || {},
          entry: entryFile,
        }}
        options={{
          recompileMode: "delayed",
          recompileDelay: 300,
          autorun: true,
          autoReload: true,
        }}
      >
        <SandpackPreview
          showOpenInCodeSandbox={false}
          showRefreshButton={true}
          showNavigator={false}
          style={{ height: "100%", minHeight: height || 400 }}
          onLoad={() => setLoading(false)}
        />
      </SandpackProvider>
    </div>
    </FadeIn>
  );
}

const CanvasSandpackSandbox = memo(CanvasSandpackSandboxInner);
export default CanvasSandpackSandbox;
