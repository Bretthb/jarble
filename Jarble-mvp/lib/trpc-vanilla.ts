/**
 * Vanilla tRPC client for use outside React hooks (e.g., Tambo tool functions).
 *
 * Tools need to call tRPC mutations from plain async functions — not hooks.
 * This client shares the Auth0 token via a setter called from providers.tsx.
 */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "jarble-api";
import { API_URL } from "./trpc";

// Auth0 token getter — set by providers.tsx on mount
let tokenGetter: (() => Promise<string>) | null = null;

export function setTokenGetter(fn: () => Promise<string>) {
  tokenGetter = fn;
}

export const vanillaClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${API_URL}/trpc`,
      transformer: superjson,
      async headers() {
        if (!tokenGetter) return {};
        try {
          const token = await tokenGetter();
          return token ? { Authorization: `Bearer ${token}` } : {};
        } catch {
          return {};
        }
      },
    }),
  ],
});
