// src/dashboard/auth.ts

import { createLogger } from "@utils/logger.ts";
import { timingSafeEqual } from "node:crypto";

const _logger = createLogger("DashboardAuth");

/**
 * Server-side session token store with expiration
 */
export class SessionTokenStore {
  private tokens: Map<string, { createdAt: number; lastAccessedAt: number }> = new Map();
  readonly maxAgeMs: number;
  private idleTimeoutMs: number;

  constructor(maxAgeMs: number = 86400000, idleTimeoutMs: number = 3600000) {
    this.maxAgeMs = maxAgeMs;
    this.idleTimeoutMs = idleTimeoutMs;
  }

  /** Store a new session token */
  add(token: string): void {
    const now = Date.now();
    this.tokens.set(token, { createdAt: now, lastAccessedAt: now });
  }

  /** Check if a token is valid (checks max age and idle timeout) */
  has(token: string): boolean {
    const entry = this.tokens.get(token);
    if (!entry) return false;

    const now = Date.now();
    if (now - entry.createdAt > this.maxAgeMs || now - entry.lastAccessedAt > this.idleTimeoutMs) {
      this.tokens.delete(token);
      return false;
    }

    entry.lastAccessedAt = now;
    return true;
  }

  /** Remove a session token */
  remove(token: string): void {
    this.tokens.delete(token);
  }

  /** Get the number of active sessions */
  get size(): number {
    return this.tokens.size;
  }
}

/**
 * Timing-safe passphrase validation using HMAC comparison.
 * By hashing both values with a fixed key, we normalize their lengths
 * before comparison, avoiding timing leaks from length differences.
 */
export async function validatePassphrase(input: string, configured: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode("passphrase-comparison-key"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const [inputHash, configuredHash] = await Promise.all([
    crypto.subtle.sign("HMAC", key, encoder.encode(input)),
    crypto.subtle.sign("HMAC", key, encoder.encode(configured)),
  ]);
  return timingSafeEqual(
    new Uint8Array(inputHash),
    new Uint8Array(configuredHash),
  );
}

/**
 * Generate a new session token using crypto.randomUUID()
 */
export function generateSessionToken(): string {
  return crypto.randomUUID();
}

/**
 * Parse Cookie header into key-value pairs
 */
export function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  for (const pair of cookieHeader.split(";")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const key = pair.substring(0, eqIdx).trim();
    const value = pair.substring(eqIdx + 1).trim();
    cookies[key] = value;
  }
  return cookies;
}

/**
 * Create a session cookie with HttpOnly and SameSite=Strict
 */
export function createSessionCookie(
  token: string,
  options?: { maxAgeSeconds?: number; secure?: boolean },
): string {
  let cookie = `dashboard_session=${token}; HttpOnly; SameSite=Strict; Path=/`;
  if (options?.maxAgeSeconds !== undefined) {
    cookie += `; Max-Age=${options.maxAgeSeconds}`;
  }
  if (options?.secure) {
    cookie += "; Secure";
  }
  return cookie;
}

/**
 * Create an expired cookie to clear the session
 */
export function clearSessionCookie(): string {
  return `dashboard_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

/**
 * Login rate limiter using sliding window
 */
export class LoginRateLimiter {
  private attempts: Map<string, number[]> = new Map();
  private maxAttempts: number;
  private windowMs: number;

  constructor(maxAttempts: number = 5, windowMs: number = 60000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  /** Check if an IP is allowed to attempt login */
  isAllowed(ip: string): boolean {
    const now = Date.now();
    const timestamps = this.attempts.get(ip);
    if (!timestamps) return true;

    // Prune old timestamps
    const recent = timestamps.filter((t) => now - t < this.windowMs);
    this.attempts.set(ip, recent);

    return recent.length < this.maxAttempts;
  }

  /** Record a login attempt */
  recordAttempt(ip: string): void {
    const timestamps = this.attempts.get(ip) ?? [];
    timestamps.push(Date.now());
    this.attempts.set(ip, timestamps);
  }
}

// Global token store instance
export const tokenStore = new SessionTokenStore();
