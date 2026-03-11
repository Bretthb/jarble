"use client";
import { trpc } from "@/lib/trpc";

export function useIsAdmin() {
  const profile = trpc.user.getProfile.useQuery();
  return {
    isAdmin: profile.data?.role === "super_admin",
    isLoading: profile.isLoading,
  };
}
