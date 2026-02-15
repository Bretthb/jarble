import * as jose from "jose";
import { db, tables } from "../db/index.js";
import { eq } from "drizzle-orm";
import { env } from "../utils/env.js";
import { nanoid } from "nanoid";
import { logger } from "../utils/logger.js";

// Cache for JWKS
let jwks: jose.JWTVerifyGetKey | null = null;

async function getJWKS() {
  if (!jwks) {
    jwks = jose.createRemoteJWKSet(
      new URL(`https://${env.AUTH0_DOMAIN}/.well-known/jwks.json`)
    );
  }
  return jwks;
}

// Namespace for custom claims added via Auth0 Post Login Action
const CLAIMS_NAMESPACE = "https://api.jarble.ai";

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
      logger.info({ userId: user.id, updates }, "Updating user info from token");
      await (db as any).update(tables.users)
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
  if (payload.email) {
    const existingByEmail = await db.query.users.findFirst({
      where: eq(tables.users.email, payload.email),
    });

    if (existingByEmail) {
      // Link this auth0Id to the existing user instead of creating a duplicate
      const updates: Record<string, unknown> = {
        auth0Id: payload.sub, // Update to the new auth method's ID
      };
      if (payload.name && !existingByEmail.name) {
        updates.name = payload.name;
      }
      if (emailVerified && !existingByEmail.emailVerified) {
        updates.emailVerified = true;
      }

      await (db as any).update(tables.users)
        .set(updates)
        .where(eq(tables.users.id, existingByEmail.id));

      logger.info({
        userId: existingByEmail.id,
        email: payload.email,
        newAuth0Id: payload.sub,
        previousAuth0Id: existingByEmail.auth0Id,
      }, "Linked new auth method to existing user (same email)");

      user = await db.query.users.findFirst({
        where: eq(tables.users.id, existingByEmail.id),
      });
      return user;
    }
  }

  // Create new user — no existing account with this email
  const userId = nanoid(12);

  await (db as any).insert(tables.users).values({
    id: userId,
    auth0Id: payload.sub,
    email: payload.email || `${payload.sub}@auth0.user`,
    name: payload.name || null,
    emailVerified: emailVerified,
  });

  logger.info({
    userId,
    auth0Id: payload.sub,
    email: payload.email,
    emailVerified,
    isGoogleUser,
  }, "New user created");

  user = await db.query.users.findFirst({
    where: eq(tables.users.id, userId),
  });

  return user;
}
