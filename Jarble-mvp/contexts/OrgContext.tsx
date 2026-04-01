"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";

interface OrgInfo {
  id: string;
  name: string;
  slug: string;
  avatarUrl: string | null;
  role: "owner" | "admin" | "member";
}

interface OrgContextValue {
  /** Currently active org ID, or null for personal/individual mode */
  activeOrgId: string | null;
  /** Switch to a different org (or null for personal) */
  setActiveOrgId: (id: string | null) => void;
  /** All orgs the user belongs to */
  orgs: OrgInfo[];
  /** The currently active org info (or null) */
  activeOrg: OrgInfo | null;
  /** Loading state */
  isLoading: boolean;
}

const OrgContext = createContext<OrgContextValue | undefined>(undefined);

const STORAGE_KEY = "jarble-active-org-id";

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth0();
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(null);

  // Load persisted org selection on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setActiveOrgIdState(stored);
    } catch {}
  }, []);

  const setActiveOrgId = useCallback((id: string | null) => {
    setActiveOrgIdState(id);
    try {
      if (id) {
        localStorage.setItem(STORAGE_KEY, id);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {}
  }, []);

  // Fetch user's orgs
  const orgsQuery = trpc.org.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const orgs: OrgInfo[] = (orgsQuery.data ?? []).map((o: any) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    avatarUrl: o.avatarUrl ?? null,
    role: o.role,
  }));

  // Validate that the stored activeOrgId still exists in the user's orgs
  useEffect(() => {
    if (orgs.length > 0 && activeOrgId && !orgs.some((o) => o.id === activeOrgId)) {
      setActiveOrgId(null);
    }
  }, [orgs, activeOrgId, setActiveOrgId]);

  const activeOrg = activeOrgId ? orgs.find((o) => o.id === activeOrgId) ?? null : null;

  return (
    <OrgContext.Provider
      value={{
        activeOrgId,
        setActiveOrgId,
        orgs,
        activeOrg,
        isLoading: orgsQuery.isLoading,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error("useOrg must be used within an OrgProvider");
  }
  return context;
}
