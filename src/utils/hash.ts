// src/utils/hash.ts

/**
 * SHA-256 hash a string or raw bytes, returning hex digest.
 * Uses Deno's built-in Web Crypto API.
 */
export async function sha256Hash(content: string | Uint8Array): Promise<string> {
  const data = typeof content === "string"
    ? new TextEncoder().encode(content)
    : new Uint8Array(content); // copy so the underlying buffer is a plain ArrayBuffer
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fields that may contain user content and should be hashed */
const CONTENT_FIELDS = ["content", "query", "text", "message", "replyContent"];

/**
 * Sanitize skill parameters for audit logging.
 * When hashContent is true, known content fields are SHA-256 hashed recursively.
 */
export async function sanitizeSkillParams(
  params: Record<string, unknown>,
  hashContent: boolean,
): Promise<Record<string, unknown>> {
  if (!hashContent) return { ...params };

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (CONTENT_FIELDS.includes(key) && typeof value === "string") {
      sanitized[key] = `sha256:${await sha256Hash(value)}`;
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      sanitized[key] = await sanitizeSkillParams(
        value as Record<string, unknown>,
        hashContent,
      );
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
