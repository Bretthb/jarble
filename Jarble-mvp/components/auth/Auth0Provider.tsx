'use client';
import { Auth0Provider as Provider } from '@auth0/auth0-react';
import { ReactNode } from 'react';

/**
 * Resolve the Auth0 post-login redirect URI.
 *
 * Must be stable across server and client (same value on both) to avoid
 * React hydration mismatch, AND must be a real URL (NOT a placeholder)
 * because @auth0/auth0-react snapshots authorizationParams at client
 * instantiation — it does NOT re-read state updates.
 *
 * Priority:
 *   1. NEXT_PUBLIC_APP_URL env var (authoritative, set at build time)
 *   2. window.location.origin (client-only fallback if env var missing)
 *   3. Throw — SSR with no env var = misconfiguration we must surface loudly
 *
 * CRITICAL: Never return 'https://placeholder.invalid/*'. A previous fix
 * tried to use a placeholder + useState + useEffect, but the Auth0 SDK
 * ignored the useEffect update and sent the placeholder to Auth0, causing
 * "Callback URL mismatch" for all users.
 */
function resolveRedirectUri(): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl) {
    return envUrl.replace(/\/$/, '') + '/dashboard';
  }
  if (typeof window !== 'undefined') {
    return window.location.origin + '/dashboard';
  }
  throw new Error(
    'NEXT_PUBLIC_APP_URL is required for Auth0 redirect configuration. ' +
    'Set it at build time (e.g. https://dev.jarble.ai) in the frontend env.'
  );
}

export function Auth0Provider({ children }: { children: ReactNode }) {
  // Resolve env vars at runtime (not module scope) so the server-side
  // build doesn't throw when NEXT_PUBLIC_* vars aren't set yet.
  const domain = (process.env.NEXT_PUBLIC_AUTH0_DOMAIN ?? '').replace(/^https?:\/\//, '');
  const clientId = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID ?? '';
  const audience = process.env.NEXT_PUBLIC_AUTH0_AUDIENCE ?? '';

  if (!domain || !clientId || !audience) {
    throw new Error(
      'Missing Auth0 environment variables. Set NEXT_PUBLIC_AUTH0_DOMAIN, ' +
      'NEXT_PUBLIC_AUTH0_CLIENT_ID, and NEXT_PUBLIC_AUTH0_AUDIENCE.'
    );
  }

  // Compute redirect URI ONCE at render time. Must be the same value on
  // server and client to avoid hydration mismatch. @auth0/auth0-react
  // snapshots authorizationParams at client instantiation — never update
  // this via useState/useEffect.
  const redirectUri = resolveRedirectUri();

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
