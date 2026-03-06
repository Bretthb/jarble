"use client";

import { memo, useEffect, useRef, useState, useCallback } from "react";
import { useCanvasAction } from "../CanvasActionContext";
import { sanitizeHtmlProp, buildDocument } from "../sandbox/sandboxCore";
import { useSandboxBridge } from "../sandbox/useSandboxBridge";
import { SandboxShell } from "../sandbox/SandboxControls";
import { SandboxConfigPanel } from "../sandbox/SandboxConfigPanel";

const isDev = process.env.NODE_ENV === "development";

export interface CanvasSandboxProps {
  html: string;
  css?: string;
  js?: string;
  props?: Record<string, unknown>;
  height?: number;
  title?: string;
  /** CDN libraries to load (e.g. ["https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"]) */
  libraries?: string[];
  /** JSON Schema for creator-defined config panel. */
  configSchema?: Record<string, unknown>;
}

function CanvasSandboxInner({
  html,
  css,
  js,
  props,
  title,
  libraries,
  configSchema,
}: CanvasSandboxProps) {
  // Note: height prop is ignored - sandbox fills its parent container
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { dispatch } = useCanvasAction();

  // Config panel state — values from configSchema override sandbox props
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({});
  const handleConfigChange = useCallback((values: Record<string, unknown>) => {
    setConfigValues(values);
  }, []);

  // Merge user config values into props (config overrides base props)
  const mergedProps = configSchema
    ? { ...(props || {}), ...configValues }
    : props;

  // Sanitize: extract <script>/<style>/<link> tags from html prop into proper fields
  const sanitized = sanitizeHtmlProp(html, js, libraries, "[Jarble:Sandbox]", css);

  // Build srcdoc string — changes when content changes
  const srcdoc = buildDocument(sanitized.html, sanitized.css, sanitized.js, sanitized.libraries, {
    logPrefix: "[Jarble:Sandbox]",
  });

  isDev && console.log("[Jarble:Sandbox] Render — html:", html?.length, "chars, css:", css?.length || 0, "chars, js:", js?.length || 0, "chars, libraries:", libraries);

  const { stopped, handleStop, resetReady } = useSandboxBridge({
    iframeRef,
    props: mergedProps,
    title,
    componentName: "sandbox",
    dispatch,
    logPrefix: "[Jarble:Sandbox]",
  });

  // Reset ready state when content changes (iframe will reload)
  useEffect(() => {
    resetReady();
  }, [html, css, js, libraries, resetReady]);

  return (
    <SandboxShell stopped={stopped} onToggle={handleStop}>
      <iframe
        ref={iframeRef}
        srcDoc={srcdoc}
        sandbox="allow-scripts allow-popups"
        allow="autoplay; fullscreen"
        style={{ flex: 1, width: "100%", minHeight: 0, border: "none", borderRadius: 8, background: "transparent" }}
      />
      {configSchema && (
        <div style={{ flexShrink: 0, marginTop: 4 }}>
          <SandboxConfigPanel
            configSchema={configSchema}
            values={configValues}
            onChange={handleConfigChange}
          />
        </div>
      )}
    </SandboxShell>
  );
}

export default memo(CanvasSandboxInner);
