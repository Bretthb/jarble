'use client';
import { Auth0Provider as Provider } from '@auth0/auth0-react';
import { ReactNode, useState, useEffect } from 'react';

export function Auth0Provider({ children }: { children: ReactNode }) {
  // Resolve env vars at runtime (not module scope) so the server-side
  // build doesn't throw when NEXT_PUBLIC_* vars aren't set yet.
  const domain = (process.env.NEXT_PUBLIC_AUTH0_DOMAIN ?? '').replace(/^https?:\/\//, '');
  const clientId = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID ?? '';
  const audience = process.env.NEXT_PUBLIC_AUTH0_AUDIENCE ?? '';

  // Use a stable placeholder for SSR, then update to the real origin on the client.
  // This avoids the `typeof window` check that caused hydration mismatch (#418)
  // and public page redirects (/docs, /terms, /privacy flashing then redirecting to /).
  //
  // Why this works: Server and client both render the Auth0 <Provider> wrapping {children}
  // on the first pass — no hydration mismatch. The redirectUri starts as a harmless
  // placeholder (never used because auth redirects only happen on user click). After mount,
  // useEffect sets the real origin for subsequent login redirects. All useAuth0() hooks
  // in child components work immediately (MarketingNav, etc.).
  const [redirectUri, setRedirectUri] = useState('https://placeholder.invalid/dashboard');

  useEffect(() => {
    setRedirectUri(window.location.origin + '/dashboard');
  }, []);

  if (!domain || !clientId || !audience) {
    throw new Error(
      'Missing Auth0 environment variables. Set NEXT_PUBLIC_AUTH0_DOMAIN, ' +
      'NEXT_PUBLIC_AUTH0_CLIENT_ID, and NEXT_PUBLIC_AUTH0_AUDIENCE.'
    );
  }

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
