"use client";

/**
 * DeploymentContextProvider — provides deployment ID context to child components.
 *
 * Previously wrapped TamboProvider; now a thin context wrapper after Tambo removal.
 * Kept as DeploymentTamboProvider export name for backward compatibility with imports.
 */

import { createContext, useContext } from "react";

/** React context so child components can read the deployment ID. */
const DeploymentIdContext = createContext<string>("");
export function useDeploymentId() {
  return useContext(DeploymentIdContext);
}

interface DeploymentTamboProviderProps {
  deploymentId: string;
  deploymentName: string;
  children: React.ReactNode;
}

export default function DeploymentTamboProvider({
  deploymentId,
  children,
}: DeploymentTamboProviderProps) {
  return (
    <DeploymentIdContext.Provider value={deploymentId}>
      {children}
    </DeploymentIdContext.Provider>
  );
}
