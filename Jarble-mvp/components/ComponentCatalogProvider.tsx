"use client";

/**
 * ComponentCatalogProvider — React context that fetches and caches the
 * per-deployment component catalog (built-in + custom).
 *
 * Wrap this around DeploymentTamboProvider so both the canvas renderer
 * and Tambo can access custom component definitions.
 */

import { createContext, useContext, useCallback, useMemo } from "react";
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
}

const ComponentCatalogContext = createContext<ComponentCatalogContextValue>({
  catalog: null,
  isLoading: false,
  refetch: () => {},
  getCustomComponent: () => undefined,
  isCustomComponent: () => false,
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

  const customsMap = useMemo(() => {
    const map = new Map<string, ComponentDefinition>();
    if (catalog?.customs) {
      for (const def of catalog.customs) {
        map.set(def.name, def);
      }
    }
    return map;
  }, [catalog]);

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

  const value = useMemo(
    () => ({
      catalog,
      isLoading: catalogQuery.isLoading,
      refetch,
      getCustomComponent,
      isCustomComponent,
    }),
    [catalog, catalogQuery.isLoading, refetch, getCustomComponent, isCustomComponent]
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
