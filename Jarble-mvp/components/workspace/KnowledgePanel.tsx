"use client";

/**
 * KnowledgePanel -- slide-out left sidebar for uploading and managing
 * knowledge base documents (RAG). Supports drag-and-drop file upload
 * for .txt, .md, .json, .csv files.
 */

import { memo, useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  X,
  Brain,
  Upload,
  Trash2,
  Loader2,
  FileText,
  FileJson,
  FileSpreadsheet,
  File,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth0 } from "@auth0/auth0-react";
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

// ── Types ────────────────────────────────────────────────────────────────

interface KnowledgeCollection {
  id: string;
  filename: string;
  chunkCount: number;
  uploadedAt: string;
  detectedType: string;
  fileSize: number;
}

interface KnowledgePanelProps {
  deploymentId: string;
  onClose: () => void;
}

// ── Accepted file extensions ─────────────────────────────────────────────

const ACCEPTED_EXTENSIONS = [".txt", ".md", ".markdown", ".json", ".csv"];
const ACCEPT_STRING = ACCEPTED_EXTENSIONS.join(",");
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function getFileIcon(type: string) {
  switch (type) {
    case "json":
      return <FileJson className="w-4 h-4 text-amber-500" />;
    case "csv":
      return <FileSpreadsheet className="w-4 h-4 text-green-500" />;
    case "markdown":
      return <FileText className="w-4 h-4 text-blue-500" />;
    default:
      return <File className="w-4 h-4 text-muted-foreground" />;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

// ── Component ────────────────────────────────────────────────────────────

function KnowledgePanelInner({ deploymentId, onClose }: KnowledgePanelProps) {
  const { getAccessTokenSilently } = useAuth0();
  const [collections, setCollections] = useState<KnowledgeCollection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeCollection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

  // ── Fetch collections ──────────────────────────────────────────────────

  const fetchCollections = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = await getAccessTokenSilently();
      const res = await fetch(
        `${apiUrl}/api/deployments/${deploymentId}/knowledge/collections`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setCollections(data.collections || []);
      }
    } catch (err) {
      console.error("[Knowledge] Failed to fetch collections:", err);
    } finally {
      setIsLoading(false);
    }
  }, [deploymentId, getAccessTokenSilently, apiUrl]);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  // ── Upload file ────────────────────────────────────────────────────────

  const uploadFile = useCallback(
    async (file: globalThis.File) => {
      setUploadError(null);

      // Validate extension
      const ext = "." + (file.name.split(".").pop()?.toLowerCase() || "");
      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        setUploadError(`Unsupported file type: ${ext}. Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}`);
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        setUploadError(`File too large (${formatFileSize(file.size)}). Maximum: ${formatFileSize(MAX_FILE_SIZE)}`);
        return;
      }

      setIsUploading(true);
      try {
        const content = await file.text();
        const token = await getAccessTokenSilently();
        const res = await fetch(
          `${apiUrl}/api/deployments/${deploymentId}/knowledge/ingest`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ content, filename: file.name }),
          }
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Upload failed" }));
          setUploadError(err.error || "Upload failed");
          return;
        }

        // Refresh the list
        await fetchCollections();
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setIsUploading(false);
      }
    },
    [deploymentId, getAccessTokenSilently, apiUrl, fetchCollections]
  );

  // ── Delete collection ──────────────────────────────────────────────────

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      const token = await getAccessTokenSilently();
      await fetch(
        `${apiUrl}/api/deployments/${deploymentId}/knowledge/collections/${deleteTarget.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      setCollections((prev) => prev.filter((c) => c.id !== deleteTarget.id));
    } catch (err) {
      console.error("[Knowledge] Failed to delete:", err);
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, deploymentId, getAccessTokenSilently, apiUrl]);

  // ── Drag and drop handlers ─────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        uploadFile(files[0]);
      }
    },
    [uploadFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        uploadFile(files[0]);
      }
      // Reset input so the same file can be re-selected
      e.target.value = "";
    },
    [uploadFile]
  );

  return (
    <div className="h-full w-[360px] shrink-0 border-r border-border/60 bg-background flex flex-col relative">
      {/* Left accent line */}
      <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-primary/40 via-primary/20 to-transparent" />

      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary/70" />
          <div>
            <span className="text-sm font-semibold text-foreground">Knowledge Base</span>
            <p className="text-[10px] text-muted-foreground leading-tight">Upload documents for RAG</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Upload zone */}
      <div
        className={cn(
          "mx-3 mt-3 mb-2 rounded-lg border-2 border-dashed transition-colors cursor-pointer",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border/60 hover:border-border hover:bg-secondary/30",
          isUploading && "opacity-50 pointer-events-none"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="flex flex-col items-center gap-1.5 py-4 px-3">
          {isUploading ? (
            <>
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <p className="text-xs text-muted-foreground">Processing document...</p>
            </>
          ) : (
            <>
              <Upload className="w-6 h-6 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground text-center">
                Drag & drop or click to upload
              </p>
              <p className="text-[10px] text-muted-foreground/60">
                .txt, .md, .json, .csv (max 5MB)
              </p>
            </>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_STRING}
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Upload error */}
      {uploadError && (
        <div className="mx-3 mb-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20">
          <p className="text-xs text-destructive">{uploadError}</p>
        </div>
      )}

      {/* Collections list */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : collections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
            <Brain className="w-8 h-8 opacity-30" />
            <p className="text-xs text-center px-4">
              Upload documents to give your agent knowledge
            </p>
            <p className="text-[10px] text-muted-foreground/60 text-center px-4">
              Your agent will search these documents when answering questions
            </p>
          </div>
        ) : (
          collections.map((collection) => (
            <div
              key={collection.id}
              className="flex items-start gap-2.5 px-3 py-2.5 mx-1 rounded-md hover:bg-secondary/40 transition-colors group"
            >
              <div className="mt-0.5 shrink-0">
                {getFileIcon(collection.detectedType)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {collection.filename}
                </p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  {collection.chunkCount} chunks &middot; {formatFileSize(collection.fileSize)} &middot; {formatDate(collection.uploadedAt)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteTarget(collection)}
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                title="Delete collection"
              >
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Footer info */}
      {collections.length > 0 && (
        <div className="px-4 py-2 border-t border-border/20 text-[10px] text-muted-foreground/60">
          {collections.length} document{collections.length !== 1 ? "s" : ""} &middot;{" "}
          {collections.reduce((sum, c) => sum + c.chunkCount, 0)} total chunks
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete knowledge document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-mono text-foreground">
                {deleteTarget?.filename}
              </span>{" "}
              and all its chunks from the knowledge base. Your agent will no longer be able to search this document.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const KnowledgePanel = memo(KnowledgePanelInner);
export default KnowledgePanel;
