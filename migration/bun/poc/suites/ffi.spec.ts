/**
 * FFI confinement suite: drives the unmodified production
 * `performLinuxSecureAccess` through the `bun:ffi` backend against a real
 * kernel. Each test title starts with the criterion ID the gate matches.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodeLinuxDev,
  ERRNO,
  type LinuxNativeCalls,
  performLinuxSecureAccess,
} from "../../../../src/acp/filesystem-access-linux.ts";
import { createBunLinuxNativeCalls } from "../ffi/bun-linux-native-calls.ts";
import { openFdCount, readOptions, writeOptions } from "./ffi-helpers.ts";

let base = "";
let root = "";
let outside = "";
let calls: LinuxNativeCalls;

/** Opens `path` with the backend and closes it, returning any errno seen. */
function openAt(path: string, flags: number): { fd: number; errno: number } {
  return calls.open(path, flags, 0);
}

function openat2Expecting(
  fd: number,
  pathname: string,
  flags: bigint,
  resolve: bigint,
): number {
  const opened = calls.openat2(fd, pathname, flags, 0n, resolve);
  if (opened.fd >= 0) calls.close(opened.fd);
  return opened.errno;
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "ffi-"));
  root = join(base, "root");
  mkdirSync(root);
  mkdirSync(join(root, "dir"));
  writeFileSync(join(root, "real.txt"), "real content");
  symlinkSync("real.txt", join(root, "link.txt"));
  outside = join(base, "outside.txt");
  writeFileSync(outside, "outside content");
  writeFileSync(join(root, "cycle.txt"), "cycle");
  const backend = createBunLinuxNativeCalls();
  if (!backend.calls) throw new Error(JSON.stringify(backend.error));
  calls = backend.calls;
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

test("FFI-01: a symlink component yields ELOOP and unsafe_traversal", () => {
  const c = calls.getArchitectureConstants();
  const rootFd = openAt(root, c.O_PATH | c.O_DIRECTORY | c.O_CLOEXEC);
  expect(rootFd.fd).toBeGreaterThanOrEqual(0);
  try {
    const errno = openat2Expecting(
      rootFd.fd,
      "link.txt",
      BigInt(c.O_RDONLY | c.O_CLOEXEC),
      c.RESOLVE_BENEATH | c.RESOLVE_NO_SYMLINKS | c.RESOLVE_NO_MAGICLINKS,
    );
    expect(errno).toBe(ERRNO.ELOOP);
  } finally {
    calls.close(rootFd.fd);
  }

  const access = performLinuxSecureAccess(readOptions(root, "link.txt", calls));
  expect(access.ok).toBe(false);
  if (!access.ok) expect(access.reason).toBe("unsafe_traversal");
});

test("FFI-02: a directory escape yields EXDEV and outside_roots", () => {
  const c = calls.getArchitectureConstants();
  const rootFd = openAt(root, c.O_PATH | c.O_DIRECTORY | c.O_CLOEXEC);
  expect(rootFd.fd).toBeGreaterThanOrEqual(0);
  try {
    const errno = openat2Expecting(
      rootFd.fd,
      "../outside.txt",
      BigInt(c.O_RDONLY | c.O_CLOEXEC),
      c.RESOLVE_BENEATH | c.RESOLVE_NO_SYMLINKS | c.RESOLVE_NO_MAGICLINKS,
    );
    expect(errno).toBe(ERRNO.EXDEV);
  } finally {
    calls.close(rootFd.fd);
  }

  const access = performLinuxSecureAccess(readOptions(root, "../outside.txt", calls));
  expect(access.ok).toBe(false);
  if (!access.ok) expect(access.reason).toBe("outside_roots");
  expect(readFileSync(outside, "utf8")).toBe("outside content");
});

test("FFI-03: a missing target yields ENOENT and the production failure reason", () => {
  const c = calls.getArchitectureConstants();
  const rootFd = openAt(root, c.O_PATH | c.O_DIRECTORY | c.O_CLOEXEC);
  expect(rootFd.fd).toBeGreaterThanOrEqual(0);
  try {
    const errno = openat2Expecting(
      rootFd.fd,
      "missing.txt",
      BigInt(c.O_RDONLY | c.O_CLOEXEC),
      c.RESOLVE_BENEATH | c.RESOLVE_NO_SYMLINKS | c.RESOLVE_NO_MAGICLINKS,
    );
    expect(errno).toBe(ERRNO.ENOENT);
  } finally {
    calls.close(rootFd.fd);
  }

  const read = performLinuxSecureAccess(readOptions(root, "missing.txt", calls));
  expect(read.ok).toBe(false);
  if (!read.ok) expect(read.reason).toBe("path_changed");

  const created = performLinuxSecureAccess(
    writeOptions(root, "no-such-dir/new.txt", "content", true, calls),
  );
  expect(created.ok).toBe(false);
  if (!created.ok) expect(created.reason).toBe("parent_missing");
});

test("FFI-04: 10,000 alternating failures keep every errno", async () => {
  const c = calls.getArchitectureConstants();
  const rootFd = openAt(root, c.O_PATH | c.O_DIRECTORY | c.O_CLOEXEC);
  expect(rootFd.fd).toBeGreaterThanOrEqual(0);
  const flags = BigInt(c.O_RDONLY | c.O_CLOEXEC);
  const resolve = c.RESOLVE_BENEATH | c.RESOLVE_NO_SYMLINKS | c.RESOLVE_NO_MAGICLINKS;
  const cases = [
    { path: "link.txt", errno: ERRNO.ELOOP },
    { path: "../outside.txt", errno: ERRNO.EXDEV },
    { path: "missing.txt", errno: ERRNO.ENOENT },
  ];
  try {
    for (let i = 0; i < 10_000; i++) {
      const expected = cases[i % 3]!;
      const errno = openat2Expecting(rootFd.fd, expected.path, flags, resolve);
      expect(errno).toBe(expected.errno);
      if (i % 256 === 0) await Bun.sleep(0);
      if (i % 1024 === 0) Bun.gc(false);
    }
  } finally {
    calls.close(rootFd.fd);
  }
});

test("FFI-05: statx type, inode and device agree with node:fs for a file and a directory", () => {
  const c = calls.getArchitectureConstants();
  const required = c.STATX_TYPE | c.STATX_INO;

  const filePath = join(root, "real.txt");
  const fileFd = openAt(filePath, c.O_RDONLY | c.O_CLOEXEC);
  expect(fileFd.fd).toBeGreaterThanOrEqual(0);
  try {
    const observed = calls.statx(fileFd.fd);
    expect(observed.errno).toBe(0);
    expect(observed.statx).toBeDefined();
    const statx = observed.statx!;
    const expected = lstatSync(filePath, { bigint: true });
    const dev = decodeLinuxDev(Number(expected.dev));
    expect(statx.mask & required).toBe(required);
    expect(statx.mode & c.S_IFMT).toBe(Number(expected.mode) & c.S_IFMT);
    expect(statx.mode & c.S_IFMT).toBe(c.S_IFREG);
    expect(statx.ino).toBe(expected.ino);
    expect(statx.devMajor).toBe(dev.major);
    expect(statx.devMinor).toBe(dev.minor);
  } finally {
    calls.close(fileFd.fd);
  }

  const dirPath = join(root, "dir");
  const dirFd = openAt(dirPath, c.O_PATH | c.O_DIRECTORY | c.O_CLOEXEC);
  expect(dirFd.fd).toBeGreaterThanOrEqual(0);
  try {
    const observed = calls.statx(dirFd.fd);
    expect(observed.errno).toBe(0);
    expect(observed.statx).toBeDefined();
    const statx = observed.statx!;
    const expected = lstatSync(dirPath, { bigint: true });
    const dev = decodeLinuxDev(Number(expected.dev));
    expect(statx.mask & required).toBe(required);
    expect(statx.mode & c.S_IFMT).toBe(Number(expected.mode) & c.S_IFMT);
    expect(statx.mode & c.S_IFMT).toBe(c.S_IFDIR);
    expect(statx.ino).toBe(expected.ino);
    expect(statx.devMajor).toBe(dev.major);
    expect(statx.devMinor).toBe(dev.minor);
  } finally {
    calls.close(dirFd.fd);
  }
});

test("FFI-06: a 200 KiB multibyte read round trips through performLinuxSecureAccess", () => {
  const unit = "正體中文 multi-byte payload ";
  const content = unit.repeat(Math.ceil((200 * 1024) / unit.length));
  const path = join(root, "bulk.txt");
  writeFileSync(path, content);
  expect(readFileSync(path, "utf8")).toBe(content);

  const result = performLinuxSecureAccess<string>(readOptions(root, "bulk.txt", calls));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toBe(content);
});

test("FFI-06: exclusive create writes a new file and refuses a collision", () => {
  const path = join(root, "created.txt");
  const created = performLinuxSecureAccess(
    writeOptions(root, "created.txt", "created content", true, calls),
  );
  expect(created.ok).toBe(true);
  expect(readFileSync(path, "utf8")).toBe("created content");

  const collision = performLinuxSecureAccess(
    writeOptions(root, "created.txt", "must not replace", true, calls),
  );
  expect(collision.ok).toBe(false);
  if (!collision.ok) expect(collision.reason).toBe("path_changed");
  expect(readFileSync(path, "utf8")).toBe("created content");
});

test("FFI-06: overwrite truncates to exactly the new content", () => {
  const path = join(root, "overwrite.txt");
  writeFileSync(path, "x".repeat(4096));
  const result = performLinuxSecureAccess(
    writeOptions(root, "overwrite.txt", "short", false, calls),
  );
  expect(result.ok).toBe(true);
  expect(readFileSync(path, "utf8")).toBe("short");
});

test("FFI-07: an absent or unloadable libc fails closed with secure_access_unavailable", () => {
  const absent = createBunLinuxNativeCalls({ libcPath: "/nonexistent/libc.so.6" });
  expect(absent.calls).toBeUndefined();
  expect(absent.error?.reason).toBe("secure_access_unavailable");

  const textFile = join(base, "not-a-library.txt");
  writeFileSync(textFile, "this file is not a shared library");
  const unloadable = createBunLinuxNativeCalls({ libcPath: textFile });
  expect(unloadable.calls).toBeUndefined();
  expect(unloadable.error?.reason).toBe("secure_access_unavailable");
});

test("FFI-09: 1,000 mixed operations leave the open descriptor count unchanged", () => {
  const operation = (i: number): void => {
    if (i % 3 === 0) {
      expect(performLinuxSecureAccess(readOptions(root, "real.txt", calls)).ok).toBe(true);
      return;
    }
    if (i % 3 === 1) {
      expect(performLinuxSecureAccess(writeOptions(root, "cycle.txt", "cycle", false, calls)).ok)
        .toBe(true);
      return;
    }
    const denied = performLinuxSecureAccess(readOptions(root, "link.txt", calls));
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.reason).toBe("unsafe_traversal");
  };

  for (let i = 0; i < 100; i++) operation(i);
  const before = openFdCount();
  for (let i = 0; i < 1_000; i++) operation(i);
  expect(openFdCount()).toBe(before);
});
