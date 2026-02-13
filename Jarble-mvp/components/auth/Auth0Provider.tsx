'use client';
import { Auth0Provider as Provider } from '@auth0/auth0-react';
import { ReactNode } from 'react';

// Strip protocol if accidentally included in env var
const domain = (process.env.NEXT_PUBLIC_AUTH0_DOMAIN || 'jarble-dev.us.auth0.com')
  .replace(/^https?:\/\//, '');
const clientId = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID || '1VR30862RmZIFR44UIM8aVHYEt3K2Rsh';
const audience = process.env.NEXT_PUBLIC_AUTH0_AUDIENCE || 'https://api.jarble.ai';

export function Auth0Provider({ children }: { children: ReactNode }) {
  return (
    <Provider
      domain={domain}
      clientId={clientId}
      cacheLocation="localstorage"
      useRefreshTokens={true}
      authorizationParams={{
        redirect_uri: typeof window !== 'undefined' ? window.location.origin + '/dashboard' : '',
        audience,
      }}
    >
      {children}
    </Provider>
  );
}
