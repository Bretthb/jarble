"use client";

import { createContext, useContext, useCallback } from "react";

export interface CanvasAction {
  blockId: string;
  component: string;
  action: string;
  payload: Record<string, unknown>;
}

interface CanvasActionContextValue {
  dispatch: (action: Omit<CanvasAction, "blockId" | "component">) => void;
  blockId: string;
  component: string;
}

const CanvasActionContext = createContext<CanvasActionContextValue | null>(null);

/**
 * Hook for interactive canvas components to dispatch UI actions.
 * Actions are sent as chat messages in the format:
 *   [UI_ACTION] blockId={id} component={name} action={type}
 *   {JSON payload}
 */
export function useCanvasAction() {
  const ctx = useContext(CanvasActionContext);
  if (!ctx) {
    throw new Error("useCanvasAction must be used within a CanvasActionProvider");
  }
  return ctx;
}

export function CanvasActionProvider({
  blockId,
  component,
  onAction,
  children,
}: {
  blockId: string;
  component: string;
  onAction?: (action: CanvasAction) => void;
  children: React.ReactNode;
}) {
  const dispatch = useCallback(
    (partial: Omit<CanvasAction, "blockId" | "component">) => {
      onAction?.({ blockId, component, ...partial });
    },
    [blockId, component, onAction]
  );

  return (
    <CanvasActionContext.Provider value={{ dispatch, blockId, component }}>
      {children}
    </CanvasActionContext.Provider>
  );
}
