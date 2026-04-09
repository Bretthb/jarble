/**
 * Client-side credential vault using Web Crypto API.
 *
 * User-only credentials are encrypted in the browser before being sent
 * to the server. The server stores an opaque blob it CANNOT decrypt.
 * Only the user's browser (with the correct derivation inputs) can decrypt.
 *
 * Key derivation: PBKDF2 with userId + deploymentId + fixed salt → AES-GCM key
 * The key never leaves the browser. There is no "forgot password" recovery —
 * if the userId changes, user-scope credentials become unrecoverable.
 */

const SALT = "jarble-client-vault-v1";
const ITERATIONS = 100_000;

async function deriveKey(userId: string, deploymentId: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`${userId}:${deploymentId}`),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(SALT),
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a plaintext credential client-side.
 * Returns a base64-encoded string (IV + ciphertext) safe to store on the server.
 */
export async function clientEncrypt(
  plaintext: string,
  userId: string,
  deploymentId: string,
): Promise<string> {
  const key = await deriveKey(userId, deploymentId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );
  // Concatenate IV + ciphertext and base64 encode
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a client-encrypted credential.
 * Input is the base64 string from clientEncrypt.
 * Returns null if decryption fails (wrong user, corrupted data).
 */
export async function clientDecrypt(
  encrypted: string,
  userId: string,
  deploymentId: string,
): Promise<string | null> {
  try {
    const key = await deriveKey(userId, deploymentId);
    const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null; // Decryption failed — wrong key or corrupted data
  }
}
