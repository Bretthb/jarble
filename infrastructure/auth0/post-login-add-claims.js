/**
 * Auth0 Post Login Action — Add Custom Claims to Access Token
 *
 * This Action adds namespaced custom claims to the access token so the
 * Jarble API can access user data without making additional Auth0 API calls.
 *
 * ─── Setup Instructions ───
 *
 * 1. Go to Auth0 Dashboard → Actions → Flows → Login
 *
 * 2. Create a new Action → "Add Custom Claims"
 *
 * 3. Paste this code into the Action editor
 *
 * 4. Deploy the Action and add it to the Login flow
 *    (Should run BEFORE "Sync Email Verification to Jarble API")
 *
 * ─── What It Does ───
 *
 * Adds these claims to the access token using the Jarble API namespace:
 * - https://api.jarble.ai/email
 * - https://api.jarble.ai/name
 * - https://api.jarble.ai/email_verified
 *
 * The API reads these namespaced claims in verifyToken() (auth.ts) to get
 * user info without needing the /userinfo endpoint.
 *
 * ─── Why Namespacing? ───
 *
 * Auth0 requires custom claims to use a namespace (URL format) to avoid
 * collisions with standard JWT claims like "email" or "name".
 */

exports.onExecutePostLogin = async (event, api) => {
  const namespace = 'https://api.jarble.ai';

  // Add custom claims to the access token
  // These are read by the API in verifyToken() → auth.ts
  api.accessToken.setCustomClaim(`${namespace}/email`, event.user.email);
  api.accessToken.setCustomClaim(`${namespace}/name`, event.user.name || event.user.nickname || null);
  api.accessToken.setCustomClaim(`${namespace}/email_verified`, event.user.email_verified);
};
