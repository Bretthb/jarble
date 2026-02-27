"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";

export interface DiagnosticCheck {
  name: string;
  status: "ok" | "warning" | "error" | "skipped";
  detail: string;
  suggestion?: string;
}

export interface DiagnosticResult {
  deploymentId: string;
  timestamp: string;
  overallHealth: "healthy" | "degraded" | "unhealthy";
  checks: DiagnosticCheck[];
}

export function useDiagnose(deploymentId: string) {
  const { getAccessTokenSilently } = useAuth0();
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const runDiagnosis = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const token = await getAccessTokenSilently();
      const res = await fetch(`${API_URL}/api/deployments/${deploymentId}/diagnose`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: DiagnosticResult = await res.json();
      setResult(data);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [deploymentId, getAccessTokenSilently]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, isLoading, error, runDiagnosis, reset };
}
