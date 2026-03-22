// src/dashboard/auth.ts

import { createLogger } from "@utils/logger.ts";

const _logger = createLogger("DashboardAuth");

/**
 * Server-side session token store
 */
export class SessionTokenStore {
  private tokens: Map<string, { createdAt: number }> = new Map();

  /** Store a new session token */
  add(token: string): void {
    this.tokens.set(token, { createdAt: Date.now() });
  }

  /** Check if a token is valid */
  has(token: string): boolean {
    return this.tokens.has(token);
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
 * Constant-time string comparison to prevent timing attacks
 */
export function validatePassphrase(input: string, configured: string): boolean {
  if (input.length !== configured.length) {
    // Still do a comparison to maintain constant-ish time
    let result = 1;
    for (let i = 0; i < input.length; i++) {
      result |= input.charCodeAt(i) ^ (configured.charCodeAt(i % configured.length) || 0);
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < input.length; i++) {
    result |= input.charCodeAt(i) ^ configured.charCodeAt(i);
  }
  return result === 0;
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
export function createSessionCookie(token: string): string {
  return `dashboard_session=${token}; HttpOnly; SameSite=Strict; Path=/`;
}

/**
 * Create an expired cookie to clear the session
 */
export function clearSessionCookie(): string {
  return `dashboard_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

// Global token store instance
export const tokenStore = new SessionTokenStore();
