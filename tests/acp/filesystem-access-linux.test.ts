import { assertEquals } from "@std/assert";
import {
  AARCH64_CONSTANTS,
  decodeLinuxDev,
  encodeOpenHow,
  ERRNO,
  getRealLinuxNativeCalls,
  type LinuxNativeCalls,
  mapLinuxErrnoToFailure,
  parseStatxBuffer,
  X86_64_CONSTANTS,
} from "../../src/acp/filesystem-access-linux.ts";
import {
  isValidRelativeComponentPath,
  isValidSafeIdentity,
  readCanonicalTextFile,
  writeCanonicalTextFile,
} from "../../src/acp/filesystem-access.ts";
import type {
  CanonicalSessionRoots,
  CanonicalTarget,
  SessionContext,
} from "../../src/acp/filesystem-roots.ts";

Deno.test("Linux architecture constants alignment: x86_64 vs aarch64", () => {
  // Common constants
  assertEquals(X86_64_CONSTANTS.SYS_openat2, 437n);
  assertEquals(AARCH64_CONSTANTS.SYS_openat2, 437n);
  assertEquals(X86_64_CONSTANTS.O_PATH, 0o10000000);
  assertEquals(AARCH64_CONSTANTS.O_PATH, 0o10000000);
  assertEquals(X86_64_CONSTANTS.O_CLOEXEC, 0o2000000);
  assertEquals(AARCH64_CONSTANTS.O_CLOEXEC, 0o2000000);
  assertEquals(X86_64_CONSTANTS.RESOLVE_BENEATH, 0x08n);
  assertEquals(AARCH64_CONSTANTS.RESOLVE_BENEATH, 0x08n);
  assertEquals(X86_64_CONSTANTS.RESOLVE_NO_SYMLINKS, 0x04n);
  assertEquals(AARCH64_CONSTANTS.RESOLVE_NO_SYMLINKS, 0x04n);
  assertEquals(X86_64_CONSTANTS.RESOLVE_NO_MAGICLINKS, 0x02n);
  assertEquals(AARCH64_CONSTANTS.RESOLVE_NO_MAGICLINKS, 0x02n);

  // Architecture differences
  assertEquals(X86_64_CONSTANTS.O_DIRECTORY, 0o200000);
  assertEquals(AARCH64_CONSTANTS.O_DIRECTORY, 0o40000);

  assertEquals(X86_64_CONSTANTS.O_NOFOLLOW, 0o400000);
  assertEquals(AARCH64_CONSTANTS.O_NOFOLLOW, 0o100000);
});

Deno.test("decodeLinuxDev handles standard and high-bit 64-bit device numbers", () => {
  // Normal dev: major 8, minor 1 => (8 << 8) | 1 = 2049
  const standardDev = (8 << 8) | 1;
  const decoded = decodeLinuxDev(standardDev);
  assertEquals(decoded.major, 8n);
  assertEquals(decoded.minor, 1n);

  // High-bit device number: major 4096 (1 << 12), minor 0 => 1n << 44n
  const highBitDevNum = Number(1n << 44n);
  const decodedHigh = decodeLinuxDev(highBitDevNum);
  assertEquals(decodedHigh.major, 4096n);
  assertEquals(decodedHigh.minor, 0n);
});

Deno.test("encodeOpenHow encodes 24-byte struct with little-endian uint64s", () => {
  const flags = 0x123456789abcdef0n;
  const mode = 0o600n;
  const resolve = 0x0e00000000000000n;
  const encoded = encodeOpenHow(flags, mode, resolve);

  assertEquals(encoded.byteLength, 24);
  const view = new DataView(encoded.buffer);
  assertEquals(view.getBigUint64(0, true), flags);
  assertEquals(view.getBigUint64(8, true), mode);
  assertEquals(view.getBigUint64(16, true), resolve);
});

Deno.test("parseStatxBuffer correctly parses 256-byte little-endian statx layout", () => {
  const buf = new Uint8Array(256);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x07ff, true); // stx_mask
  view.setUint16(28, 0o100644, true); // stx_mode
  view.setBigUint64(32, 987654321n, true); // stx_ino
  view.setUint32(136, 8, true); // stx_dev_major
  view.setUint32(140, 2, true); // stx_dev_minor

  const res = parseStatxBuffer(buf);
  assertEquals(res.mask, 0x07ff);
  assertEquals(res.mode, 0o100644);
  assertEquals(res.ino, 987654321n);
  assertEquals(res.devMajor, 8n);
  assertEquals(res.devMinor, 2n);
});

Deno.test("isValidSafeIdentity checks safe non-negative finite integer dev/ino", () => {
  assertEquals(isValidSafeIdentity(undefined), false);
  assertEquals(isValidSafeIdentity({ dev: -1, ino: 1 }), false);
  assertEquals(isValidSafeIdentity({ dev: 1, ino: -1 }), false);
  assertEquals(isValidSafeIdentity({ dev: 1.5, ino: 2 }), false);
  assertEquals(
    isValidSafeIdentity({ dev: 1, ino: Number.MAX_SAFE_INTEGER + 10 }),
    false,
  );
  assertEquals(isValidSafeIdentity({ dev: 2049, ino: 12345 }), true);
});

Deno.test("isValidRelativeComponentPath rejects null bytes, empty parts, and parent traversal", () => {
  assertEquals(isValidRelativeComponentPath(""), false);
  assertEquals(isValidRelativeComponentPath("foo/../bar"), false);
  assertEquals(isValidRelativeComponentPath("foo/./bar"), false);
  assertEquals(isValidRelativeComponentPath("foo\0bar"), false);
  assertEquals(isValidRelativeComponentPath("foo\\bar"), false);
  assertEquals(isValidRelativeComponentPath("foo/bar/baz.txt"), true);
  assertEquals(isValidRelativeComponentPath("baz.txt"), true);
});

Deno.test("mapLinuxErrnoToFailure maps phases and errnos accurately", () => {
  assertEquals(
    mapLinuxErrnoToFailure(ERRNO.ENOSYS, "root_open", "test").reason,
    "secure_access_unavailable",
  );
  assertEquals(
    mapLinuxErrnoToFailure(ERRNO.ELOOP, "file_open_existing", "test").reason,
    "unsafe_traversal",
  );
  assertEquals(
    mapLinuxErrnoToFailure(ERRNO.EXDEV, "file_open_existing", "test").reason,
    "outside_roots",
  );
  assertEquals(
    mapLinuxErrnoToFailure(ERRNO.EAGAIN, "file_open_existing", "test").reason,
    "path_changed",
  );
  assertEquals(
    mapLinuxErrnoToFailure(ERRNO.EAGAIN, "read_io", "test").reason,
    "io_failed",
  );
  assertEquals(
    mapLinuxErrnoToFailure(ERRNO.ENOENT, "root_open", "test").reason,
    "root_unavailable",
  );
  assertEquals(
    mapLinuxErrnoToFailure(ERRNO.ENOENT, "parent_open", "test").reason,
    "parent_missing",
  );
  assertEquals(
    mapLinuxErrnoToFailure(ERRNO.ENOENT, "file_open_existing", "test").reason,
    "path_changed",
  );
  assertEquals(
    mapLinuxErrnoToFailure(ERRNO.EEXIST, "file_create_exclusive", "test")
      .reason,
    "path_changed",
  );
  assertEquals(
    mapLinuxErrnoToFailure(ERRNO.EISDIR, "file_open_existing", "test").reason,
    "wrong_target_type",
  );
  assertEquals(
    mapLinuxErrnoToFailure(ERRNO.EACCES, "read_io", "test").reason,
    "access_denied",
  );
});

function createBaseFixture() {
  const context: SessionContext = {
    acpSessionId: "sess-1",
    skillSessionId: "skill-1",
    sessionCwd: "/workspace",
    explicitStagingPath: "/workspace/tmp/skill-1",
    sessionContextGeneration: "gen-1",
  };

  const roots: CanonicalSessionRoots = {
    acpSessionId: "sess-1",
    sessionContextGeneration: "gen-1",
    roots: [
      {
        role: "workspace",
        configuredPath: "/workspace",
        canonicalPath: "/workspace",
        identity: { dev: 2049, ino: 100 },
        readOnly: false,
      },
    ],
  };

  const target: CanonicalTarget = {
    acpSessionId: "sess-1",
    sessionContextGeneration: "gen-1",
    roles: ["workspace"],
    rootIdentities: [roots.roots[0]],
    normalizedInput: "file.txt",
    canonicalTarget: "/workspace/file.txt",
    rootRelativePath: "file.txt",
    targetType: "file",
    targetIdentity: { dev: 2049, ino: 200 },
    observedSymlinks: [],
  };

  return { context, roots, target };
}

Deno.test("Mock native boundary: handles deterministic failure injection and cleanup", () => {
  const { context, roots, target } = createBaseFixture();
  const closedFds: number[] = [];
  const mockCalls: LinuxNativeCalls = {
    getArchitectureConstants: () => X86_64_CONSTANTS,
    open: (_path, _flags, _mode) => ({ fd: 10, errno: 0 }),
    openat2: (_dirfd, pathname, _flags, _mode, _resolve) => {
      if (pathname === "workspace") {
        return { fd: 11, errno: 0 };
      }
      return { fd: -1, errno: ERRNO.ENOENT };
    },
    statx: (_fd) => ({
      statx: {
        mask: 0x07ff,
        mode: 0o040755,
        ino: 100n,
        devMajor: 8n,
        devMinor: 1n,
      },
      errno: 0,
    }),
    read: () => ({ bytesRead: 0, errno: 0 }),
    write: () => ({ bytesWritten: 0, errno: 0 }),
    ftruncate: () => ({ result: 0, errno: 0 }),
    close: (fd) => {
      closedFds.push(fd);
      return { result: 0, errno: 0 };
    },
  };

  const res = readCanonicalTextFile({
    context,
    roots,
    target,
    selectedRole: "workspace",
    nativeCalls: mockCalls,
  });

  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.reason, "path_changed");
  }
  assertEquals(closedFds.includes(10), true);
  assertEquals(closedFds.includes(11), true);
});

Deno.test("Mock native boundary: successful multi-chunk read with streaming UTF-8", () => {
  const { context, roots, target } = createBaseFixture();
  const closedFds: number[] = [];
  const fullBytes = new TextEncoder().encode(
    "Hello, 🌍 World! Multi-byte sequence across chunk boundary.",
  );
  let readOffset = 0;

  const mockCalls: LinuxNativeCalls = {
    getArchitectureConstants: () => X86_64_CONSTANTS,
    open: () => ({ fd: 10, errno: 0 }),
    openat2: (_dirfd, pathname) => ({
      fd: pathname === "workspace" ? 11 : 12,
      errno: 0,
    }),
    statx: (fd) => {
      if (fd === 11) {
        return {
          statx: {
            mask: 0x07ff,
            mode: 0o040755,
            ino: 100n,
            devMajor: 8n,
            devMinor: 1n,
          },
          errno: 0,
        };
      }
      return {
        statx: {
          mask: 0x07ff,
          mode: 0o100644,
          ino: 200n,
          devMajor: 8n,
          devMinor: 1n,
        },
        errno: 0,
      };
    },
    read: (_fd, buffer) => {
      if (readOffset >= fullBytes.byteLength) {
        return { bytesRead: 0, errno: 0 }; // EOF
      }
      // Read in tiny chunks of 7 bytes to test multi-byte streaming boundary
      const toRead = Math.min(
        7,
        fullBytes.byteLength - readOffset,
        buffer.byteLength,
      );
      buffer.set(fullBytes.subarray(readOffset, readOffset + toRead));
      readOffset += toRead;
      return { bytesRead: toRead, errno: 0 };
    },
    write: () => ({ bytesWritten: 0, errno: 0 }),
    ftruncate: () => ({ result: 0, errno: 0 }),
    close: (fd) => {
      closedFds.push(fd);
      return { result: 0, errno: 0 };
    },
  };

  const res = readCanonicalTextFile({
    context,
    roots,
    target,
    selectedRole: "workspace",
    nativeCalls: mockCalls,
  });

  assertEquals(res.ok, true);
  if (res.ok) {
    assertEquals(
      res.value,
      "Hello, 🌍 World! Multi-byte sequence across chunk boundary.",
    );
  }
  assertEquals(closedFds.includes(10), true);
  assertEquals(closedFds.includes(11), true);
  assertEquals(closedFds.includes(12), true);
});

Deno.test("Mock native boundary: existing file overwrite truncates and writes full content", () => {
  const { context, roots, target } = createBaseFixture();
  let ftruncateCalledWith: bigint | null = null;
  const writtenChunks: Uint8Array[] = [];

  const mockCalls: LinuxNativeCalls = {
    getArchitectureConstants: () => X86_64_CONSTANTS,
    open: () => ({ fd: 10, errno: 0 }),
    openat2: (_dirfd, pathname) => ({
      fd: pathname === "workspace" ? 11 : 12,
      errno: 0,
    }),
    statx: (fd) => {
      if (fd === 11) {
        return {
          statx: {
            mask: 0x07ff,
            mode: 0o040755,
            ino: 100n,
            devMajor: 8n,
            devMinor: 1n,
          },
          errno: 0,
        };
      }
      return {
        statx: {
          mask: 0x07ff,
          mode: 0o100644,
          ino: 200n,
          devMajor: 8n,
          devMinor: 1n,
        },
        errno: 0,
      };
    },
    read: () => ({ bytesRead: 0, errno: 0 }),
    write: (_fd, buffer) => {
      writtenChunks.push(new Uint8Array(buffer));
      return { bytesWritten: buffer.byteLength, errno: 0 };
    },
    ftruncate: (_fd, length) => {
      ftruncateCalledWith = length;
      return { result: 0, errno: 0 };
    },
    close: () => ({ result: 0, errno: 0 }),
  };

  const res = writeCanonicalTextFile({
    context,
    roots,
    target,
    selectedRole: "workspace",
    content: "New overwrite text content 🚀",
    nativeCalls: mockCalls,
  });

  assertEquals(res.ok, true);
  assertEquals(ftruncateCalledWith, 0n);
  const totalWritten = new TextDecoder().decode(
    new Uint8Array(writtenChunks.flatMap((c) => Array.from(c))),
  );
  assertEquals(totalWritten, "New overwrite text content 🚀");
});

Deno.test("Mock native boundary: replacement file detected before ftruncate denies overwrite", () => {
  const { context, roots, target } = createBaseFixture();
  let ftruncateCalled = false;

  const mockCalls: LinuxNativeCalls = {
    getArchitectureConstants: () => X86_64_CONSTANTS,
    open: () => ({ fd: 10, errno: 0 }),
    openat2: (_dirfd, pathname) => ({
      fd: pathname === "workspace" ? 11 : 12,
      errno: 0,
    }),
    statx: (fd) => {
      if (fd === 11) {
        return {
          statx: {
            mask: 0x07ff,
            mode: 0o040755,
            ino: 100n,
            devMajor: 8n,
            devMinor: 1n,
          },
          errno: 0,
        };
      }
      // Replaced inode! Target observation expected 200n, but file has 999n!
      return {
        statx: {
          mask: 0x07ff,
          mode: 0o100644,
          ino: 999n,
          devMajor: 8n,
          devMinor: 1n,
        },
        errno: 0,
      };
    },
    read: () => ({ bytesRead: 0, errno: 0 }),
    write: () => ({ bytesWritten: 0, errno: 0 }),
    ftruncate: () => {
      ftruncateCalled = true;
      return { result: 0, errno: 0 };
    },
    close: () => ({ result: 0, errno: 0 }),
  };

  const res = writeCanonicalTextFile({
    context,
    roots,
    target,
    selectedRole: "workspace",
    content: "Must not be written",
    nativeCalls: mockCalls,
  });

  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.reason, "path_changed");
  }
  assertEquals(ftruncateCalled, false);
});

Deno.test("Mock native boundary: exclusive create fails on EEXIST race without overwrite downgrade", () => {
  const { context, roots } = createBaseFixture();
  const prospectiveTarget: CanonicalTarget = {
    acpSessionId: "sess-1",
    sessionContextGeneration: "gen-1",
    roles: ["workspace"],
    rootIdentities: [roots.roots[0]],
    normalizedInput: "newfile.txt",
    canonicalTarget: "/workspace/newfile.txt",
    rootRelativePath: "newfile.txt",
    targetType: "prospective",
    prospectiveMissingSuffix: ["newfile.txt"],
    observedSymlinks: [],
  };

  const mockCalls: LinuxNativeCalls = {
    getArchitectureConstants: () => X86_64_CONSTANTS,
    open: () => ({ fd: 10, errno: 0 }),
    openat2: (_dirfd, pathname, _flags) => {
      if (pathname === "workspace") return { fd: 11, errno: 0 };
      // Exclusive creation returns EEXIST
      return { fd: -1, errno: ERRNO.EEXIST };
    },
    statx: () => ({
      statx: {
        mask: 0x07ff,
        mode: 0o040755,
        ino: 100n,
        devMajor: 8n,
        devMinor: 1n,
      },
      errno: 0,
    }),
    read: () => ({ bytesRead: 0, errno: 0 }),
    write: () => ({ bytesWritten: 0, errno: 0 }),
    ftruncate: () => ({ result: 0, errno: 0 }),
    close: () => ({ result: 0, errno: 0 }),
  };

  const res = writeCanonicalTextFile({
    context,
    roots,
    target: prospectiveTarget,
    selectedRole: "workspace",
    content: "New content",
    nativeCalls: mockCalls,
  });

  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.reason, "path_changed");
  }
});

Deno.test("Mock native boundary: cleanup failure returns io_failed", () => {
  const { context, roots, target } = createBaseFixture();

  const mockCalls: LinuxNativeCalls = {
    getArchitectureConstants: () => X86_64_CONSTANTS,
    open: () => ({ fd: 10, errno: 0 }),
    openat2: (_dirfd, pathname) => ({
      fd: pathname === "workspace" ? 11 : 12,
      errno: 0,
    }),
    statx: (fd) => {
      if (fd === 11) {
        return {
          statx: {
            mask: 0x07ff,
            mode: 0o040755,
            ino: 100n,
            devMajor: 8n,
            devMinor: 1n,
          },
          errno: 0,
        };
      }
      return {
        statx: {
          mask: 0x07ff,
          mode: 0o100644,
          ino: 200n,
          devMajor: 8n,
          devMinor: 1n,
        },
        errno: 0,
      };
    },
    read: () => ({ bytesRead: 0, errno: 0 }),
    write: () => ({ bytesWritten: 0, errno: 0 }),
    ftruncate: () => ({ result: 0, errno: 0 }),
    close: (fd) => {
      if (fd === 12) {
        return { result: -1, errno: ERRNO.EIO };
      }
      return { result: 0, errno: 0 };
    },
  };

  const res = readCanonicalTextFile({
    context,
    roots,
    target,
    selectedRole: "workspace",
    nativeCalls: mockCalls,
  });

  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.reason, "io_failed");
  }
});

Deno.test("Real native libc availability check / unsupported platform handling", () => {
  const real = getRealLinuxNativeCalls();
  // On this test machine, if Debian libc is absent at /lib/x86_64-linux-gnu/libc.so.6,
  // it must cleanly return secure_access_unavailable or unsupported_platform without crash or exception.
  if (real.error) {
    assertEquals(
      real.error.reason === "secure_access_unavailable" ||
        real.error.reason === "unsupported_platform",
      true,
    );
  } else {
    assertEquals(typeof real.calls?.open, "function");
  }
});
