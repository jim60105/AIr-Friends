// src/utils/runtime-platform.ts

import os from "node:os";

/**
 * Maps a runtime machine name onto the canonical architecture vocabulary.
 *
 * Bun reports `x86_64` on x86-64 but `arm64` on arm64, while `process.arch`
 * reports `x64`/`arm64`; application code and the OMP native cache key on
 * `x86_64`/`aarch64`. An unknown machine name is returned unchanged.
 */
export function runtimeArch(machine: string = os.machine()): string {
  switch (machine) {
    case "x86_64":
    case "x64":
    case "amd64":
      return "x86_64";
    case "aarch64":
    case "arm64":
      return "aarch64";
    default:
      return machine;
  }
}

/** Maps a Node platform name onto the canonical OS vocabulary. */
export function runtimeOs(platform: string = process.platform): string {
  return platform === "win32" ? "windows" : platform;
}
