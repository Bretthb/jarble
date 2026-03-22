"use client";

/**
 * FilePanel -- slide-out left sidebar for browsing and managing files on the pod PVC.
 * Supports upload (drag-and-drop), download, multi-file ZIP export, mkdir, delete, rename.
 */

import { memo, useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  X,
  FolderOpen,
  ChevronLeft,
  RefreshCw,
  FolderPlus,
  Download,
  Trash2,
  Loader2,
  HardDrive,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useFileBrowser } from "@/hooks/useFileBrowser";
import FileUploadZone from "./FileUploadZone";
import FileListItem from "./FileListItem";
import FileTransferStatus from "./FileTransferStatus";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface FilePanelProps {
  deploymentId: string;
  onClose: () => void;
}

function FilePanelInner({ deploymentId, onClose }: FilePanelProps) {
  const fb = useFileBrowser(deploymentId);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    fb.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateFolder = useCallback(() => {
    if (!newFolderName.trim()) return;
    fb.createDirectory(newFolderName.trim());
    setNewFolderName("");
    setShowNewFolder(false);
  }, [newFolderName, fb]);

  const handleConfirmDelete = useCallback(() => {
    if (deleteTarget) {
      fb.deleteEntry(deleteTarget);
      setDeleteTarget(null);
    }
  }, [deleteTarget, fb]);

  // Breadcrumb segments
  const pathSegments = fb.currentPath.split("/").filter(Boolean);
  const selectedCount = fb.selectedPaths.size;
  const selectedFiles = Array.from(fb.selectedPaths).filter(
    (p) => !fb.entries.find((e) => e.path === p && e.isDirectory)
  );

  return (
    <div className="h-full w-[360px] shrink-0 border-r border-border/60 bg-background flex flex-col relative">
      {/* Left accent line */}
      <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-primary/40 via-primary/20 to-transparent" />

      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-primary/70" />
          <div>
            <span className="text-sm font-semibold text-foreground">Files</span>
            <p className="text-[10px] text-muted-foreground leading-tight">Browse pod filesystem</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Navigation breadcrumb */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border/20 text-xs text-muted-foreground overflow-x-auto">
        <Button
          variant="ghost"
          size="sm"
          onClick={fb.goUp}
          disabled={fb.currentPath === "/data"}
          className="h-6 w-6 p-0 shrink-0"
          title="Go up"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        <HardDrive className="w-3 h-3 shrink-0" />
        {pathSegments.map((seg, i) => {
          const segPath = "/" + pathSegments.slice(0, i + 1).join("/");
          return (
            <span key={segPath} className="flex items-center gap-0.5 shrink-0">
              <span className="text-border">/</span>
              <button
                type="button"
                onClick={() => fb.navigate(segPath)}
                className="hover:text-foreground transition-colors"
              >
                {seg}
              </button>
            </span>
          );
        })}

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowNewFolder(true)}
          className="h-6 w-6 p-0 shrink-0"
          title="New folder"
        >
          <FolderPlus className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={fb.refresh}
          disabled={fb.isLoading}
          className="h-6 w-6 p-0 shrink-0"
          title="Refresh"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", fb.isLoading && "animate-spin")} />
        </Button>
      </div>

      {/* New folder input */}
      {showNewFolder && (
        <div className="px-3 py-2 flex gap-1 border-b border-border/20">
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateFolder();
              if (e.key === "Escape") setShowNewFolder(false);
            }}
            placeholder="Folder name..."
            className="flex-1 bg-secondary/50 border border-border rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-primary/50"
          />
          <Button size="sm" onClick={handleCreateFolder} className="h-6 text-xs px-2">
            Create
          </Button>
        </div>
      )}

      {/* Upload zone */}
      <FileUploadZone onFilesSelected={fb.uploadFiles} />

      {/* Upload progress */}
      {fb.uploadProgress && <FileTransferStatus progress={fb.uploadProgress} />}

      {/* Selection toolbar */}
      {selectedCount > 0 && (
        <div className="mx-3 mb-1 flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">{selectedCount} selected</span>
          <div className="flex-1" />
          {selectedFiles.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fb.downloadArchive(selectedFiles)}
              className="h-6 px-2 text-xs"
              title="Download selected as ZIP"
            >
              <Download className="w-3 h-3 mr-1" />
              ZIP
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={fb.clearSelection}
            className="h-6 px-2 text-xs"
          >
            Clear
          </Button>
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {fb.isLoading && fb.entries.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : fb.entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
            <FolderOpen className="w-8 h-8 opacity-30" />
            <p className="text-xs">This directory is empty</p>
          </div>
        ) : (
          fb.entries.map((entry) => (
            <FileListItem
              key={entry.path}
              entry={entry}
              isSelected={fb.selectedPaths.has(entry.path)}
              onNavigate={fb.navigate}
              onToggleSelect={fb.toggleSelection}
              onDownload={fb.downloadFile}
              onDelete={(path) => setDeleteTarget(path)}
              onRename={fb.renameEntry}
            />
          ))
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-mono text-foreground">
                {deleteTarget?.split("/").pop()}
              </span>
              . This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const FilePanel = memo(FilePanelInner);
export default FilePanel;
