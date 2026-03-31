'use client';
import { Auth0Provider as Provider } from '@auth0/auth0-react';
import { ReactNode } from 'react';

export function Auth0Provider({ children }: { children: ReactNode }) {
  // Resolve env vars at runtime (not module scope) so the server-side
  // build doesn't throw when NEXT_PUBLIC_* vars aren't set yet.
  const domain = (process.env.NEXT_PUBLIC_AUTH0_DOMAIN ?? '').replace(/^https?:\/\//, '');
  const clientId = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID ?? '';
  const audience = process.env.NEXT_PUBLIC_AUTH0_AUDIENCE ?? '';

  // During SSR/prerendering, window is undefined - return a loading placeholder.
  // On the client, compute redirectUri synchronously so the Auth0 Provider
  // mounts on the FIRST client render. This is critical: the SDK must be
  // mounted when the page loads with ?code=&state= after an OAuth redirect,
  // otherwise handleRedirectCallback never fires and the login silently fails.
  if (typeof window === 'undefined') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      </div>
    );
  }

  if (!domain || !clientId || !audience) {
    throw new Error(
      'Missing Auth0 environment variables. Set NEXT_PUBLIC_AUTH0_DOMAIN, ' +
      'NEXT_PUBLIC_AUTH0_CLIENT_ID, and NEXT_PUBLIC_AUTH0_AUDIENCE.'
    );
  }

  const redirectUri = window.location.origin + '/dashboard';

  return (
    <Provider
      domain={domain}
      clientId={clientId}
      cacheLocation="localstorage"
      useRefreshTokens={true}
      useCookiesForTransactions={false}
      authorizationParams={{
        redirect_uri: redirectUri,
        audience,
      }}
    >
      {children}
    </Provider>
  );
}
