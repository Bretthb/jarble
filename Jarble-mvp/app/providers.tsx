"use client";

import { trpc, API_URL } from "@/lib/trpc";
import { setTokenGetter } from "@/lib/trpc-vanilla";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { useRef, useState, useEffect } from "react";
import superjson from "superjson";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import ErrorBoundary from "@/components/ErrorBoundary";
import DevNav from "@/components/DevNav";
import { Auth0Provider } from "@/components/auth";
import { useAuth0 } from "@auth0/auth0-react";
import { initPostHog } from "@/lib/posthog";

/**
 * Inner provider that sits inside Auth0Provider so it can access useAuth0().
 * Creates the tRPC client with Auth0 Bearer token in headers.
 */
function TrpcProviders({ children }: { children: React.ReactNode }) {
  const { getAccessTokenSilently, isAuthenticated, isLoading } = useAuth0();

  // Store the auth getter in a ref so the tRPC client (created once) always
  // has access to the latest auth state without re-creating the client.
  const authRef = useRef({ getAccessTokenSilently, isAuthenticated, isLoading });
  authRef.current = { getAccessTokenSilently, isAuthenticated, isLoading };

  // Wire Auth0 token getter for the vanilla tRPC client (used by Tambo tools)
  useEffect(() => {
    setTokenGetter(getAccessTokenSilently);
  }, [getAccessTokenSilently]);

  // Initialize PostHog analytics (gated by NEXT_PUBLIC_POSTHOG_KEY env var)
  useEffect(() => {
    initPostHog();
  }, []);

  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          // Don't refetch on window focus while auth is settling — this prevents
          // the race condition where React Query refetches after Auth0 redirect
          // but the token isn't ready yet.
          refetchOnWindowFocus: () => !authRef.current.isLoading,
          // Retry auth errors once after a short delay (token might be settling)
          retry: (failureCount, error) => {
            if (error instanceof TRPCClientError && error.message?.includes("logged in")) {
              return failureCount < 2;
            }
            return failureCount < 3;
          },
          retryDelay: (attemptIndex) => Math.min(1000 * (attemptIndex + 1), 5000),
        },
      },
    });

    const redirectToLoginIfUnauthorized = (error: unknown) => {
      if (!(error instanceof TRPCClientError)) return;
      if (typeof window === "undefined") return;
      // Don't redirect while auth is still loading (token might be settling)
      if (authRef.current.isLoading) return;
      // Only redirect if user is NOT authenticated with Auth0
      if (authRef.current.isAuthenticated) return;
      window.location.href = "/login";
    };

    client.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") {
        const error = event.query.state.error;
        redirectToLoginIfUnauthorized(error);
        // Only log if auth is settled — suppress noise during auth callback
        if (!authRef.current.isLoading) {
          console.error("[API Query Error]", error);
        }
      }
    });

    client.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") {
        const error = event.mutation.state.error;
        redirectToLoginIfUnauthorized(error);
        console.error("[API Mutation Error]", error);
      }
    });

    return client;
  });

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          // Point to external API service
          url: `${API_URL}/trpc`,
          transformer: superjson,
          async headers() {
            // Always attempt to get the token — getAccessTokenSilently() can
            // resolve from the cache or refresh token even before isAuthenticated
            // flips to true (e.g. during Auth0 callback processing).
            try {
              const token = await authRef.current.getAccessTokenSilently();
              if (token) {
                return { Authorization: `Bearer ${token}` };
              }
            } catch {
              // No token available — send request without auth header
            }
            return {};
          },
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <ThemeProvider defaultTheme="light" switchable>
            <TooltipProvider>
              <Toaster />
              {process.env.NODE_ENV === "development" && <DevNav />}
              {children}
            </TooltipProvider>
          </ThemeProvider>
        </ErrorBoundary>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Auth0Provider>
      <TrpcProviders>{children}</TrpcProviders>
    </Auth0Provider>
  );
}
