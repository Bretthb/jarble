/**
 * Auth0 session injection for Playwright.
 *
 * Injects the JWT token into localStorage in the exact format
 * that Auth0 SPA SDK expects, so pages load as authenticated.
 */

const AUTH0_CLIENT_ID = "1VR30862RmZIFR44UIM8aVHYEt3K2Rsg";
const AUTH0_AUDIENCE = "https://api.jarble.ai";
const SCOPE = "openid profile email offline_access";

/**
 * Inject auth token into a Playwright browser context.
 * Must be called BEFORE navigating to any page.
 */
export async function injectAuth(context, page, token) {
  if (!token) return;

  // Decode JWT to get user info
  let decoded = {};
  try {
    const payload = token.split(".")[1];
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
  } catch {
    decoded = { sub: "unknown", email: "qa@jarble.ai" };
  }

  const expiresAt = decoded.exp || Math.floor(Date.now() / 1000) + 86400;

  // Auth0 SPA SDK cache key
  const cacheKey = `@@auth0spajs@@::${AUTH0_CLIENT_ID}::${AUTH0_AUDIENCE}::${SCOPE}`;
  const cacheValue = JSON.stringify({
    body: {
      client_id: AUTH0_CLIENT_ID,
      access_token: token,
      id_token: token, // Use same token as both (works for our purposes)
      scope: SCOPE,
      expires_in: 86400,
      token_type: "Bearer",
      decodedToken: {
        user: decoded,
        claims: decoded,
      },
      audience: AUTH0_AUDIENCE,
    },
    expiresAt,
  });

  // User profile cache key
  const userKey = `@@auth0spajs@@::${AUTH0_CLIENT_ID}::@@user@@`;
  const userValue = JSON.stringify({
    decodedToken: {
      user: decoded,
      claims: decoded,
    },
  });

  // Auth0 SPA SDK v2 checks this cookie
  const authCookieName = `auth0.${AUTH0_CLIENT_ID}.is.authenticated`;

  // Set cookie
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

  // Inject localStorage entries before any page loads
  await page.addInitScript(({ cacheKey, cacheValue, userKey, userValue }) => {
    localStorage.setItem(cacheKey, cacheValue);
    localStorage.setItem(userKey, userValue);
  }, { cacheKey, cacheValue, userKey, userValue });
}
