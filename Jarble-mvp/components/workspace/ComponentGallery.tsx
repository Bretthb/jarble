"use client";

/**
 * ComponentGallery — collapsible panel showing saved components.
 *
 * Fetches the list from the pod via list_canvas_files, displays them
 * as clickable cards, and loads them onto the canvas on click.
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc, API_URL } from "@/lib/trpc";
import { Package, Loader2, Trash2, Plus, RefreshCw, ChevronDown, ChevronRight, Store } from "lucide-react";
import { toast } from "sonner";
import type { CanvasCard, CanvasAction } from "./types";
import { DEFAULT_CARD_SIZES, DEFAULT_CARD_SIZE } from "./types";

interface SavedComponent {
  fileId: string;
  component: string;
  name: string;
  description: string;
  tags: string[];
  savedAt: string | null;
}

interface ComponentGalleryProps {
  deploymentId: string;
  cards: CanvasCard[];
  dispatch: React.Dispatch<CanvasAction>;
  /** Incremented each time an unsave happens — triggers gallery refetch */
  refetchTrigger?: number;
}

interface MarketplaceInstall {
  installId: string;
  installedAt: string;
  version: string | null;
  component: {
    id: string;
    name: string;
    displayName: string;
    description: string;
    tier: string;
    category: string;
  };
}

/** Tier → short label for the badge */
const TIER_LABELS: Record<string, string> = {
  template: "Template",
  sandbox: "Sandbox",
  code: "Code",
};

/** Component type → short label for the badge */
const COMPONENT_LABELS: Record<string, string> = {
  sandbox: "Sandbox",
  data_table: "Table",
  chart: "Chart",
  spreadsheet: "Sheet",
  code_editor: "Code",
  card: "Card",
  stat_grid: "Stats",
  form: "Form",
  button_group: "Buttons",
  image: "Image",
  list: "List",
  tabs: "Tabs",
};

function ComponentGalleryInner({ deploymentId, cards, dispatch, refetchTrigger }: ComponentGalleryProps) {
  const { getAccessTokenSilently } = useAuth0();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SavedComponent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasFetched = useRef(false);

  // Fetch installed marketplace components
  const { data: marketplaceItems = [], isLoading: marketplaceLoading } =
    trpc.marketplace.listInstalled.useQuery(
      { deploymentId },
      { enabled: open },
    ) as { data: MarketplaceInstall[]; isLoading: boolean };

  const fetchGallery = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessTokenSilently();
      // Try JSON format first, fall back to no-args if pod has old MCP server
      let res = await fetch(`${API_URL}/api/deployments/${deploymentId}/mcp/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tool: "list_canvas_files", args: { format: "json" } }),
      });

      // If JSON format fails (old MCP server), retry without format arg
      if (!res.ok) {
        res = await fetch(`${API_URL}/api/deployments/${deploymentId}/mcp/invoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tool: "list_canvas_files", args: {} }),
        });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const text: string = data.result?.text || "";

      // Try parsing as JSON array first (new format)
      try {
        const parsed: SavedComponent[] = JSON.parse(text);
        if (Array.isArray(parsed)) { setItems(parsed); return; }
      } catch { /* not JSON, parse markdown below */ }

      // Fall back to parsing markdown: - **Name** (`fileId`) — component...
      if (text.includes("No saved components") || text.includes("No saved artifacts") || !text.includes("**")) {
        setItems([]);
        return;
      }
      const parsed: SavedComponent[] = [];
      for (const line of text.split("\n")) {
        const match = line.match(/^- \*\*(.+?)\*\* \(`(.+?)`\) — (\w+)/);
        if (match) {
          const [, name, fileId, component] = match;
          const descMatch = line.match(/— \w+: (.+?)(?:\s*\[|$)/);
          const tagMatch = line.match(/\[([^\]]+)\]/);
          const dateMatch = line.match(/_\((?:saved|updated) (.+?)\)_/);
          parsed.push({
            fileId, component, name,
            description: descMatch?.[1]?.trim() || "",
            tags: tagMatch ? tagMatch[1].split(", ") : [],
            savedAt: dateMatch?.[1] || null,
          });
        }
      }
      setItems(parsed);
    } catch (err) {
      console.error("[Jarble:Gallery] Failed to fetch:", err);
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [deploymentId, getAccessTokenSilently]);

  // Fetch when first opened
  useEffect(() => {
    if (open && !hasFetched.current) {
      hasFetched.current = true;
      fetchGallery();
    }
  }, [open, fetchGallery]);

  // Refetch gallery when an unsave happens (refetchTrigger increments)
  useEffect(() => {
    if (refetchTrigger && refetchTrigger > 0) {
      fetchGallery();
    }
  }, [refetchTrigger, fetchGallery]);

  const handleLoad = useCallback(async (item: SavedComponent) => {
    setLoadingId(item.fileId);
    try {
      const token = await getAccessTokenSilently();
      const res = await fetch(`${API_URL}/api/deployments/${deploymentId}/mcp/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tool: "load_canvas_file", args: { fileId: item.fileId } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.result?.isError) throw new Error(data.result.text);

      const fileData = JSON.parse(data.result.text);
      const size = DEFAULT_CARD_SIZES[fileData.component] || DEFAULT_CARD_SIZE;

      // Find a position that doesn't overlap existing cards
      const existingPositions = cards.map(c => ({ x: c.position.x, y: c.position.y, w: c.size.width, h: c.size.height }));
      let x = 60, y = 60;
      // Simple cascade: offset from last card
      if (existingPositions.length > 0) {
        const last = existingPositions[existingPositions.length - 1];
        x = last.x + 40;
        y = last.y + 40;
      }

      const card: CanvasCard = {
        id: `card-gallery-${Date.now()}`,
        component: fileData.component,
        props: fileData.props || {},
        position: { x, y },
        size,
        zIndex: 0,
        minimized: false,
        createdAt: Date.now(),
        title: fileData.name || item.name,
        savedName: item.name,
        fileId: item.fileId,
      };

      dispatch({ type: "ADD_CARD", card });
      dispatch({ type: "BRING_TO_FRONT", id: card.id });
    } catch (err) {
      console.error("[Jarble:Gallery] Failed to load component:", err);
      toast.error("Failed to load component");
    } finally {
      setLoadingId(null);
    }
  }, [deploymentId, getAccessTokenSilently, cards, dispatch]);

  const handleDelete = useCallback(async (item: SavedComponent) => {
    setDeletingId(item.fileId);
    try {
      const token = await getAccessTokenSilently();
      const res = await fetch(`${API_URL}/api/deployments/${deploymentId}/mcp/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tool: "delete_canvas_file", args: { fileId: item.fileId } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Remove from local state
      setItems(prev => prev.filter(i => i.fileId !== item.fileId));
    } catch (err) {
      console.error("[Jarble:Gallery] Failed to delete:", err);
      toast.error("Failed to delete component");
    } finally {
      setDeletingId(null);
    }
  }, [deploymentId, getAccessTokenSilently]);

  const handleLoadMarketplace = useCallback((item: MarketplaceInstall) => {
    const size = DEFAULT_CARD_SIZES[item.component.name] || DEFAULT_CARD_SIZE;

    // Find a position that doesn't overlap existing cards
    const existingPositions = cards.map(c => ({ x: c.position.x, y: c.position.y, w: c.size.width, h: c.size.height }));
    let x = 60, y = 60;
    if (existingPositions.length > 0) {
      const last = existingPositions[existingPositions.length - 1];
      x = last.x + 40;
      y = last.y + 40;
    }

    const card: CanvasCard = {
      id: `card-marketplace-${Date.now()}`,
      component: item.component.name,
      props: {},
      position: { x, y },
      size,
      zIndex: 0,
      minimized: false,
      createdAt: Date.now(),
      title: item.component.displayName,
    };

    dispatch({ type: "ADD_CARD", card });
    dispatch({ type: "BRING_TO_FRONT", id: card.id });
    toast.success(`Added "${item.component.displayName}" to canvas`);
  }, [cards, dispatch]);

  const hasSavedItems = items.length > 0;
  const hasMarketplaceItems = marketplaceItems.length > 0;
  const totalCount = items.length + marketplaceItems.length;
  const bothEmpty = !loading && !marketplaceLoading && !error && !hasSavedItems && !hasMarketplaceItems;

  return (
    <div className="shrink-0">
      {/* Toggle button */}
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
          open
            ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
        }`}
        title="Component Gallery"
      >
        <Package className="w-3.5 h-3.5" />
        Library
        {totalCount > 0 && (
          <span className="ml-0.5 px-1 rounded-full bg-amber-500/30 text-[10px] font-medium">{totalCount}</span>
        )}
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {/* Gallery panel */}
      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 z-30 max-h-[300px] overflow-auto bg-background/95 backdrop-blur-sm border border-border/60 rounded-lg shadow-xl">
          {/* Header */}
          <div className="sticky top-0 flex items-center justify-between px-3 py-2 border-b border-border/40 bg-background/95 backdrop-blur-sm">
            <span className="text-xs font-medium text-foreground">Component Library</span>
            <button
              onClick={() => fetchGallery()}
              disabled={loading}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              aria-label="Refresh gallery"
              title="Refresh"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Content */}
          <div className="p-2">
            {/* Combined loading state */}
            {loading && items.length === 0 && marketplaceItems.length === 0 && (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                <span className="text-xs">Loading gallery...</span>
              </div>
            )}

            {error && (
              <div className="text-xs text-red-400 px-2 py-3 text-center">{error}</div>
            )}

            {/* Combined empty state */}
            {bothEmpty && (
              <div className="text-xs text-muted-foreground px-2 py-6 text-center">
                No components yet. Use the bookmark button on any card to save it, or install components from the marketplace.
              </div>
            )}

            {/* ── Saved Components Section ── */}
            {hasSavedItems && (
              <>
                <div className="flex items-center gap-1.5 px-1 pb-1.5">
                  <Package className="w-3 h-3 text-amber-400" />
                  <span className="text-[10px] font-medium text-amber-400 uppercase tracking-wide">Saved Components</span>
                  <span className="text-[10px] text-muted-foreground-subtle">({items.length})</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                  {items.map(item => (
                    <div
                      key={item.fileId}
                      role="button"
                      tabIndex={0}
                      className="group relative flex flex-col gap-1 p-2 rounded-md border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 hover:border-amber-500/40 transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                      onClick={() => handleLoad(item)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), handleLoad(item))}
                      title={`Load "${item.name}" onto canvas`}
                    >
                      {/* Component type badge */}
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400/80 self-start truncate max-w-full">
                        {COMPONENT_LABELS[item.component] || item.component}
                      </span>

                      {/* Name */}
                      <span className="text-[11px] font-medium text-foreground truncate">{item.name}</span>

                      {/* Description (if any) */}
                      {item.description && (
                        <span className="text-[9px] text-muted-foreground truncate">{item.description}</span>
                      )}

                      {/* Date */}
                      {item.savedAt && (
                        <span className="text-[9px] text-muted-foreground-subtle">{item.savedAt}</span>
                      )}

                      {/* Loading overlay */}
                      {loadingId === item.fileId && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-md">
                          <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                        </div>
                      )}

                      {/* Delete button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
                        className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-all"
                        aria-label={`Delete ${item.name} from library`}
                        title="Delete from library"
                      >
                        {deletingId === item.fileId ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                      </button>

                      {/* Add icon overlay */}
                      <div className="absolute bottom-1 right-1 w-5 h-5 flex items-center justify-center rounded-full bg-amber-500/20 text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Plus className="w-3 h-3" />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ── Marketplace Section ── */}
            {(hasMarketplaceItems || marketplaceLoading) && (
              <>
                {hasSavedItems && <div className="my-2 border-t border-border/30" />}
                <div className="flex items-center gap-1.5 px-1 pb-1.5">
                  <Store className="w-3 h-3 text-indigo-400" />
                  <span className="text-[10px] font-medium text-indigo-400 uppercase tracking-wide">Marketplace</span>
                  {hasMarketplaceItems && (
                    <span className="text-[10px] text-muted-foreground-subtle">({marketplaceItems.length})</span>
                  )}
                </div>

                {marketplaceLoading && !hasMarketplaceItems && (
                  <div className="flex items-center justify-center py-4 text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    <span className="text-[10px]">Loading marketplace...</span>
                  </div>
                )}

                {hasMarketplaceItems && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                    {marketplaceItems.map(item => (
                      <div
                        key={item.installId}
                        role="button"
                        tabIndex={0}
                        className="group relative flex flex-col gap-1 p-2 rounded-md border border-indigo-500/20 bg-indigo-500/5 hover:bg-indigo-500/10 hover:border-indigo-500/40 transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                        onClick={() => handleLoadMarketplace(item)}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), handleLoadMarketplace(item))}
                        title={`Add "${item.component.displayName}" to canvas`}
                      >
                        {/* Tier + Category badges */}
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400/80 truncate">
                            {TIER_LABELS[item.component.tier] || item.component.tier}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-secondary/40 text-muted-foreground truncate">
                            {item.component.category}
                          </span>
                        </div>

                        {/* Display name */}
                        <span className="text-[11px] font-medium text-foreground truncate">{item.component.displayName}</span>

                        {/* Description */}
                        {item.component.description && (
                          <span className="text-[9px] text-muted-foreground truncate">{item.component.description}</span>
                        )}

                        {/* Marketplace badge */}
                        <span className="text-[8px] font-medium px-1 py-0.5 rounded bg-indigo-500/15 text-indigo-400/70 self-start">
                          Marketplace
                        </span>

                        {/* Add icon overlay */}
                        <div className="absolute bottom-1 right-1 w-5 h-5 flex items-center justify-center rounded-full bg-indigo-500/20 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Plus className="w-3 h-3" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(ComponentGalleryInner);
