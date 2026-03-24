/**
 * Auth0 session injection for Playwright MCP.
 *
 * Fetches a full token set (access_token, id_token, refresh_token) via
 * Auth0's Resource Owner Password Grant, then builds the exact localStorage
 * entries that Auth0 SPA SDK expects — including refresh_token, which is
 * required when the app uses useRefreshTokens={true}.
 *
 * Usage from QA orchestrator agent:
 *   1. Call fetchAuthTokens(email, password) to get all tokens
 *   2. Call buildAuthInjectionScript(tokens) to get a JS string
 *   3. Pass that script to the explorer agent, which runs it via playwright_evaluate
 */

const AUTH0_DOMAIN = "jarble-dev.us.auth0.com";
const AUTH0_CLIENT_ID = "1VR30862RmZIFR44UIM8aVHYEt3K2Rsh";
const AUTH0_AUDIENCE = "https://api.jarble.ai";
const SCOPE = "openid profile email offline_access";

/**
 * Fetch all tokens from Auth0 via Resource Owner Password Grant.
 * Returns { access_token, id_token, refresh_token, expires_in, token_type, scope }
 */
export async function fetchAuthTokens(email, password) {
  const res = await fetch(`https://${AUTH0_DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "password",
      username: email,
      password: password,
      client_id: AUTH0_CLIENT_ID,
      audience: AUTH0_AUDIENCE,
      scope: SCOPE,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Auth0 token fetch failed (${res.status}): ${body}`);
  }

  return res.json();
}

/**
 * Decode a JWT payload (base64url decode the second segment).
 */
function decodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
  } catch {
    return { sub: "unknown", email: "qa@jarble.ai" };
  }
}

/**
 * Build a JavaScript string that, when executed via playwright_evaluate,
 * injects a full Auth0 session into localStorage and cookies.
 *
 * @param {object} tokens - The token response from fetchAuthTokens()
 * @returns {string} JavaScript code to execute in the browser
 */
export function buildAuthInjectionScript(tokens) {
  const decoded = decodeJwt(tokens.id_token || tokens.access_token);
  const scope = tokens.scope || SCOPE;
  const expiresAt = Math.floor(Date.now() / 1000) + (tokens.expires_in || 86400);

  const cacheKey = `@@auth0spajs@@::${AUTH0_CLIENT_ID}::${AUTH0_AUDIENCE}::${scope}`;
  const cacheValue = {
    body: {
      client_id: AUTH0_CLIENT_ID,
      access_token: tokens.access_token,
      id_token: tokens.id_token || tokens.access_token,
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      scope,
      expires_in: tokens.expires_in || 86400,
      token_type: tokens.token_type || "Bearer",
      decodedToken: {
        user: decoded,
        claims: decoded,
      },
      audience: AUTH0_AUDIENCE,
    },
    expiresAt,
  };

  const userKey = `@@auth0spajs@@::${AUTH0_CLIENT_ID}::@@user@@`;
  const userValue = {
    decodedToken: {
      user: decoded,
      claims: decoded,
    },
  };

  const cookieName = `auth0.${AUTH0_CLIENT_ID}.is.authenticated`;

  // Build a self-contained JS script that injects everything
  return `
localStorage.setItem(${JSON.stringify(cacheKey)}, ${JSON.stringify(JSON.stringify(cacheValue))});
localStorage.setItem(${JSON.stringify(userKey)}, ${JSON.stringify(JSON.stringify(userValue))});
document.cookie = ${JSON.stringify(`${cookieName}=true; path=/; max-age=86400`)};
  `.trim();
}

/**
 * Inject auth into a Playwright browser context (legacy API for old persona scripts).
 * Must be called BEFORE navigating to any page.
 */
export async function injectAuth(context, page, token) {
  if (!token) return;

  const decoded = decodeJwt(token);
  const expiresAt = decoded.exp || Math.floor(Date.now() / 1000) + 86400;

  const cacheKey = `@@auth0spajs@@::${AUTH0_CLIENT_ID}::${AUTH0_AUDIENCE}::${SCOPE}`;
  const cacheValue = JSON.stringify({
    body: {
      client_id: AUTH0_CLIENT_ID,
      access_token: token,
      id_token: token,
      scope: SCOPE,
      expires_in: 86400,
      token_type: "Bearer",
      decodedToken: { user: decoded, claims: decoded },
      audience: AUTH0_AUDIENCE,
    },
    expiresAt,
  });

  const userKey = `@@auth0spajs@@::${AUTH0_CLIENT_ID}::@@user@@`;
  const userValue = JSON.stringify({
    decodedToken: { user: decoded, claims: decoded },
  });

  const authCookieName = `auth0.${AUTH0_CLIENT_ID}.is.authenticated`;

  await context.addCookies([{
    name: authCookieName,
    value: "true",
    domain: "localhost",
    path: "/",
    expires: expiresAt,
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
  }]);

  await page.addInitScript(({ cacheKey, cacheValue, userKey, userValue }) => {
    localStorage.setItem(cacheKey, cacheValue);
    localStorage.setItem(userKey, userValue);
  }, { cacheKey, cacheValue, userKey, userValue });
}

// Export constants for use by other modules
export { AUTH0_CLIENT_ID, AUTH0_DOMAIN, AUTH0_AUDIENCE, SCOPE };
