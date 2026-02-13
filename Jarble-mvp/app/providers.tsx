"use client";

import { trpc, API_URL } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { useRef, useState } from "react";
import superjson from "superjson";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import ErrorBoundary from "@/components/ErrorBoundary";
import DevNav from "@/components/DevNav";
import { Auth0Provider } from "@/components/auth";
import { useAuth0 } from "@auth0/auth0-react";

/**
 * Inner provider that sits inside Auth0Provider so it can access useAuth0().
 * Creates the tRPC client with Auth0 Bearer token in headers.
 */
function TrpcProviders({ children }: { children: React.ReactNode }) {
  const { getAccessTokenSilently, isAuthenticated } = useAuth0();

  // Store the auth getter in a ref so the tRPC client (created once) always
  // has access to the latest auth state without re-creating the client.
  const authRef = useRef({ getAccessTokenSilently, isAuthenticated });
  authRef.current = { getAccessTokenSilently, isAuthenticated };

  const [queryClient] = useState(() => {
    const client = new QueryClient();

    const redirectToLoginIfUnauthorized = (error: unknown) => {
      if (!(error instanceof TRPCClientError)) return;
      if (typeof window === "undefined") return;
      // Only redirect if user is NOT authenticated with Auth0
      if (authRef.current.isAuthenticated) return;
      window.location.href = "/login";
    };

    client.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") {
        const error = event.query.state.error;
        redirectToLoginIfUnauthorized(error);
        console.error("[API Query Error]", error);
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
            if (authRef.current.isAuthenticated) {
              try {
                const token = await authRef.current.getAccessTokenSilently();
                return { Authorization: `Bearer ${token}` };
              } catch {
                return {};
              }
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
          <ThemeProvider defaultTheme="light">
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
