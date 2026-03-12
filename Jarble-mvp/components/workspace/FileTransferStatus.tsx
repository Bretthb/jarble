"use client";

import { Upload } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { TransferProgress } from "@/types/files";

interface FileTransferStatusProps {
  progress: TransferProgress;
}

export default function FileTransferStatus({ progress }: FileTransferStatusProps) {
  return (
    <div className="mx-3 mb-2 p-2 rounded-md bg-primary/5 border border-primary/20">
      <div className="flex items-center gap-2 text-xs mb-1">
        <Upload className="w-3 h-3 text-primary animate-pulse" />
        <span className="truncate flex-1 text-foreground/80">{progress.filename}</span>
        <span className="text-muted-foreground tabular-nums">{progress.percent}%</span>
      </div>
      <Progress value={progress.percent} className="h-1" />
    </div>
  );
}
