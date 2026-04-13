"use client";

import { useEffect, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";
import { Loader2 } from "lucide-react";

interface ControlPanelProps {
  deploymentId: string;
  liveStatus: string;
}

export default function ControlPanel({ deploymentId, liveStatus }: ControlPanelProps) {
  const { getAccessTokenSilently } = useAuth0();
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

        // 1. Fetch the pod's gateway token from the API
        const tokenRes = await fetch(
          `${API_URL}/api/deployments/${deploymentId}/admin-token`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!tokenRes.ok) throw new Error("Failed to get gateway token");
        const { gatewayToken } = await tokenRes.json();

        // 2. Build the WS proxy URL (for the SPA to connect its WebSocket)
        const apiHost = API_URL.replace(/^https?:\/\//, "");
        const wsProtocol = API_URL.startsWith("https") ? "wss" : "ws";
        const gatewayWsUrl = `${wsProtocol}://${apiHost}/ws/admin?token=${encodeURIComponent(token)}&deploymentId=${encodeURIComponent(deploymentId)}`;

        // 3. Build iframe src: proxy URL + gateway token in hash for auto-connect
        // The hash #token=GATEWAY_TOKEN is the format openclaw dashboard uses
        const src = `${API_URL}/api/deployments/${deploymentId}/admin/?token=${encodeURIComponent(token)}&gatewayUrl=${encodeURIComponent(gatewayWsUrl)}#token=${gatewayToken}`;

        if (!cancelled) {
          setIframeSrc(src);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Failed to authenticate for Control UI.");
          setLoading(false);
        }
      }
    }

    buildSrc();
    return () => { cancelled = true; };
  }, [deploymentId, liveStatus, getAccessTokenSilently]);

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
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {iframeSrc && (
        <iframe
          src={iframeSrc}
          className="flex-1 w-full border-0"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          title="OpenClaw Control UI"
          onLoad={() => setLoading(false)}
        />
      )}
    </div>
  );
}
