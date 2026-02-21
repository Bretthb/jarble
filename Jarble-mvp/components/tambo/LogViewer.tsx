"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { useLogStream } from "@/hooks/useLogStream";
import { Loader2, Terminal, Pause, Play, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LogViewerProps {
  deploymentId: string;
  initialLogs?: string;
}

export default function LogViewer({
  deploymentId,
  initialLogs,
}: LogViewerProps) {
  const { isAuthenticated } = useAuth0();
  const [useLive, setUseLive] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    lines,
    isConnected,
    isPaused,
    pause,
    resume,
    clear,
    downloadLogs,
  } = useLogStream({
    deploymentId,
    enabled: useLive && isAuthenticated,
    tailLines: 100,
  });

  // Auto-scroll to bottom on new lines
  useEffect(() => {
    if (!isPaused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, isPaused]);

  const displayLines =
    lines.length > 0
      ? lines
      : initialLogs
      ? initialLogs.split("\n").map((text, i) => ({ id: i, text }))
      : [];

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-secondary/30">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs font-semibold">Logs</span>
          {isConnected && (
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={isPaused ? resume : pause}
            className="h-6 w-6 p-0"
            title={isPaused ? "Resume" : "Pause"}
          >
            {isPaused ? (
              <Play className="w-3 h-3" />
            ) : (
              <Pause className="w-3 h-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={clear}
            className="h-6 w-6 p-0"
            title="Clear"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={downloadLogs}
            disabled={displayLines.length === 0}
            className="h-6 w-6 p-0"
            title="Download"
          >
            <Download className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Log content */}
      <div
        ref={scrollRef}
        className="h-64 overflow-y-auto p-3 font-mono text-xs leading-relaxed bg-background/50"
      >
        {displayLines.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            {isConnected ? (
              <span>Waiting for logs...</span>
            ) : (
              <div className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Connecting...</span>
              </div>
            )}
          </div>
        ) : (
          displayLines.map((line) => (
            <div key={line.id} className="hover:bg-secondary/30 px-1 rounded">
              {"timestamp" in line && (line as { timestamp?: string }).timestamp ? (
                <span className="text-muted-foreground mr-2">
                  {new Date((line as { timestamp: string }).timestamp).toLocaleTimeString()}
                </span>
              ) : null}
              <span className="text-foreground">{line.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
