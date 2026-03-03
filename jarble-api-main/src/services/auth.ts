import * as jose from "jose";
import { db, tables } from "../db/index.js";
import { eq } from "drizzle-orm";
import { env } from "../utils/env.js";
import { nanoid } from "nanoid";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("auth");

// Cache for JWKS
let jwks: jose.JWTVerifyGetKey | null = null;

async function getJWKS() {
  if (!jwks) {
    jwks = jose.createRemoteJWKSet(
      new URL(`https://${env.AUTH0_DOMAIN}/.well-known/jwks.json`),
      {
        cooldownDuration: 30_000,   // 30s between JWKS refetch attempts
        cacheMaxAge: 600_000,       // Refresh cached keys every 10 minutes
      }
    );
  }
  return jwks;
}

// Namespace for custom claims added via Auth0 Post Login Action
const CLAIMS_NAMESPACE = env.AUTH0_AUDIENCE;

export interface TokenPayload {
  sub: string;  // Auth0 user ID (e.g. "google-oauth2|123456" or "auth0|abc123")
  email?: string;
  name?: string;
  email_verified?: boolean;
  // Namespaced custom claims (added via Auth0 Post Login Action)
  [key: string]: unknown;
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const jwks = await getJWKS();

  const { payload } = await jose.jwtVerify(token, jwks, {
    issuer: `https://${env.AUTH0_DOMAIN}/`,
    audience: env.AUTH0_AUDIENCE,
  });

  const result = payload as TokenPayload;

  // Read namespaced claims (from Auth0 Post Login Action) and merge into top-level
  // These override any standard claims since access tokens don't include them by default
  if (result[`${CLAIMS_NAMESPACE}/email`]) {
    result.email = result[`${CLAIMS_NAMESPACE}/email`] as string;
  }
  if (result[`${CLAIMS_NAMESPACE}/name`]) {
    result.name = result[`${CLAIMS_NAMESPACE}/name`] as string;
  }
  if (result[`${CLAIMS_NAMESPACE}/email_verified`] !== undefined) {
    result.email_verified = result[`${CLAIMS_NAMESPACE}/email_verified`] as boolean;
  }

  return result;
}

export async function getUserFromToken(payload: TokenPayload) {
  const isGoogleUser = payload.sub.startsWith("google-oauth2|");

  // Google users are always email-verified
  const emailVerified = isGoogleUser ? true : (payload.email_verified ?? false);

  // Try to find existing user
  let user = await db.query.users.findFirst({
    where: eq(tables.users.auth0Id, payload.sub),
  });

  if (user) {
    // Update user info if it changed (e.g. name was missing, email got verified)
    const updates: Record<string, unknown> = {};

    if (payload.email && payload.email !== user.email) {
      updates.email = payload.email;
    }
    if (payload.name && payload.name !== user.name) {
      updates.name = payload.name;
    }
    if (emailVerified && !user.emailVerified) {
      updates.emailVerified = true;
    }

    if (Object.keys(updates).length > 0) {
      log.info({ userId: user.id, updates }, "Updating user info from token");
      await db.update(tables.users)
        .set(updates)
        .where(eq(tables.users.id, user.id));

      // Re-fetch with updates
      user = await db.query.users.findFirst({
        where: eq(tables.users.id, user.id),
      });
    }

    return user;
  }

  // Before creating a new user, check if someone with this email already exists
  // This handles the case where a user signs up with Google first, then tries
  // email/password with the same email (or vice versa)
  //
  // SECURITY: Only link accounts if BOTH are email-verified to prevent account takeover.
  // Attack scenario without this check:
  //   1. Victim signs up with Google (alice@example.com)
  //   2. Attacker creates Auth0 email/password account with alice@example.com
  //   3. Attacker logs in, code would overwrite auth0Id, hijacking the account
  if (payload.email) {
    const existingByEmail = await db.query.users.findFirst({
      where: eq(tables.users.email, payload.email),
    });

    if (existingByEmail) {
      // Only allow account linking if BOTH accounts have verified emails
      // This prevents attackers from claiming unverified emails
      if (!emailVerified || !existingByEmail.emailVerified) {
        log.warn({
          email: payload.email,
          newAuth0Id: payload.sub,
          existingAuth0Id: existingByEmail.auth0Id,
          newEmailVerified: emailVerified,
          existingEmailVerified: existingByEmail.emailVerified,
        }, "Blocked account linking: both accounts must be email-verified");

        // Don't link - create a separate account (will fail on unique constraint if email is unique)
        // Or throw an error to inform the user
        throw new Error(
          "An account with this email already exists. Please sign in with your original method, " +
          "or verify your email on both accounts to link them."
        );
      }

      // Both accounts are verified - safe to link
      const updates: Record<string, unknown> = {
        auth0Id: payload.sub, // Update to the new auth method's ID
      };
      if (payload.name && !existingByEmail.name) {
        updates.name = payload.name;
      }

      await db.update(tables.users)
        .set(updates)
        .where(eq(tables.users.id, existingByEmail.id));

      log.info({
        userId: existingByEmail.id,
        email: payload.email,
        newAuth0Id: payload.sub,
        previousAuth0Id: existingByEmail.auth0Id,
      }, "Linked new auth method to existing user (both email-verified)");

      user = await db.query.users.findFirst({
        where: eq(tables.users.id, existingByEmail.id),
      });
      return user;
    }
  }

  // Create new user — no existing account with this email
  const userId = nanoid(12);

  try {
    await db.insert(tables.users).values({
      id: userId,
      auth0Id: payload.sub,
      email: payload.email || `${payload.sub}@auth0.user`,
      name: payload.name || null,
      emailVerified: emailVerified,
    });

    log.info({
      userId,
      auth0Id: payload.sub,
      email: payload.email,
      emailVerified,
      isGoogleUser,
    }, "New user created");
  } catch (err: unknown) {
    // Handle race condition: two concurrent first-requests both try to INSERT.
    // The second one hits a unique constraint violation — re-fetch instead of 500.
    const code = (err as { code?: string })?.code;
    const isConstraintViolation =
      code === "SQLITE_CONSTRAINT" ||  // SQLite
      code === "ER_DUP_ENTRY" ||       // MySQL
      code === "23505";                // Postgres
    if (isConstraintViolation) {
      log.info({ auth0Id: payload.sub }, "User creation race condition — re-fetching");
      user = await db.query.users.findFirst({
        where: eq(tables.users.auth0Id, payload.sub),
      });
      return user;
    }
    throw err;
  }

  user = await db.query.users.findFirst({
    where: eq(tables.users.id, userId),
  });

  return user;
}
