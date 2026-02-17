"use client";

import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Pause,
  Play,
  Trash2,
  Download,
  Wifi,
  WifiOff,
  ArrowDown,
  Terminal,
} from "lucide-react";
import { useLogStream } from "@/hooks/useLogStream";

interface LogsTabProps {
  deploymentId: string;
  deploymentStatus: string | undefined;
}

export function LogsTab({ deploymentId, deploymentStatus }: LogsTabProps) {
  const isRunning = deploymentStatus === "running";
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const {
    lines,
    isConnected,
    isPaused,
    error,
    pause,
    resume,
    clear,
    downloadLogs,
  } = useLogStream({
    deploymentId,
    enabled: isRunning,
    tailLines: 200,
    maxLines: 5000,
  });

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  // Detect user scrolling up to disable auto-scroll
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  if (!isRunning) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold mb-1">Logs</h2>
          <p className="text-muted-foreground text-sm">
            Real-time logs from your deployment
          </p>
        </div>
        <div className="flex flex-col items-center justify-center h-64 rounded-lg bg-secondary/30 border border-border/60 gap-3">
          <Terminal className="w-8 h-8 text-muted-foreground/40" />
          <p className="text-muted-foreground text-sm">
            Logs are available when the deployment is running
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold mb-1">Logs</h2>
          <p className="text-muted-foreground text-sm">
            Real-time logs from your deployment
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Connection indicator */}
          <span
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${
              isConnected
                ? "bg-primary/10 text-primary"
                : "bg-secondary text-muted-foreground"
            }`}
          >
            {isConnected ? (
              <>
                <Wifi className="w-3 h-3" /> Live
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3" /> Disconnected
              </>
            )}
          </span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={isPaused ? resume : pause}
          className="h-7 text-xs border-border"
        >
          {isPaused ? (
            <>
              <Play className="w-3 h-3 mr-1" /> Resume
            </>
          ) : (
            <>
              <Pause className="w-3 h-3 mr-1" /> Pause
            </>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={clear}
          className="h-7 text-xs border-border"
        >
          <Trash2 className="w-3 h-3 mr-1" /> Clear
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={downloadLogs}
          disabled={lines.length === 0}
          className="h-7 text-xs border-border"
        >
          <Download className="w-3 h-3 mr-1" /> Download
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {lines.length.toLocaleString()} lines
        </span>
      </div>

      {/* Error banner */}
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Log output */}
      <div className="relative">
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="h-[500px] overflow-y-auto rounded-lg bg-[#0d1117] border border-border/60 font-mono text-[13px] leading-5 text-[#c9d1d9] p-4 selection:bg-primary/30"
        >
          {lines.length === 0 ? (
            <span className="text-[#484f58]">Waiting for logs...</span>
          ) : (
            lines.map((line) => (
              <div key={line.id} className="whitespace-pre-wrap break-all">
                {line.timestamp && (
                  <span className="text-[#484f58] mr-2 select-none">
                    {new Date(line.timestamp).toLocaleTimeString()}
                  </span>
                )}
                <span>{line.text}</span>
              </div>
            ))
          )}
        </div>

        {/* Scroll to bottom button */}
        {!autoScroll && (
          <button
            onClick={() => {
              setAutoScroll(true);
              if (containerRef.current) {
                containerRef.current.scrollTop =
                  containerRef.current.scrollHeight;
              }
            }}
            className="absolute bottom-3 right-3 bg-primary text-primary-foreground px-3 py-1.5 rounded-full text-xs font-medium shadow-lg hover:bg-primary/90 transition-colors flex items-center gap-1"
          >
            <ArrowDown className="w-3 h-3" />
            Scroll to bottom
          </button>
        )}
      </div>
    </div>
  );
}
