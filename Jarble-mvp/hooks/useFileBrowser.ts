"use client";

import { useState, useCallback, useRef } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";
import { toast } from "sonner";
import type { FileEntry, TransferProgress } from "@/types/files";

export interface UseFileBrowserReturn {
  entries: FileEntry[];
  currentPath: string;
  isLoading: boolean;
  navigate: (path: string) => void;
  goUp: () => void;
  refresh: () => void;
  uploadFiles: (files: FileList) => Promise<void>;
  downloadFile: (path: string) => Promise<void>;
  downloadArchive: (paths: string[]) => Promise<void>;
  createDirectory: (name: string) => Promise<void>;
  deleteEntry: (path: string) => Promise<void>;
  renameEntry: (oldPath: string, newName: string) => Promise<void>;
  uploadProgress: TransferProgress | null;
  selectedPaths: Set<string>;
  toggleSelection: (path: string) => void;
  clearSelection: () => void;
  selectAll: () => void;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function useFileBrowser(
  deploymentId: string,
  basePath: string = "/data"
): UseFileBrowserReturn {
  const { getAccessTokenSilently } = useAuth0();
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [currentPath, setCurrentPath] = useState(basePath);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<TransferProgress | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const getToken = useCallback(async () => {
    try {
      return await getAccessTokenSilently();
    } catch {
      toast.error("Authentication failed");
      return null;
    }
  }, [getAccessTokenSilently]);

  const fetchEntries = useCallback(
    async (path: string) => {
      const token = await getToken();
      if (!token) return;

      setIsLoading(true);
      try {
        const res = await fetch(
          `${API_URL}/api/deployments/${deploymentId}/files/list?path=${encodeURIComponent(path)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Unknown error" }));
          toast.error(data.error || "Failed to list files");
          return;
        }
        const data = await res.json();
        setEntries(data.entries || []);
        setSelectedPaths(new Set());
      } catch {
        toast.error("Failed to connect to server");
      } finally {
        setIsLoading(false);
      }
    },
    [deploymentId, getToken]
  );

  const navigate = useCallback(
    (path: string) => {
      setCurrentPath(path);
      fetchEntries(path);
    },
    [fetchEntries]
  );

  const goUp = useCallback(() => {
    if (currentPath === basePath) return;
    const parent = currentPath.substring(0, currentPath.lastIndexOf("/")) || basePath;
    navigate(parent);
  }, [currentPath, basePath, navigate]);

  const refresh = useCallback(() => {
    fetchEntries(currentPath);
  }, [currentPath, fetchEntries]);

  const uploadFiles = useCallback(
    async (files: FileList) => {
      const token = await getToken();
      if (!token) return;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > 50 * 1024 * 1024) {
          toast.error(`${file.name} exceeds 50MB limit`);
          continue;
        }
        if (file.size > 20 * 1024 * 1024) {
          toast("Large file — this may take a while", { description: file.name });
        }

        const formData = new FormData();
        formData.append("file", file);
        formData.append("path", currentPath);

        try {
          // Use XMLHttpRequest for upload progress
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", `${API_URL}/api/deployments/${deploymentId}/files/upload`);
            xhr.setRequestHeader("Authorization", `Bearer ${token}`);

            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                setUploadProgress({
                  filename: file.name,
                  loaded: e.loaded,
                  total: e.total,
                  percent: Math.round((e.loaded / e.total) * 100),
                });
              }
            };

            xhr.onload = () => {
              setUploadProgress(null);
              if (xhr.status >= 200 && xhr.status < 300) {
                toast.success(`Uploaded ${file.name}`);
                resolve();
              } else {
                try {
                  const data = JSON.parse(xhr.responseText);
                  toast.error(data.error || `Upload failed: ${file.name}`);
                } catch {
                  toast.error(`Upload failed: ${file.name}`);
                }
                reject(new Error("Upload failed"));
              }
            };

            xhr.onerror = () => {
              setUploadProgress(null);
              toast.error(`Upload failed: ${file.name}`);
              reject(new Error("Upload error"));
            };

            xhr.send(formData);
          });
        } catch {
          // Error already toasted
        }
      }

      refresh();
    },
    [deploymentId, currentPath, getToken, refresh]
  );

  const downloadFile = useCallback(
    async (path: string) => {
      const token = await getToken();
      if (!token) return;

      try {
        const res = await fetch(
          `${API_URL}/api/deployments/${deploymentId}/files/download?path=${encodeURIComponent(path)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Download failed" }));
          toast.error(data.error || "Download failed");
          return;
        }

        const blob = await res.blob();
        const filename = path.split("/").pop() || "download";
        downloadBlob(blob, filename);
        toast.success(`Downloaded ${filename}`);
      } catch {
        toast.error("Download failed");
      }
    },
    [deploymentId, getToken]
  );

  const downloadArchive = useCallback(
    async (paths: string[]) => {
      const token = await getToken();
      if (!token) return;

      try {
        const res = await fetch(
          `${API_URL}/api/deployments/${deploymentId}/files/download-archive`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ paths }),
          }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Archive failed" }));
          toast.error(data.error || "Archive failed");
          return;
        }

        const blob = await res.blob();
        downloadBlob(blob, `files-${deploymentId}.zip`);
        toast.success(`Downloaded ${paths.length} files as ZIP`);
      } catch {
        toast.error("Archive download failed");
      }
    },
    [deploymentId, getToken]
  );

  const createDirectory = useCallback(
    async (name: string) => {
      const token = await getToken();
      if (!token) return;

      try {
        const res = await fetch(
          `${API_URL}/api/deployments/${deploymentId}/files/mkdir`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ path: `${currentPath}/${name}` }),
          }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Failed to create folder" }));
          toast.error(data.error || "Failed to create folder");
          return;
        }
        toast.success(`Created folder "${name}"`);
        refresh();
      } catch {
        toast.error("Failed to create folder");
      }
    },
    [deploymentId, currentPath, getToken, refresh]
  );

  const deleteEntry = useCallback(
    async (path: string) => {
      const token = await getToken();
      if (!token) return;

      try {
        const res = await fetch(
          `${API_URL}/api/deployments/${deploymentId}/files?path=${encodeURIComponent(path)}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Delete failed" }));
          toast.error(data.error || "Delete failed");
          return;
        }
        const name = path.split("/").pop() || "item";
        toast.success(`Deleted "${name}"`);
        refresh();
      } catch {
        toast.error("Delete failed");
      }
    },
    [deploymentId, getToken, refresh]
  );

  const renameEntry = useCallback(
    async (oldPath: string, newName: string) => {
      const token = await getToken();
      if (!token) return;

      const dir = oldPath.substring(0, oldPath.lastIndexOf("/"));
      const newPath = `${dir}/${newName}`;

      try {
        const res = await fetch(
          `${API_URL}/api/deployments/${deploymentId}/files/move`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ from: oldPath, to: newPath }),
          }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Rename failed" }));
          toast.error(data.error || "Rename failed");
          return;
        }
        toast.success(`Renamed to "${newName}"`);
        refresh();
      } catch {
        toast.error("Rename failed");
      }
    },
    [deploymentId, getToken, refresh]
  );

  const toggleSelection = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelectedPaths(new Set(entries.map((e) => e.path)));
  }, [entries]);

  return {
    entries,
    currentPath,
    isLoading,
    navigate,
    goUp,
    refresh,
    uploadFiles,
    downloadFile,
    downloadArchive,
    createDirectory,
    deleteEntry,
    renameEntry,
    uploadProgress,
    selectedPaths,
    toggleSelection,
    clearSelection,
    selectAll,
  };
}
