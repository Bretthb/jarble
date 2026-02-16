/**
 * Auth0 Post Email Verification Action
 *
 * This Action fires when a user verifies their email address.
 * It calls the Jarble API to update the user's emailVerified status in the database.
 *
 * ─── Setup Instructions ───
 *
 * 1. Go to Auth0 Dashboard → Actions → Flows → Post Change Password
 *    (Note: Auth0 doesn't have a dedicated "Post Email Verification" flow.
 *     Instead, use a Post Login Action that checks if email was recently verified.)
 *
 *    Actually, go to: Actions → Flows → Post Login
 *    This fires on every login. We check if email_verified changed.
 *
 * 2. Create a new Action → "Sync Email Verification to Jarble API"
 *
 * 3. Add these Secrets in the Action editor sidebar:
 *    - JARBLE_API_URL:    https://api.jarble.ai  (or http://localhost:3001 for dev)
 *    - JARBLE_M2M_SECRET: <same value as AUTH0_M2M_SECRET in your API .env>
 *
 * 4. Paste this code into the Action editor
 *
 * 5. Deploy the Action and add it to the Post Login flow
 *
 * ─── How It Works ───
 *
 * On every login, this Action checks if the user's email is verified.
 * If verified, it calls POST /api/auth0/email-verified on the Jarble API
 * with the user's auth0Id so the database gets updated immediately.
 *
 * The API is idempotent — calling it multiple times for an already-verified
 * user is safe (it just returns { updated: false, reason: "already_verified" }).
 */

exports.onExecutePostLogin = async (event, api) => {
  // Only fire for email/password users (Google/GitHub are always verified)
  if (!event.user.user_id.startsWith("auth0|")) {
    return;
  }

  // Only fire if email is verified
  if (!event.user.email_verified) {
    return;
  }

  const apiUrl = event.secrets.JARBLE_API_URL;
  const m2mSecret = event.secrets.JARBLE_M2M_SECRET;

  if (!apiUrl || !m2mSecret) {
    console.log("Missing JARBLE_API_URL or JARBLE_M2M_SECRET secrets — skipping webhook");
    return;
  }

  try {
    const response = await fetch(`${apiUrl}/api/auth0/email-verified`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${m2mSecret}`,
      },
      body: JSON.stringify({
        auth0Id: event.user.user_id,
        email: event.user.email,
      }),
    });

    const data = await response.json();
    console.log(`Email verification sync: ${JSON.stringify(data)}`);
  } catch (error) {
    // Don't block login if the webhook fails
    console.error(`Failed to sync email verification: ${error.message}`);
  }
};
