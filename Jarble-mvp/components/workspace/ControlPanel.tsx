"use client";

/**
 * ControlPanel — Embeds the OpenClaw Control UI in an auto-authenticated iframe.
 *
 * The iframe loads via the API's HTTP proxy at /api/deployments/:id/admin/
 * which serves the Control UI SPA from the pod. The SPA connects its WS
 * to our proxy at /ws/admin, which pipes to the pod's gateway.
 *
 * This replaces ConfigPanel by exposing OpenClaw's full admin interface:
 * config editor, channel management, sessions, cron jobs, skills, agents.
 */

import { useState, useEffect } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";
import { Loader2, AlertCircle } from "lucide-react";

interface ControlPanelProps {
  deploymentId: string;
  liveStatus: string;
}

export default function ControlPanel({ deploymentId, liveStatus }: ControlPanelProps) {
  const { getAccessTokenSilently } = useAuth0();
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isRunning = liveStatus === "running";

  // Build the iframe URL with auto-auth
  useEffect(() => {
    if (!isRunning) return;

    let cancelled = false;

    (async () => {
      try {
        const token = await getAccessTokenSilently();
        if (cancelled) return;

        // The WS proxy URL — the Control UI SPA will connect its WebSocket here
        const wsProtocol = API_URL.startsWith("https") ? "wss" : "ws";
        const apiHost = API_URL.replace(/^https?:\/\//, "");
        const gatewayUrl = `${wsProtocol}://${apiHost}/ws/admin?token=${encodeURIComponent(token)}&deploymentId=${encodeURIComponent(deploymentId)}`;

        // The HTTP proxy serves the Control UI SPA with auto-connect params
        // token= authenticates with our proxy; gatewayUrl= tells the SPA where to open its WS
        const src = `${API_URL}/api/deployments/${deploymentId}/admin/?token=${encodeURIComponent(token)}&gatewayUrl=${encodeURIComponent(gatewayUrl)}`;
        setIframeSrc(src);
      } catch {
        if (!cancelled) {
          setError("Failed to authenticate for Control UI");
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [deploymentId, isRunning, getAccessTokenSilently]);

  if (!isRunning) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/30">
        <div className="text-center space-y-2">
          <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">
            Start the deployment to access the Control UI
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
          <div className="text-center space-y-2">
            <Loader2 className="w-6 h-6 text-primary animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground">Loading Control UI...</p>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
          <div className="text-center space-y-2">
            <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        </div>
      )}
      {iframeSrc && (
        <iframe
          src={iframeSrc}
          className="w-full h-full border-0"
          onLoad={() => setLoading(false)}
          onError={() => {
            setError("Failed to load Control UI");
            setLoading(false);
          }}
          allow="clipboard-write"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
          title="OpenClaw Control UI"
        />
      )}
    </div>
  );
}
