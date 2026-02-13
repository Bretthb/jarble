import * as jose from "jose";
import { db, tables } from "../db/index.js";
import { eq } from "drizzle-orm";
import { env } from "../utils/env.js";
import { nanoid } from "nanoid";

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

export interface TokenPayload {
  sub: string;  // Auth0 user ID
  email?: string;
  name?: string;
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const jwks = await getJWKS();
  
  const { payload } = await jose.jwtVerify(token, jwks, {
    issuer: `https://${env.AUTH0_DOMAIN}/`,
    audience: env.AUTH0_AUDIENCE,
  });

  return payload as TokenPayload;
}

export async function getUserFromToken(payload: TokenPayload) {
  // Try to find existing user
  let user = await db.query.users.findFirst({
    where: eq(tables.users.auth0Id, payload.sub),
  });

  // Create new user if doesn't exist
  if (!user) {
    const userId = nanoid(12);
    await (db as any).insert(tables.users).values({
      id: userId,
      auth0Id: payload.sub,
      email: payload.email || `${payload.sub}@auth0.user`,
      name: payload.name || null,
    });
    
    user = await db.query.users.findFirst({
      where: eq(tables.users.id, userId),
    });
  }

  return user;
}
