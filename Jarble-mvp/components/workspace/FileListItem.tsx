"use client";

import { memo, useState, useCallback, useRef, useEffect } from "react";
import {
  Folder,
  File,
  FileText,
  FileImage,
  FileCode,
  FileArchive,
  MoreVertical,
  Download,
  Pencil,
  Trash2,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FileEntry } from "@/types/files";

/** Guess icon from file extension */
function getFileIcon(name: string, isDirectory: boolean) {
  if (isDirectory) return Folder;
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(ext)) return FileImage;
  if (["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "sh", "json", "yaml", "yml", "toml"].includes(ext)) return FileCode;
  if (["zip", "tar", "gz", "bz2", "7z", "rar"].includes(ext)) return FileArchive;
  if (["md", "txt", "log", "csv", "xml", "html", "css"].includes(ext)) return FileText;
  return File;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileListItemProps {
  entry: FileEntry;
  isSelected: boolean;
  onNavigate: (path: string) => void;
  onToggleSelect: (path: string) => void;
  onDownload: (path: string) => void;
  onDelete: (path: string) => void;
  onRename: (path: string, newName: string) => void;
}

function FileListItemInner({
  entry,
  isSelected,
  onNavigate,
  onToggleSelect,
  onDownload,
  onDelete,
  onRename,
}: FileListItemProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(entry.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const Icon = getFileIcon(entry.name, entry.isDirectory);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      // Select name without extension
      const dotIdx = entry.name.lastIndexOf(".");
      inputRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : entry.name.length);
    }
  }, [isRenaming, entry.name]);

  const handleDoubleClick = useCallback(() => {
    if (entry.isDirectory) {
      onNavigate(entry.path);
    }
  }, [entry, onNavigate]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
        onToggleSelect(entry.path);
      } else if (!entry.isDirectory) {
        onToggleSelect(entry.path);
      }
    },
    [entry, onToggleSelect]
  );

  const handleRenameSubmit = useCallback(() => {
    setIsRenaming(false);
    if (renameValue.trim() && renameValue !== entry.name) {
      onRename(entry.path, renameValue.trim());
    }
  }, [renameValue, entry, onRename]);

  const handleCopyPath = useCallback(() => {
    navigator.clipboard.writeText(entry.path);
  }, [entry.path]);

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer group text-xs",
        "hover:bg-secondary/60 transition-colors",
        isSelected && "bg-primary/10 hover:bg-primary/15"
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {/* Icon */}
      <Icon
        className={cn(
          "w-4 h-4 shrink-0",
          entry.isDirectory ? "text-blue-400" : "text-muted-foreground"
        )}
      />

      {/* Name */}
      {isRenaming ? (
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRenameSubmit();
            if (e.key === "Escape") setIsRenaming(false);
          }}
          className="flex-1 min-w-0 bg-secondary/80 border border-border rounded px-1 py-0.5 text-xs outline-none focus:ring-1 focus:ring-primary/50"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 min-w-0 truncate text-foreground/90">{entry.name}</span>
      )}

      {/* Size */}
      {!entry.isDirectory && (
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {formatSize(entry.size)}
        </span>
      )}

      {/* Actions menu */}
      <DropdownMenu>
        <DropdownMenuTrigger
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-0.5 rounded hover:bg-secondary"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="text-xs w-40">
          {!entry.isDirectory && (
            <DropdownMenuItem onClick={() => onDownload(entry.path)}>
              <Download className="w-3.5 h-3.5 mr-2" />
              Download
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => {
              setRenameValue(entry.name);
              setIsRenaming(true);
            }}
          >
            <Pencil className="w-3.5 h-3.5 mr-2" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCopyPath}>
            <Copy className="w-3.5 h-3.5 mr-2" />
            Copy path
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onDelete(entry.path)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default memo(FileListItemInner);
