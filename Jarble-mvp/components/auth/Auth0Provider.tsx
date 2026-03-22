'use client';
import { Auth0Provider as Provider } from '@auth0/auth0-react';
import { ReactNode, useState, useEffect } from 'react';

// Strip protocol if accidentally included in env var
const domain = (process.env.NEXT_PUBLIC_AUTH0_DOMAIN ?? '')
  .replace(/^https?:\/\//, '');
const clientId = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID ?? '';
const audience = process.env.NEXT_PUBLIC_AUTH0_AUDIENCE ?? '';

if (!domain || !clientId || !audience) {
  throw new Error(
    'Missing Auth0 environment variables. Set NEXT_PUBLIC_AUTH0_DOMAIN, ' +
    'NEXT_PUBLIC_AUTH0_CLIENT_ID, and NEXT_PUBLIC_AUTH0_AUDIENCE.'
  );
}

export function Auth0Provider({ children }: { children: ReactNode }) {
  const [redirectUri, setRedirectUri] = useState('');

  useEffect(() => {
    setRedirectUri(window.location.origin + '/dashboard');
  }, []);

  // Don't render the Auth0 SDK until redirect URI is available — it creates
  // its internal client on first mount and won't pick up later changes
  // to redirect_uri, which causes "Unable to issue redirect" errors.
  // Show a minimal loading state instead of null to prevent a blank flash.
  if (!redirectUri) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <Provider
      domain={domain}
      clientId={clientId}
      cacheLocation="localstorage"
      useRefreshTokens={true}
      authorizationParams={{
        redirect_uri: redirectUri,
        audience,
      }}
    >
      {children}
    </Provider>
  );
}
