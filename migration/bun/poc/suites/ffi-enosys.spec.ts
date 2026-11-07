/**
 * FFI ENOSYS suite: runs under the seccomp profile that rejects `openat2` with
 * ENOSYS, proving the backend fails closed instead of falling back to an
 * unconfined path.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ERRNO,
  type LinuxNativeCalls,
  performLinuxSecureAccess,
} from "../../../../src/acp/filesystem-access-linux.ts";
import { createBunLinuxNativeCalls } from "../ffi/bun-linux-native-calls.ts";
import { readOptions } from "./ffi-helpers.ts";

let base = "";
let root = "";
let calls: LinuxNativeCalls;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "ffi-enosys-"));
  root = join(base, "root");
  mkdirSync(root);
  writeFileSync(join(root, "real.txt"), "real content");
  const backend = createBunLinuxNativeCalls();
  if (!backend.calls) throw new Error(JSON.stringify(backend.error));
  calls = backend.calls;
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

test("FFI-08: ENOSYS from openat2 fails closed with secure_access_unavailable", () => {
  const c = calls.getArchitectureConstants();
  const rootFd = calls.open(root, c.O_PATH | c.O_DIRECTORY | c.O_CLOEXEC, 0);
  expect(rootFd.fd).toBeGreaterThanOrEqual(0);
  try {
    const opened = calls.openat2(
      rootFd.fd,
      "real.txt",
      BigInt(c.O_RDONLY | c.O_CLOEXEC),
      0n,
      c.RESOLVE_BENEATH | c.RESOLVE_NO_SYMLINKS | c.RESOLVE_NO_MAGICLINKS,
    );
    expect(opened.fd).toBe(-1);
    expect(opened.errno).toBe(ERRNO.ENOSYS);
    expect(opened.errno).toBe(38);
  } finally {
    calls.close(rootFd.fd);
  }

  const access = performLinuxSecureAccess(readOptions(root, "real.txt", calls));
  expect(access.ok).toBe(false);
  if (!access.ok) expect(access.reason).toBe("secure_access_unavailable");
});
