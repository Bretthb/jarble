"use client";

import { memo, useEffect, useRef } from "react";
import { useCanvasAction } from "../CanvasActionContext";
import { sanitizeHtmlProp, buildDocument } from "../sandbox/sandboxCore";
import { useSandboxBridge } from "../sandbox/useSandboxBridge";
import { SandboxShell } from "../sandbox/SandboxControls";

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
}

function CanvasSandboxInner({
  html,
  css,
  js,
  props,
  title,
  libraries,
}: CanvasSandboxProps) {
  // Note: height prop is ignored - sandbox fills its parent container
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { dispatch } = useCanvasAction();

  // Sanitize: extract any <script>/<style>/structural tags from html prop
  const sanitized = sanitizeHtmlProp(html, js, libraries);

  // Build srcdoc string — changes when content changes
  const srcdoc = buildDocument(sanitized.html, css, sanitized.js, sanitized.libraries, {
    logPrefix: "[Jarble:Sandbox]",
  });

  isDev && console.log("[Jarble:Sandbox] Render — html:", html?.length, "chars, css:", css?.length || 0, "chars, js:", js?.length || 0, "chars, libraries:", libraries);

  const { stopped, handleStop, resetReady } = useSandboxBridge({
    iframeRef,
    props,
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
    </SandboxShell>
  );
}

export default memo(CanvasSandboxInner);
