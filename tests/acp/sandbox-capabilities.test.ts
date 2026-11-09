// tests/acp/sandbox-capabilities.test.ts
//
// P0-7 (source design section 4.7): the sandbox probes execute the REAL tools and fail
// closed. Every scenario below runs real child processes through a `PATH` this file merely
// controls, so a `which`-style existence check can never satisfy them: capability is
// reported only when the fixed probe command exits 0, and a missing tool, non-zero exit or
// non-Linux platform reports the capability as absent.

import { assertEquals } from "@std/assert";
import { spawnSync } from "node:child_process";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import {
  probeFilesystemConfinement,
  probeNetworkNamespace,
  resetSandboxCapabilityCache,
} from "../../src/acp/sandbox-capabilities.ts";
import { makeTempDir } from "../../src/utils/fs-compat.ts";

/** Run `fn` with `process.env.PATH` replaced, restoring the original value afterwards. */
async function withPath<T>(pathValue: string, fn: () => T): Promise<T> {
  const original = process.env["PATH"];
  process.env["PATH"] = pathValue;
  try {
    return await fn();
  } finally {
    if (original === undefined) {
      delete process.env["PATH"];
    } else {
      process.env["PATH"] = original;
    }
  }
}

/**
 * A temp dir holding executable `/bin/sh` stubs for the named tools. A tool omitted from
 * `exitCodes` is absent, which is how the "missing" scenario is expressed.
 */
async function stubDir(
  exitCodes: { unshare?: number; bwrap?: number },
): Promise<string> {
  const dir = await makeTempDir();
  for (const name of ["unshare", "bwrap"] as const) {
    const exitCode = exitCodes[name];
    if (exitCode === undefined) continue;
    await fsp.writeFile(`${dir}/${name}`, `#!/bin/sh\nexit ${exitCode}\n`);
    await fsp.chmod(`${dir}/${name}`, 0o755);
  }
  return dir;
}

test("sandbox capabilities - a bwrap that exits 0 reports filesystem confinement", async () => {
  resetSandboxCapabilityCache();
  const dir = await stubDir({ bwrap: 0 });
  try {
    await withPath(dir, () => {
      assertEquals(probeFilesystemConfinement(), true);
    });
  } finally {
    await fsp.rm(dir, { recursive: true });
    resetSandboxCapabilityCache();
  }
});

test("sandbox capabilities - an unshare that exits 1 reports no network namespace", async () => {
  resetSandboxCapabilityCache();
  const dir = await stubDir({ unshare: 1 });
  try {
    await withPath(dir, () => {
      assertEquals(probeNetworkNamespace(), false);
    });
  } finally {
    await fsp.rm(dir, { recursive: true });
    resetSandboxCapabilityCache();
  }
});

test("sandbox capabilities - a missing bwrap reports false without throwing", async () => {
  resetSandboxCapabilityCache();
  const dir = await stubDir({ unshare: 0 });
  try {
    await withPath(dir, () => {
      assertEquals(probeFilesystemConfinement(), false);
    });
  } finally {
    await fsp.rm(dir, { recursive: true });
    resetSandboxCapabilityCache();
  }
});

test("sandbox capabilities - the real host agrees with the network-namespace probe", async () => {
  resetSandboxCapabilityCache();
  const originalPath = process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin";
  try {
    // The probe must equal what the fixed command reports when run directly on this host.
    const probed = await withPath(originalPath, () => probeNetworkNamespace());
    const direct = spawnSync("unshare", ["--user", "--map-root", "--net", "true"], {
      stdio: "ignore",
    });
    assertEquals(probed, direct.error === undefined && direct.status === 0);
  } finally {
    resetSandboxCapabilityCache();
  }
});
