// src/utils/fs-compat.ts

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import { join, sep } from "node:path";

export interface TempOptions {
  prefix?: string;
  suffix?: string;
  dir?: string;
}

/** Reads the errno `code` of a thrown value, ignoring anything that is not an object. */
function errorCode(error: unknown): unknown {
  if (error === null || typeof error !== "object" || !("code" in error)) return undefined;
  return error.code;
}

/** `Deno.errors.NotFound` semantics. */
export function isNotFoundError(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

/** `Deno.errors.AlreadyExists` semantics. */
export function isAlreadyExistsError(error: unknown): boolean {
  return errorCode(error) === "EEXIST";
}

/** `Deno.errors.PermissionDenied` semantics. */
export function isPermissionDeniedError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EACCES" || code === "EPERM";
}

/**
 * `Deno.remove` semantics: removes a file, a symbolic link without following it,
 * or an empty directory. A non-empty directory and a missing path reject.
 */
export async function removePath(path: string): Promise<void> {
  const info = await fsp.lstat(path);
  if (info.isDirectory()) await fsp.rmdir(path);
  else await fsp.unlink(path);
}

export function removePathSync(path: string): void {
  const info = fs.lstatSync(path);
  if (info.isDirectory()) fs.rmdirSync(path);
  else fs.unlinkSync(path);
}

/**
 * Builds the `mkdtemp` template. Node appends its random characters directly to
 * the template, so an empty prefix must still end with a separator or the entry
 * would be created beside the directory instead of inside it.
 */
function tempDirTemplate(options: TempOptions): string {
  const directory = options.dir ?? os.tmpdir();
  const prefix = options.prefix ?? "";
  if (prefix === "") return directory.endsWith(sep) ? directory : `${directory}${sep}`;
  return join(directory, prefix);
}

function tempFileName(options: TempOptions): string {
  const prefix = options.prefix ?? "";
  const suffix = options.suffix ?? "";
  return join(options.dir ?? os.tmpdir(), `${prefix}${randomUUID()}${suffix}`);
}

/** `Deno.makeTempDir` semantics; the directory is created with mode `0o700`. */
export async function makeTempDir(options: TempOptions = {}): Promise<string> {
  const created = await fsp.mkdtemp(tempDirTemplate(options));
  const suffix = options.suffix ?? "";
  if (suffix === "") return created;
  const renamed = `${created}${suffix}`;
  await fsp.rename(created, renamed);
  return renamed;
}

export function makeTempDirSync(options: TempOptions = {}): string {
  const created = fs.mkdtempSync(tempDirTemplate(options));
  const suffix = options.suffix ?? "";
  if (suffix === "") return created;
  const renamed = `${created}${suffix}`;
  fs.renameSync(created, renamed);
  return renamed;
}

/** `Deno.makeTempFile` semantics; the empty file is created with mode `0o600`. */
export async function makeTempFile(options: TempOptions = {}): Promise<string> {
  const path = tempFileName(options);
  const handle = await fsp.open(path, "wx", 0o600);
  await handle.close();
  return path;
}

export function makeTempFileSync(options: TempOptions = {}): string {
  const path = tempFileName(options);
  const descriptor = fs.openSync(path, "wx", 0o600);
  fs.closeSync(descriptor);
  return path;
}

/**
 * `@std/fs` `exists` semantics: `stat` (following symbolic links), `ENOENT`
 * resolves false, any other error is rethrown.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await fsp.stat(path);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}
