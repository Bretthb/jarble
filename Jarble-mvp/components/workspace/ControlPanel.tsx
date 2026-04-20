"use client";

/**
 * ControlPanel — Embeds the OpenClaw Control UI with a component bridge.
 *
 * The injected WS interceptor in the iframe detects jarble_ui blocks in
 * bot responses and forwards them via postMessage. This component renders
 * them in a floating canvas panel. Edit sync flows back through postMessage
 * → injected script → WS → bot.
 */

import { useEffect, useState, useCallback, useRef, useReducer } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";
import { Loader2, Layout, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import CanvasRenderer, { type UIBlock } from "@/components/canvas/CanvasRenderer";
import type { CanvasAction } from "@/components/canvas/CanvasActionContext";
import { nanoid } from "nanoid";

interface ControlPanelProps {
  deploymentId: string;
  liveStatus: string;
  /**
   * postMessage protocol name the embedded iframe emits for canvas blocks.
   * Defaults to OpenClaw's "jarble:ui_block" for backwards compatibility.
   * Parent pages should pass the active deployment's runtime
   * `capabilities.canvasProtocol` once JAR-100 wires runtime-awareness
   * into the page. Runtimes that don't emit canvas blocks (nativeCanvas:
   * false) can pass undefined — the listener becomes a no-op.
   *
   * Added under JAR-119 (Phase 2 of the runtime abstraction program).
   */
  canvasProtocol?: string;
}

export default function ControlPanel({
  deploymentId,
  liveStatus,
  canvasProtocol = "jarble:ui_block",
}: ControlPanelProps) {
  const { getAccessTokenSilently } = useAuth0();
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<UIBlock[]>([]);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Build iframe src
  useEffect(() => {
    if (liveStatus !== "running") {
      setError("Deployment must be running to open the Control UI.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function buildSrc() {
      try {
        const token = await getAccessTokenSilently();

        const tokenRes = await fetch(
          `${API_URL}/api/deployments/${deploymentId}/admin-token`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!tokenRes.ok) throw new Error("Failed to get gateway token");
        const { gatewayToken } = await tokenRes.json();

        const apiHost = API_URL.replace(/^https?:\/\//, "");
        const wsProtocol = API_URL.startsWith("https") ? "wss" : "ws";
        const gatewayWsUrl = `${wsProtocol}://${apiHost}/ws/admin?deploymentId=${encodeURIComponent(deploymentId)}`;

        const src = `${API_URL}/api/deployments/${deploymentId}/admin/?token=${encodeURIComponent(token)}&gatewayUrl=${encodeURIComponent(gatewayWsUrl)}#token=${gatewayToken}`;

        if (!cancelled) {
          setIframeSrc(src);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError("Failed to authenticate for Control UI.");
          setLoading(false);
        }
      }
    }

    buildSrc();
    return () => { cancelled = true; };
  }, [deploymentId, liveStatus, getAccessTokenSilently]);

  // Listen for postMessages from the iframe (jarble_ui blocks + turn complete)
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!event.data?.type) return;

      if (canvasProtocol && event.data.type === canvasProtocol) {
        const block = event.data.block;
        if (!block?.component) return;

        const uiBlock: UIBlock = {
          id: block.id || nanoid(8),
          component: block.component,
          props: block.props || {},
        };

        setCards((prev) => {
          const idx = prev.findIndex((c) => c.id === uiBlock.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = uiBlock;
            return next;
          }
          return [...prev, uiBlock];
        });

        // Auto-open canvas panel when first component arrives
        setCanvasOpen(true);
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [canvasProtocol]);

  // Handle canvas actions from rendered components (including edit sync)
  const handleCanvasAction = useCallback(
    (action: CanvasAction) => {
      if (!iframeRef.current?.contentWindow) return;

      if (action.action === "content_edit") {
        const content = typeof action.payload?.content === "string" ? action.payload.content : JSON.stringify(action.payload);
        const message = `[EDITING ${action.blockId}]\n${content}\n\nPlease update this component with the changes above.`;
        iframeRef.current.contentWindow.postMessage(
          { type: "jarble:chat_send", message },
          "*",
        );
      }
    },
    [],
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden bg-background">
      {/* Control UI iframe — takes remaining space */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {iframeSrc && (
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            className="flex-1 w-full border-0"
            title="OpenClaw Control UI"
            onLoad={() => setLoading(false)}
          />
        )}
      </div>

      {/* Component count badge — shows when components exist but panel is closed */}
      {cards.length > 0 && !canvasOpen && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setCanvasOpen(true)}
          className="fixed bottom-4 right-4 z-50 gap-1.5 shadow-lg"
        >
          <Layout className="w-4 h-4" />
          {cards.length} component{cards.length !== 1 ? "s" : ""}
        </Button>
      )}

      {/* Floating canvas panel — slides out from right */}
      {canvasOpen && cards.length > 0 && (
        <div className="w-[400px] shrink-0 border-l border-border/60 bg-background flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
            <span className="text-sm font-medium">
              Components ({cards.length})
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCanvasOpen(false)}
              className="h-6 w-6 p-0"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {cards.map((card) => (
              <div
                key={card.id}
                className="rounded-lg border border-border/60 bg-card overflow-hidden"
              >
                <div className="p-3">
                  <CanvasRenderer
                    block={card}
                    onAction={handleCanvasAction}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
