"use client";

/**
 * ComponentCatalogProvider — React context that fetches and caches the
 * per-deployment component catalog (built-in + custom).
 *
 * Wrap this around DeploymentTamboProvider so both the canvas renderer
 * and Tambo can access custom component definitions.
 */

import { createContext, useContext, useCallback, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { ComponentCatalog, ComponentDefinition } from "@/lib/component-catalog";

interface ComponentCatalogContextValue {
  catalog: ComponentCatalog | null;
  isLoading: boolean;
  /** Refetch after define/delete operations */
  refetch: () => void;
  /** Look up a custom component definition by name */
  getCustomComponent: (name: string) => ComponentDefinition | undefined;
  /** Check if a name is a custom component */
  isCustomComponent: (name: string) => boolean;
  /** Register a component at runtime (from SSE COMPONENT_DEFINED events) */
  registerComponent: (def: ComponentDefinition) => void;
}

const ComponentCatalogContext = createContext<ComponentCatalogContextValue>({
  catalog: null,
  isLoading: false,
  refetch: () => {},
  getCustomComponent: () => undefined,
  isCustomComponent: () => false,
  registerComponent: () => {},
});

export function ComponentCatalogProvider({
  deploymentId,
  children,
}: {
  deploymentId: string;
  children: React.ReactNode;
}) {
  const catalogQuery = trpc.deployment.getComponentCatalog.useQuery(
    { id: deploymentId },
    { staleTime: 60_000 }
  );

  const catalog = (catalogQuery.data as ComponentCatalog | undefined) ?? null;

  // Runtime-registered components (from SSE COMPONENT_DEFINED events)
  const [runtimeDefs, setRuntimeDefs] = useState<Map<string, ComponentDefinition>>(new Map());

  const customsMap = useMemo(() => {
    const map = new Map<string, ComponentDefinition>();
    // Start with server-fetched customs
    if (catalog?.customs) {
      for (const def of catalog.customs) {
        map.set(def.name, def);
      }
    }
    // Overlay runtime-registered components (takes precedence)
    for (const [name, def] of runtimeDefs) {
      map.set(name, def);
    }
    return map;
  }, [catalog, runtimeDefs]);

  const getCustomComponent = useCallback(
    (name: string) => customsMap.get(name),
    [customsMap]
  );

  const isCustomComponent = useCallback(
    (name: string) => customsMap.has(name),
    [customsMap]
  );

  const refetch = useCallback(() => {
    catalogQuery.refetch();
  }, [catalogQuery]);

  const registerComponent = useCallback((def: ComponentDefinition) => {
    setRuntimeDefs((prev) => {
      const next = new Map(prev);
      next.set(def.name, def);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      catalog,
      isLoading: catalogQuery.isLoading,
      refetch,
      getCustomComponent,
      isCustomComponent,
      registerComponent,
    }),
    [catalog, catalogQuery.isLoading, refetch, getCustomComponent, isCustomComponent, registerComponent]
  );

  return (
    <ComponentCatalogContext.Provider value={value}>
      {children}
    </ComponentCatalogContext.Provider>
  );
}

export function useComponentCatalog() {
  return useContext(ComponentCatalogContext);
}
