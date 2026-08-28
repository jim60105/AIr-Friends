// src/utils/skill-secret.ts
//
// Deployment-level Skill API secret (HMAC key for per-session JWTs).
// The secret is held ONLY by the bot process (JWT issuer + Skill API verifier).
// It is persisted to a file (default `data/skill-secret`, mode 0600) or overridden
// by the `AGENT_SKILL_API_SECRET` environment variable. The agent subprocess never
// receives the raw key — it only gets the per-session JWT file via `SKILL_JWT_DIR`.

import { createLogger } from "@utils/logger.ts";

const logger = createLogger("SkillSecret");

/** Minimum secret length in bytes (256 bits). */
export const MIN_SKILL_SECRET_BYTES = 32;

/**
 * Generate a 256-bit CSPRNG secret, hex-encoded (64 hex chars).
 */
export function generateSkillApiSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate a secret string: must be at least 32 bytes (256 bits) of content.
 */
export function isValidSkillSecret(secret: string): boolean {
  return new TextEncoder().encode(secret).byteLength >= MIN_SKILL_SECRET_BYTES;
}

export interface SkillSecretSource {
  /** Where the secret came from: "env", "file", or "generated". */
  source: "env" | "file" | "generated";
  /** The resolved secret string (hex or raw). */
  secret: string;
}

/**
 * Resolve the deployment Skill API secret.
 *
 * Resolution order:
 * 1. `AGENT_SKILL_API_SECRET` env var (validated: ≥ 32 bytes).
 * 2. Existing secret file at `secretPath` (default `data/skill-secret`).
 * 3. Generate a fresh 256-bit CSPRNG secret and persist it to `secretPath` (mode 0600).
 *
 * Errors (e.g. corrupt file, short env secret) are returned as a result object
 * rather than thrown, so the caller decides whether to fail startup.
 */
export async function resolveSkillApiSecret(
  secretPath: string,
): Promise<
  { ok: true; secret: string; source: "env" | "file" | "generated" } | { ok: false; error: string }
> {
  // 1. Environment override.
  const envSecret = Deno.env.get("AGENT_SKILL_API_SECRET");
  if (envSecret !== undefined && envSecret !== "") {
    if (!isValidSkillSecret(envSecret)) {
      return {
        ok: false,
        error:
          `AGENT_SKILL_API_SECRET is shorter than ${MIN_SKILL_SECRET_BYTES} bytes; a 256-bit (32-byte) secret is required`,
      };
    }
    logger.info("Skill API secret loaded from environment", { source: "env" });
    return { ok: true, secret: envSecret, source: "env" };
  }

  // 2. Existing file.
  let existing: string | undefined;
  try {
    existing = await Deno.readTextFile(secretPath);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    existing = undefined;
  }
  if (existing !== undefined) {
    const trimmed = existing.trim();
    if (!isValidSkillSecret(trimmed)) {
      return {
        ok: false,
        error:
          `Persisted skill secret at ${secretPath} is shorter than ${MIN_SKILL_SECRET_BYTES} bytes; regenerate it`,
      };
    }
    logger.info("Skill API secret loaded from file", { path: secretPath });
    return { ok: true, secret: trimmed, source: "file" };
  }

  // 3. Generate + persist with secure file hygiene (see atomicWritePrivate).
  const secret = generateSkillApiSecret();
  await atomicWritePrivate(secretPath, secret);
  logger.info("Skill API secret generated and persisted", { path: secretPath, bytes: 32 });
  return { ok: true, secret, source: "generated" };
}

/**
 * Atomically write `data` to `filePath` with secure file hygiene:
 *  - unpredictable, exclusive temp file (a planted symlink at a fixed `.tmp`
 *    name can never be followed),
 *  - temp file created with mode 0600 before the rename,
 *  - existing target rejected if it is a symlink.
 */
export async function atomicWritePrivate(filePath: string, data: string): Promise<void> {
  const parent = parentDir(filePath);
  await Deno.mkdir(parent, { recursive: true });
  const base = filePath.slice(parent.length + 1);
  const tmpPath = `${parent}/.${base}.tmp-${crypto.randomUUID()}`;
  try {
    const file = await Deno.open(tmpPath, { createNew: true, write: true, mode: 0o600 });
    try {
      await file.write(new TextEncoder().encode(data));
    } finally {
      file.close();
    }
    await Deno.chmod(tmpPath, 0o600);
    try {
      const target = await Deno.lstat(filePath);
      if (target.isSymlink) {
        throw new Error(`refusing to replace symlink target: ${filePath}`);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
    await Deno.rename(tmpPath, filePath);
  } catch (error) {
    await Deno.remove(tmpPath).catch(() => {});
    throw error;
  }
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : ".";
}

/**
 * Ensure the per-session JWT directory exists (mode 0700). Created once at bootstrap
 * so the orchestrator can write `{jwtDir}/{sessionId}.jwt` files at lease acquisition.
 */
export async function ensureSkillJwtDir(jwtDir: string): Promise<void> {
  await Deno.mkdir(jwtDir, { recursive: true });
  try {
    await Deno.chmod(jwtDir, 0o700);
  } catch {
    // chmod can fail on non-POSIX filesystems; not fatal.
  }
}
