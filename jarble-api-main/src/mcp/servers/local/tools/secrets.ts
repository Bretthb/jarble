/**
 * Pod-local secret store.
 *
 * NOTE: This is a clean v1 and is distinct from the legacy jarble-ui-server.js
 * behavior. The legacy `store_secret` tool proxied to the Jarble API so that
 * secrets could be injected as K8s env vars at pod restart. That flow is
 * valuable and will continue to live on the platform MCP server.
 *
 * This local implementation is for secrets that only the pod itself needs
 * (e.g. a skill stores a user-provided webhook signing secret without a
 * round-trip). Values are encrypted with AES-256-GCM and written to the PVC.
 * Never logged, never returned by list_secrets.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import { registerTool } from "../register.js";
import {
  ensureDir,
  pathExists,
  pvcRoot,
  readJsonOrDefault,
  textResult,
} from "../_helpers.js";
import {
  InvalidArgsError,
  NotFoundError,
  UpstreamError,
} from "../../../shared/errors.js";

const NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/;

function secretsDir(): string {
  return process.env.JARBLE_SECRETS_DIR || path.join(pvcRoot(), "secrets");
}
function secretsFile(): string {
  return path.join(secretsDir(), "store.json");
}

interface EncryptedSecret {
  name: string;
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
  createdAt: string;
  updatedAt: string;
}
interface SecretStore {
  version: number;
  secrets: EncryptedSecret[];
}

function getKey(): Buffer {
  const raw = process.env.SECRET_ENCRYPTION_KEY;
  if (!raw) {
    throw new UpstreamError(
      "SECRET_ENCRYPTION_KEY is not set on this pod. Pod-local secrets are disabled until the platform configures an encryption key.",
    );
  }
  // Accept either a 64-char hex string (exactly 32 bytes) or any other value
  // which we SHA-256 down to 32 bytes. Prefer hex in production.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw).digest();
}

async function loadStore(): Promise<SecretStore> {
  return readJsonOrDefault<SecretStore>(secretsFile(), { version: 1, secrets: [] });
}

async function saveStore(store: SecretStore): Promise<void> {
  await ensureDir(secretsDir());
  const tmp = secretsFile() + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, secretsFile());
  // Best effort: tighten perms if the rename landed on a pre-existing file.
  try {
    await fs.chmod(secretsFile(), 0o600);
  } catch {
    /* ignore on systems where chmod is a no-op */
  }
}

function encrypt(plaintext: string): Omit<EncryptedSecret, "name" | "createdAt" | "updatedAt"> {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    authTag: tag.toString("base64"),
  };
}

function decrypt(entry: EncryptedSecret): string {
  const key = getKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(entry.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(entry.authTag, "base64"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(entry.ciphertext, "base64")),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}

function checkName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new InvalidArgsError(
      `Invalid secret name "${name}". Must match /^[A-Z][A-Z0-9_]{0,127}$/ (e.g. MY_API_KEY).`,
    );
  }
}

// ── store_secret ──────────────────────────────────────────────────────

registerTool({
  name: "store_secret",
  description:
    "Encrypt and store a secret on the pod PVC (AES-256-GCM). Retrievable via get_secret by the same pod. Not injected as env vars — use platform_store_secret for that.",
  server: "local",
  inputSchema: z.object({
    name: z.string(),
    value: z.string().min(1),
  }),
  handler: async (args) => {
    checkName(args.name);
    const store = await loadStore();
    const now = new Date().toISOString();
    const enc = encrypt(args.value);
    const idx = store.secrets.findIndex((s) => s.name === args.name);
    if (idx !== -1) {
      store.secrets[idx] = {
        name: args.name,
        ...enc,
        createdAt: store.secrets[idx].createdAt,
        updatedAt: now,
      };
    } else {
      store.secrets.push({ name: args.name, ...enc, createdAt: now, updatedAt: now });
    }
    await saveStore(store);
    return textResult(`Secret "${args.name}" stored.`);
  },
});

// ── list_secrets ──────────────────────────────────────────────────────

registerTool({
  name: "list_secrets",
  description:
    "List the names of pod-local secrets. Values are never returned for security; use get_secret to retrieve a value.",
  server: "local",
  inputSchema: z.object({}),
  handler: async () => {
    const store = await loadStore();
    if (store.secrets.length === 0) {
      return textResult("No pod-local secrets stored.");
    }
    const lines = store.secrets
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => `- ${s.name} (updated ${s.updatedAt})`);
    return textResult(`${store.secrets.length} secret(s):\n${lines.join("\n")}`);
  },
});

// ── get_secret ────────────────────────────────────────────────────────

registerTool({
  name: "get_secret",
  description:
    "Retrieve and decrypt a pod-local secret value by name. Callers should treat the returned value as sensitive and avoid logging it.",
  server: "local",
  inputSchema: z.object({ name: z.string() }),
  handler: async (args) => {
    checkName(args.name);
    const store = await loadStore();
    const entry = store.secrets.find((s) => s.name === args.name);
    if (!entry) throw new NotFoundError(`Secret "${args.name}" not found.`);
    const value = decrypt(entry);
    return textResult(value);
  },
});

// ── delete_secret ─────────────────────────────────────────────────────

registerTool({
  name: "delete_secret",
  description: "Delete a pod-local secret by name.",
  server: "local",
  inputSchema: z.object({ name: z.string() }),
  handler: async (args) => {
    checkName(args.name);
    const store = await loadStore();
    const idx = store.secrets.findIndex((s) => s.name === args.name);
    if (idx === -1) throw new NotFoundError(`Secret "${args.name}" not found.`);
    store.secrets.splice(idx, 1);
    await saveStore(store);
    // If the store is empty, remove the file entirely.
    if (store.secrets.length === 0 && (await pathExists(secretsFile()))) {
      try {
        await fs.unlink(secretsFile());
      } catch {
        /* ignore */
      }
    }
    return textResult(`Secret "${args.name}" deleted.`);
  },
});
