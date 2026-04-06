"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useTerminal } from "@/hooks/useTerminal";
import { Button } from "@/components/ui/button";
import { Loader2, PlugZap, Unplug, AlertCircle } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

interface TerminalPanelProps {
  deploymentId: string;
}

export default function TerminalPanel({ deploymentId }: TerminalPanelProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [initialized, setInitialized] = useState(false);

  const handleOutput = useCallback((data: string) => {
    xtermRef.current?.write(data);
  }, []);

  const handleConnected = useCallback((_podName: string) => {
    // Welcome message is printed by the shell init script on the pod
  }, []);

  const handleDisconnected = useCallback(() => {
    xtermRef.current?.writeln("\r\n\x1b[31mSession ended\x1b[0m");
  }, []);

  const { connect, disconnect, sendInput, isConnected, isConnecting, error } = useTerminal({
    deploymentId,
    onOutput: handleOutput,
    onConnected: handleConnected,
    onDisconnected: handleDisconnected,
  });

  // Initialize xterm.js
  useEffect(() => {
    if (!termRef.current || initialized) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: {
        background: "#0e0e1a",
        foreground: "#f0e6d2",
        cursor: "#d4a574",
        selectionBackground: "#1a1a28",
        black: "#1a1a2e",
        red: "#ff6b6b",
        green: "#69db7c",
        yellow: "#ffd43b",
        blue: "#74c0fc",
        magenta: "#da77f2",
        cyan: "#66d9e8",
        white: "#e0e0e0",
        brightBlack: "#4a4a6a",
        brightRed: "#ff8787",
        brightGreen: "#8ce99a",
        brightYellow: "#ffe066",
        brightBlue: "#a5d8ff",
        brightMagenta: "#e599f7",
        brightCyan: "#99e9f2",
        brightWhite: "#ffffff",
      },
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(termRef.current);

    // Slight delay to ensure container is sized
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;
    setInitialized(true);

    // Handle user input
    term.onData((data) => {
      sendInput(data);
    });

    return () => {
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      setInitialized(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle resize - debounced to avoid thrashing during CSS transitions
  useEffect(() => {
    if (!fitAddonRef.current || !termRef.current) return;

    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        try {
          fitAddonRef.current?.fit();
        } catch {
          // Ignore fit errors during rapid resizing
        }
      });
    });

    observer.observe(termRef.current);

    return () => {
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [initialized]);

  // Auto-connect on mount
  useEffect(() => {
    if (initialized && !isConnected && !isConnecting) {
      connect();
    }
  }, [initialized]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full">
      {/* Terminal toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30 bg-[#0e0e1a]">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected ? "bg-green-500" : isConnecting ? "bg-yellow-500 animate-pulse" : "bg-red-500"
            }`}
          />
          <span className="text-[11px] text-neutral-400 font-mono">
            {isConnected ? "openclaw" : isConnecting ? "connecting..." : "disconnected"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {!isConnected && !isConnecting && (
            <Button
              variant="ghost"
              size="sm"
              onClick={connect}
              className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <PlugZap className="w-3 h-3 mr-1" />
              Connect
            </Button>
          )}
          {isConnected && (
            <Button
              variant="ghost"
              size="sm"
              onClick={disconnect}
              className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <Unplug className="w-3 h-3 mr-1" />
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-950/50 border-b border-red-900/50 text-red-400 text-xs">
          <AlertCircle className="w-3 h-3 shrink-0" />
          {error}
        </div>
      )}

      {/* Terminal container - extra wrapper creates inset so xterm doesn't touch edges */}
      <div className="flex-1 relative min-h-0 overflow-hidden bg-[#0e0e1a]">
        {isConnecting && !initialized && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0e0e1a] z-10">
            <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
          </div>
        )}
        <div className="absolute top-1 bottom-0 left-4 right-2 overflow-hidden">
          <div ref={termRef} className="h-full w-full" />
        </div>
      </div>
    </div>
  );
}
