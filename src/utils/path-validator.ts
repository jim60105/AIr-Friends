// src/utils/path-validator.ts

import { normalize, relative, resolve } from "@std/path";
import { ErrorCode, WorkspaceError } from "../types/errors.ts";

/**
 * Validate that a path is within the allowed boundary
 * Prevents path traversal attacks (e.g., ../../../etc/passwd)
 */
export function validatePathWithinBoundary(
  targetPath: string,
  boundaryPath: string,
): void {
  const normalizedTarget = resolve(normalize(targetPath));
  const normalizedBoundary = resolve(normalize(boundaryPath));

  // Check if target is within boundary
  const relativePath = relative(normalizedBoundary, normalizedTarget);

  // If relative path starts with ".." it means target is outside boundary
  if (relativePath.startsWith("..") || relativePath.startsWith("/")) {
    throw new WorkspaceError(
      ErrorCode.WORKSPACE_ACCESS_DENIED,
      `Path access denied: ${targetPath} is outside workspace boundary`,
      { targetPath, boundaryPath },
    );
  }
}

/**
 * Sanitize path components to prevent directory traversal
 */
export function sanitizePathComponent(component: string): string {
  // Remove any path separators or traversal sequences
  return component
    .replace(/[\/\\]/g, "_")
    .replace(/\.\./g, "_")
    .replace(/^\.+/, "")
    .trim();
}

/**
 * Check if a path exists and is accessible
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDirectory(path: string): Promise<void> {
  try {
    await Deno.mkdir(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }
}
