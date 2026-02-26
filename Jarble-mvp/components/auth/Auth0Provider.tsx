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

  // Don't render until redirect URI is available — the Auth0 SDK creates
  // its internal client on first mount and won't pick up later changes
  // to redirect_uri, which causes "Unable to issue redirect" errors.
  if (!redirectUri) return null;

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
