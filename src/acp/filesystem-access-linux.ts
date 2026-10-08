/**
 * Linux FFI backend implementing secure descriptor-only openat2/statx operations.
 *
 * Implements OpenSpec change `secure-acp-filesystem-access`.
 */

import type { CanonicalRootInfo, CanonicalTarget } from "./filesystem-roots.ts";
import type {
  FilesystemAccessFailure,
  FilesystemAccessFailureReason,
  FilesystemAccessResult,
} from "./filesystem-access.ts";

export interface LinuxArchitectureConstants {
  readonly SYS_openat2: bigint;
  readonly O_RDONLY: number;
  readonly O_WRONLY: number;
  readonly O_CREAT: number;
  readonly O_EXCL: number;
  readonly O_NONBLOCK: number;
  readonly O_DIRECTORY: number;
  readonly O_NOFOLLOW: number;
  readonly O_CLOEXEC: number;
  readonly O_PATH: number;
  readonly RESOLVE_BENEATH: bigint;
  readonly RESOLVE_NO_SYMLINKS: bigint;
  readonly RESOLVE_NO_MAGICLINKS: bigint;
  readonly AT_EMPTY_PATH: number;
  readonly STATX_TYPE: number;
  readonly STATX_MODE: number;
  readonly STATX_INO: number;
  readonly STATX_BASIC_STATS: number;
  readonly S_IFMT: number;
  readonly S_IFREG: number;
  readonly S_IFDIR: number;
}

export const X86_64_CONSTANTS: LinuxArchitectureConstants = {
  SYS_openat2: 437n,
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_CREAT: 0o100,
  O_EXCL: 0o200,
  O_NONBLOCK: 0o4000,
  O_DIRECTORY: 0o200000,
  O_NOFOLLOW: 0o400000,
  O_CLOEXEC: 0o2000000,
  O_PATH: 0o10000000,
  RESOLVE_BENEATH: 0x08n,
  RESOLVE_NO_SYMLINKS: 0x04n,
  RESOLVE_NO_MAGICLINKS: 0x02n,
  AT_EMPTY_PATH: 0x1000,
  STATX_TYPE: 0x0001,
  STATX_MODE: 0x0002,
  STATX_INO: 0x0100,
  STATX_BASIC_STATS: 0x07ff,
  S_IFMT: 0o170000,
  S_IFREG: 0o100000,
  S_IFDIR: 0o040000,
};

export const AARCH64_CONSTANTS: LinuxArchitectureConstants = {
  SYS_openat2: 437n,
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_CREAT: 0o100,
  O_EXCL: 0o200,
  O_NONBLOCK: 0o4000,
  O_DIRECTORY: 0o40000, // Differs from x86_64 (0o200000 is O_DIRECT on arm64)
  O_NOFOLLOW: 0o100000, // Differs from x86_64 (0o400000 is O_LARGEFILE on arm64)
  O_CLOEXEC: 0o2000000,
  O_PATH: 0o10000000,
  RESOLVE_BENEATH: 0x08n,
  RESOLVE_NO_SYMLINKS: 0x04n,
  RESOLVE_NO_MAGICLINKS: 0x02n,
  AT_EMPTY_PATH: 0x1000,
  STATX_TYPE: 0x0001,
  STATX_MODE: 0x0002,
  STATX_INO: 0x0100,
  STATX_BASIC_STATS: 0x07ff,
  S_IFMT: 0o170000,
  S_IFREG: 0o100000,
  S_IFDIR: 0o040000,
};

export const OWNED_DEBIAN_LIBC_PATHS: Record<string, string> = {
  x86_64: "/lib/x86_64-linux-gnu/libc.so.6",
  aarch64: "/lib/aarch64-linux-gnu/libc.so.6",
};

// Linux errno definitions
export const ERRNO = {
  EPERM: 1,
  ENOENT: 2,
  EIO: 5,
  ENXIO: 6,
  E2BIG: 7,
  EACCES: 13,
  EEXIST: 17,
  EXDEV: 18,
  ENOTDIR: 20,
  EISDIR: 21,
  EINVAL: 22,
  ENFILE: 23,
  EMFILE: 24,
  EFBIG: 27,
  ENOSPC: 28,
  EROFS: 30,
  ELOOP: 40,
  EAGAIN: 11,
  ENOSYS: 38,
} as const;

export interface StatxResult {
  readonly mask: number;
  readonly mode: number;
  readonly ino: bigint;
  readonly devMajor: bigint;
  readonly devMinor: bigint;
}

/**
 * Native call abstraction for testability and mock injection.
 */
export interface LinuxNativeCalls {
  getArchitectureConstants(): LinuxArchitectureConstants;
  open(path: string, flags: number, mode: number): { fd: number; errno: number };
  openat2(
    dirfd: number,
    pathname: string,
    flags: bigint,
    mode: bigint,
    resolve: bigint,
  ): { fd: number; errno: number };
  statx(fd: number): { statx?: StatxResult; errno: number };
  read(fd: number, buffer: Uint8Array): { bytesRead: number; errno: number };
  write(fd: number, buffer: Uint8Array): { bytesWritten: number; errno: number };
  ftruncate(fd: number, length: bigint): { result: number; errno: number };
  close(fd: number): { result: number; errno: number };
}

/**
 * Calculates Linux device major and minor from a numeric 64-bit device ID.
 * Follows Linux sysmacros.h encoding:
 * major: ((dev >> 8) & 0xfff) | ((dev >> 32) & 0xfffff000)
 * minor: (dev & 0xff) | ((dev >> 12) & 0xffffff00)
 */
export function decodeLinuxDev(devNum: number): { major: bigint; minor: bigint } {
  const d = BigInt(devNum);
  const major = ((d >> 8n) & 0xfffn) | ((d >> 32n) & 0xfffff000n);
  const minor = (d & 0xffn) | ((d >> 12n) & 0xffffff00n);
  return { major, minor };
}

/**
 * Encodes an open_how 24-byte struct in little-endian.
 * Offset 0: flags uint64
 * Offset 8: mode uint64
 * Offset 16: resolve uint64
 */
export function encodeOpenHow(flags: bigint, mode: bigint, resolve: bigint): Uint8Array {
  const buf = new Uint8Array(24);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, flags, true);
  view.setBigUint64(8, mode, true);
  view.setBigUint64(16, resolve, true);
  return buf;
}

/**
 * Decodes statx buffer (256 bytes) in little-endian.
 * Offsets per Linux UAPI stat.h:
 * 0: stx_mask uint32
 * 28: stx_mode uint16
 * 32: stx_ino uint64
 * 136: stx_dev_major uint32
 * 140: stx_dev_minor uint32
 */
export function parseStatxBuffer(buf: Uint8Array): StatxResult {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    mask: view.getUint32(0, true),
    mode: view.getUint16(28, true),
    ino: view.getBigUint64(32, true),
    devMajor: BigInt(view.getUint32(136, true)),
    devMinor: BigInt(view.getUint32(140, true)),
  };
}

// Cached real libc FFI dynamic library instance
let cachedRealNativeCalls: LinuxNativeCalls | null = null;
let cachedRealInitError: { reason: FilesystemAccessFailureReason; message: string } | null = null;

function encodeCString(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  const cstr = new Uint8Array(bytes.length + 1);
  cstr.set(bytes);
  cstr[bytes.length] = 0;
  return cstr;
}

export function getRealLinuxNativeCalls(): {
  calls?: LinuxNativeCalls;
  error?: { reason: FilesystemAccessFailureReason; message: string };
} {
  if (cachedRealNativeCalls) return { calls: cachedRealNativeCalls };
  if (cachedRealInitError) return { error: cachedRealInitError };

  if (Deno.build.os !== "linux") {
    cachedRealInitError = {
      reason: "unsupported_platform",
      message:
        `Operating system '${Deno.build.os}' is not supported. Supported platform is Linux x86_64 or aarch64.`,
    };
    return { error: cachedRealInitError };
  }

  const arch = Deno.build.arch;
  let constants: LinuxArchitectureConstants;
  if (arch === "x86_64") {
    constants = X86_64_CONSTANTS;
  } else if (arch === "aarch64") {
    constants = AARCH64_CONSTANTS;
  } else {
    cachedRealInitError = {
      reason: "unsupported_platform",
      message:
        `Architecture '${arch}' is not supported. Supported architectures are x86_64 and aarch64.`,
    };
    return { error: cachedRealInitError };
  }

  const libcPath = OWNED_DEBIAN_LIBC_PATHS[arch];
  if (!libcPath) {
    cachedRealInitError = {
      reason: "unsupported_platform",
      message: `No owned libc path defined for architecture '${arch}'.`,
    };
    return { error: cachedRealInitError };
  }

  let realLibcPath: string;
  try {
    realLibcPath = Deno.realPathSync(libcPath);
  } catch {
    cachedRealInitError = {
      reason: "secure_access_unavailable",
      message: `Owned system libc at '${libcPath}' cannot be resolved.`,
    };
    return { error: cachedRealInitError };
  }

  let dylib: Deno.DynamicLibrary<{
    syscall: { parameters: ["i64", "i64", "buffer", "buffer", "u64"]; result: "i64" };
    open: { parameters: ["buffer", "i32", "u32"]; result: "i32" };
    statx: { parameters: ["i32", "buffer", "i32", "u32", "buffer"]; result: "i32" };
    read: { parameters: ["i32", "buffer", "usize"]; result: "isize" };
    write: { parameters: ["i32", "buffer", "usize"]; result: "isize" };
    ftruncate: { parameters: ["i32", "i64"]; result: "i32" };
    close: { parameters: ["i32"]; result: "i32" };
    __errno_location: { parameters: []; result: "pointer" };
  }>;

  try {
    dylib = Deno.dlopen(realLibcPath, {
      syscall: { parameters: ["i64", "i64", "buffer", "buffer", "u64"], result: "i64" },
      open: { parameters: ["buffer", "i32", "u32"], result: "i32" },
      statx: { parameters: ["i32", "buffer", "i32", "u32", "buffer"], result: "i32" },
      read: { parameters: ["i32", "buffer", "usize"], result: "isize" },
      write: { parameters: ["i32", "buffer", "usize"], result: "isize" },
      ftruncate: { parameters: ["i32", "i64"], result: "i32" },
      close: { parameters: ["i32"], result: "i32" },
      __errno_location: { parameters: [], result: "pointer" },
    });
  } catch {
    cachedRealInitError = {
      reason: "secure_access_unavailable",
      message: "Failed to dlopen system libc.",
    };
    return { error: cachedRealInitError };
  }

  const errnoPtr = dylib.symbols.__errno_location();
  if (errnoPtr === null) {
    cachedRealInitError = {
      reason: "secure_access_unavailable",
      message: "__errno_location returned null pointer.",
    };
    return { error: cachedRealInitError };
  }
  const errnoView = new Deno.UnsafePointerView(errnoPtr);

  const getImmediateErrno = (): number => errnoView.getInt32();
  const emptyCString = new Uint8Array([0]);

  cachedRealNativeCalls = {
    getArchitectureConstants: () => constants,
    open: (path: string, flags: number, mode: number) => {
      const cPath = encodeCString(path);
      const fd = dylib.symbols.open(cPath, flags, mode);
      const err = fd < 0 ? getImmediateErrno() : 0;
      return { fd, errno: err };
    },
    openat2: (dirfd: number, pathname: string, flags: bigint, mode: bigint, resolve: bigint) => {
      const cPath = encodeCString(pathname);
      const how = encodeOpenHow(flags, mode, resolve);
      const res = dylib.symbols.syscall(
        constants.SYS_openat2,
        BigInt(dirfd),
        cPath,
        how,
        24n,
      );
      const fd = Number(res);
      const err = fd < 0 ? getImmediateErrno() : 0;
      return { fd, errno: err };
    },
    statx: (fd: number) => {
      const buf = new Uint8Array(256);
      const res = dylib.symbols.statx(
        fd,
        emptyCString,
        constants.AT_EMPTY_PATH,
        constants.STATX_BASIC_STATS,
        buf,
      );
      if (res < 0) {
        return { errno: getImmediateErrno() };
      }
      return { statx: parseStatxBuffer(buf), errno: 0 };
    },
    read: (fd: number, buffer: Uint8Array) => {
      const res = dylib.symbols.read(fd, buffer, BigInt(buffer.byteLength));
      const bytesRead = Number(res);
      const err = bytesRead < 0 ? getImmediateErrno() : 0;
      return { bytesRead, errno: err };
    },
    write: (fd: number, buffer: Uint8Array) => {
      const res = dylib.symbols.write(fd, buffer, BigInt(buffer.byteLength));
      const bytesWritten = Number(res);
      const err = bytesWritten < 0 ? getImmediateErrno() : 0;
      return { bytesWritten, errno: err };
    },
    ftruncate: (fd: number, length: bigint) => {
      const res = dylib.symbols.ftruncate(fd, length);
      const err = res < 0 ? getImmediateErrno() : 0;
      return { result: res, errno: err };
    },
    close: (fd: number) => {
      const res = dylib.symbols.close(fd);
      const err = res < 0 ? getImmediateErrno() : 0;
      return { result: res, errno: err };
    },
  };

  return { calls: cachedRealNativeCalls };
}

export interface PerformLinuxAccessOptions {
  readonly operation: "read" | "write";
  readonly selectedRoot: CanonicalRootInfo;
  readonly target: CanonicalTarget;
  readonly relativePath: string;
  readonly isNewFile: boolean;
  readonly content: string;
  readonly nativeCalls?: LinuxNativeCalls;
}

export function performLinuxSecureAccess<T = unknown>(
  options: PerformLinuxAccessOptions,
): FilesystemAccessResult<T> {
  let native: LinuxNativeCalls;
  if (options.nativeCalls) {
    native = options.nativeCalls;
  } else {
    const real = getRealLinuxNativeCalls();
    if (!real.calls) {
      return {
        ok: false,
        reason: real.error?.reason ?? "unsupported_platform",
        message: real.error?.message ?? "Native backend unavailable.",
      };
    }
    native = real.calls;
  }

  const c = native.getArchitectureConstants();
  const acquiredFds: number[] = [];

  const cleanupFds = (): { cleanupFailed: boolean; cleanupErrno: number } => {
    let cleanupFailed = false;
    let cleanupErrno = 0;
    while (acquiredFds.length > 0) {
      const fd = acquiredFds.pop()!;
      const res = native.close(fd);
      if (res.result < 0 && !cleanupFailed) {
        cleanupFailed = true;
        cleanupErrno = res.errno;
      }
    }
    return { cleanupFailed, cleanupErrno };
  };

  try {
    // 1. Open root capability `/`
    const rootCap = native.open(
      "/",
      c.O_PATH | c.O_DIRECTORY | c.O_CLOEXEC,
      0,
    );
    if (rootCap.fd < 0) {
      return mapLinuxErrnoToFailure(
        rootCap.errno,
        "root_cap_open",
        "Failed to open '/' root capability",
      );
    }
    acquiredFds.push(rootCap.fd);

    // 2. Open selected canonical root beneath `/` using openat2
    const canonicalRootPath = options.selectedRoot.canonicalPath;
    let rootPathRelativeSlash = canonicalRootPath.startsWith("/")
      ? canonicalRootPath.slice(1)
      : canonicalRootPath;
    if (rootPathRelativeSlash === "") {
      rootPathRelativeSlash = ".";
    }

    const rootOpen = native.openat2(
      rootCap.fd,
      rootPathRelativeSlash,
      BigInt(c.O_PATH | c.O_DIRECTORY | c.O_CLOEXEC),
      0n,
      c.RESOLVE_BENEATH | c.RESOLVE_NO_SYMLINKS | c.RESOLVE_NO_MAGICLINKS,
    );
    if (rootOpen.fd < 0) {
      return mapLinuxErrnoToFailure(
        rootOpen.errno,
        "root_open",
        `Failed to open canonical root '${canonicalRootPath}'`,
      );
    }
    acquiredFds.push(rootOpen.fd);
    const rootFd = rootOpen.fd;

    // 3. Statx the root fd and verify exact dev and ino
    const rootStat = native.statx(rootFd);
    if (!rootStat.statx) {
      return mapLinuxErrnoToFailure(
        rootStat.errno,
        "root_statx",
        "Failed to statx canonical root descriptor",
      );
    }
    const stxRoot = rootStat.statx;
    if ((stxRoot.mask & (c.STATX_TYPE | c.STATX_INO)) !== (c.STATX_TYPE | c.STATX_INO)) {
      return {
        ok: false,
        reason: "identity_unavailable",
        message: "statx did not return required TYPE and INO masks for root descriptor.",
      };
    }
    if ((stxRoot.mode & c.S_IFMT) !== c.S_IFDIR) {
      return {
        ok: false,
        reason: "wrong_target_type",
        message: "Canonical root descriptor is not a directory.",
      };
    }

    const expectedRootIdentity = options.selectedRoot.identity!;
    const expectedRootDev = decodeLinuxDev(expectedRootIdentity.dev!);
    if (
      stxRoot.ino !== BigInt(expectedRootIdentity.ino!) ||
      stxRoot.devMajor !== expectedRootDev.major ||
      stxRoot.devMinor !== expectedRootDev.minor
    ) {
      return {
        ok: false,
        reason: "path_changed",
        message:
          "Canonical root descriptor identity does not match observed canonical root identity.",
      };
    }

    // 4. Perform content access
    if (options.operation === "read") {
      // READ: open destination relative to rootFd without creation or truncation
      const fileOpen = native.openat2(
        rootFd,
        options.relativePath,
        BigInt(c.O_RDONLY | c.O_CLOEXEC | c.O_NONBLOCK | c.O_NOFOLLOW),
        0n,
        c.RESOLVE_BENEATH | c.RESOLVE_NO_SYMLINKS | c.RESOLVE_NO_MAGICLINKS,
      );
      if (fileOpen.fd < 0) {
        return mapLinuxErrnoToFailure(
          fileOpen.errno,
          "file_open_existing",
          `Failed to open file '${options.relativePath}' for read`,
        );
      }
      acquiredFds.push(fileOpen.fd);
      const fileFd = fileOpen.fd;

      // Check statx identity & regular file
      const fileStat = native.statx(fileFd);
      if (!fileStat.statx) {
        return mapLinuxErrnoToFailure(
          fileStat.errno,
          "file_statx",
          "Failed to statx target file descriptor",
        );
      }
      const stxFile = fileStat.statx;
      if ((stxFile.mask & (c.STATX_TYPE | c.STATX_INO)) !== (c.STATX_TYPE | c.STATX_INO)) {
        return {
          ok: false,
          reason: "identity_unavailable",
          message: "statx did not return required TYPE and INO masks for target file descriptor.",
        };
      }
      if ((stxFile.mode & c.S_IFMT) !== c.S_IFREG) {
        return {
          ok: false,
          reason: "wrong_target_type",
          message: "Target is not a regular file.",
        };
      }

      const expectedTargetIdentity = options.target.targetIdentity!;
      const expectedTargetDev = decodeLinuxDev(expectedTargetIdentity.dev!);
      if (
        stxFile.ino !== BigInt(expectedTargetIdentity.ino!) ||
        stxFile.devMajor !== expectedTargetDev.major ||
        stxFile.devMinor !== expectedTargetDev.minor
      ) {
        return {
          ok: false,
          reason: "path_changed",
          message: "Target file descriptor identity does not match observed target identity.",
        };
      }

      // Stream read in chunks using a single TextDecoder instance
      const decoder = new TextDecoder("utf-8", { fatal: false });
      let resultText = "";
      const readChunkBuf = new Uint8Array(64 * 1024);

      while (true) {
        const r = native.read(fileFd, readChunkBuf);
        if (r.bytesRead < 0) {
          return mapLinuxErrnoToFailure(r.errno, "read_io", "Error reading target file descriptor");
        }
        if (r.bytesRead === 0) {
          // EOF
          break;
        }
        resultText += decoder.decode(readChunkBuf.subarray(0, r.bytesRead), { stream: true });
      }
      resultText += decoder.decode();

      const cleanup = cleanupFds();
      if (cleanup.cleanupFailed) {
        return {
          ok: false,
          reason: "io_failed",
          message: `Cleanup error closing descriptor (errno ${cleanup.cleanupErrno})`,
        };
      }

      return {
        ok: true,
        value: resultText as unknown as T,
      };
    } else {
      // WRITE
      if (options.isNewFile) {
        // Exclusive creation:
        // First verify parent directory path exists under root
        const lastSlash = options.relativePath.lastIndexOf("/");
        const parentRelPath = lastSlash >= 0 ? options.relativePath.slice(0, lastSlash) : "";

        if (parentRelPath !== "") {
          const parentOpen = native.openat2(
            rootFd,
            parentRelPath,
            BigInt(c.O_PATH | c.O_DIRECTORY | c.O_CLOEXEC),
            0n,
            c.RESOLVE_BENEATH | c.RESOLVE_NO_SYMLINKS | c.RESOLVE_NO_MAGICLINKS,
          );
          if (parentOpen.fd < 0) {
            return mapLinuxErrnoToFailure(
              parentOpen.errno,
              "parent_open",
              `Parent directory '${parentRelPath}' unavailable`,
            );
          }
          acquiredFds.push(parentOpen.fd);
          const pStat = native.statx(parentOpen.fd);
          if (!pStat.statx) {
            return mapLinuxErrnoToFailure(
              pStat.errno,
              "parent_statx",
              "Failed to statx parent directory",
            );
          }
          if (
            (pStat.statx.mask & (c.STATX_TYPE | c.STATX_INO)) !== (c.STATX_TYPE | c.STATX_INO)
          ) {
            return {
              ok: false,
              reason: "identity_unavailable",
              message: "statx did not return required TYPE and INO masks for parent directory.",
            };
          }
          if ((pStat.statx.mode & c.S_IFMT) !== c.S_IFDIR) {
            return {
              ok: false,
              reason: "parent_missing",
              message: "Parent path component is not a directory.",
            };
          }
        }

        // Exclusive create full destination relative to rootFd
        const newFileOpen = native.openat2(
          rootFd,
          options.relativePath,
          BigInt(c.O_WRONLY | c.O_CREAT | c.O_EXCL | c.O_CLOEXEC | c.O_NONBLOCK | c.O_NOFOLLOW),
          0o600n,
          c.RESOLVE_BENEATH | c.RESOLVE_NO_SYMLINKS | c.RESOLVE_NO_MAGICLINKS,
        );
        if (newFileOpen.fd < 0) {
          return mapLinuxErrnoToFailure(
            newFileOpen.errno,
            "file_create_exclusive",
            `Exclusive creation failed for '${options.relativePath}'`,
          );
        }
        acquiredFds.push(newFileOpen.fd);
        const fileFd = newFileOpen.fd;

        // Statx descriptor: verify regular file
        const fileStat = native.statx(fileFd);
        if (!fileStat.statx) {
          return mapLinuxErrnoToFailure(
            fileStat.errno,
            "file_statx",
            "Failed to statx newly created file descriptor",
          );
        }
        if (
          (fileStat.statx.mask & (c.STATX_TYPE | c.STATX_INO)) !== (c.STATX_TYPE | c.STATX_INO)
        ) {
          return {
            ok: false,
            reason: "identity_unavailable",
            message: "statx did not return required TYPE and INO masks for newly created file.",
          };
        }
        if ((fileStat.statx.mode & c.S_IFMT) !== c.S_IFREG) {
          return {
            ok: false,
            reason: "wrong_target_type",
            message: "Newly created target is not a regular file.",
          };
        }

        // Write encoded UTF-8 bytes in full
        const writeRes = writeAllBytes(native, fileFd, options.content);
        if (!writeRes.ok) {
          return writeRes;
        }

        const cleanup = cleanupFds();
        if (cleanup.cleanupFailed) {
          return {
            ok: false,
            reason: "io_failed",
            message: `Cleanup error closing descriptor (errno ${cleanup.cleanupErrno})`,
          };
        }

        return { ok: true, value: undefined as unknown as T };
      } else {
        // Existing overwrite: open write-only WITHOUT O_TRUNC or O_CREAT
        const fileOpen = native.openat2(
          rootFd,
          options.relativePath,
          BigInt(c.O_WRONLY | c.O_CLOEXEC | c.O_NONBLOCK | c.O_NOFOLLOW),
          0n,
          c.RESOLVE_BENEATH | c.RESOLVE_NO_SYMLINKS | c.RESOLVE_NO_MAGICLINKS,
        );
        if (fileOpen.fd < 0) {
          return mapLinuxErrnoToFailure(
            fileOpen.errno,
            "file_open_existing",
            `Failed to open file '${options.relativePath}' for overwrite`,
          );
        }
        acquiredFds.push(fileOpen.fd);
        const fileFd = fileOpen.fd;

        // Statx identity check BEFORE truncation
        const fileStat = native.statx(fileFd);
        if (!fileStat.statx) {
          return mapLinuxErrnoToFailure(
            fileStat.errno,
            "file_statx",
            "Failed to statx target file descriptor",
          );
        }
        const stxFile = fileStat.statx;
        if ((stxFile.mask & (c.STATX_TYPE | c.STATX_INO)) !== (c.STATX_TYPE | c.STATX_INO)) {
          return {
            ok: false,
            reason: "identity_unavailable",
            message: "statx did not return required TYPE and INO masks for target file descriptor.",
          };
        }
        if ((stxFile.mode & c.S_IFMT) !== c.S_IFREG) {
          return {
            ok: false,
            reason: "wrong_target_type",
            message: "Target is not a regular file.",
          };
        }

        const expectedTargetIdentity = options.target.targetIdentity!;
        const expectedTargetDev = decodeLinuxDev(expectedTargetIdentity.dev!);
        if (
          stxFile.ino !== BigInt(expectedTargetIdentity.ino!) ||
          stxFile.devMajor !== expectedTargetDev.major ||
          stxFile.devMinor !== expectedTargetDev.minor
        ) {
          return {
            ok: false,
            reason: "path_changed",
            message:
              "Target file descriptor identity does not match observed target identity before truncate.",
          };
        }

        // Ftruncate to 0
        const truncRes = native.ftruncate(fileFd, 0n);
        if (truncRes.result < 0) {
          return mapLinuxErrnoToFailure(
            truncRes.errno,
            "write_io",
            "Failed to ftruncate target file descriptor",
          );
        }

        // Write encoded UTF-8 bytes in full
        const writeRes = writeAllBytes(native, fileFd, options.content);
        if (!writeRes.ok) {
          return writeRes;
        }

        const cleanup = cleanupFds();
        if (cleanup.cleanupFailed) {
          return {
            ok: false,
            reason: "io_failed",
            message: `Cleanup error closing descriptor (errno ${cleanup.cleanupErrno})`,
          };
        }

        return { ok: true, value: undefined as unknown as T };
      }
    }
  } finally {
    cleanupFds();
  }
}

function writeAllBytes(
  native: LinuxNativeCalls,
  fd: number,
  content: string,
): FilesystemAccessResult<void> {
  const bytes = new TextEncoder().encode(content);
  let offset = 0;

  while (offset < bytes.byteLength) {
    const chunk = bytes.subarray(offset);
    const w = native.write(fd, chunk);
    if (w.bytesWritten < 0) {
      return mapLinuxErrnoToFailure(w.errno, "write_io", "Error writing to target file descriptor");
    }
    if (w.bytesWritten === 0) {
      return {
        ok: false,
        reason: "io_failed",
        message: "Zero-progress write detected.",
      };
    }
    offset += w.bytesWritten;
  }

  return { ok: true, value: undefined };
}

export type OperationPhase =
  | "root_cap_open"
  | "root_open"
  | "root_statx"
  | "file_open_existing"
  | "parent_open"
  | "parent_statx"
  | "file_create_exclusive"
  | "file_statx"
  | "read_io"
  | "write_io";

export function mapLinuxErrnoToFailure(
  errno: number,
  phase: OperationPhase,
  detail: string,
): FilesystemAccessFailure {
  if (errno === ERRNO.ENOSYS) {
    return {
      ok: false,
      reason: "secure_access_unavailable",
      message: `System call not implemented (ENOSYS): ${detail}`,
    };
  }

  if (errno === ERRNO.ELOOP) {
    return {
      ok: false,
      reason: "unsafe_traversal",
      message: `Symlink traversal detected (ELOOP): ${detail}`,
    };
  }

  if (errno === ERRNO.EXDEV) {
    return {
      ok: false,
      reason: "outside_roots",
      message: `Path escapes constrained root boundary (EXDEV): ${detail}`,
    };
  }

  if (errno === ERRNO.EAGAIN) {
    if (phase === "read_io" || phase === "write_io") {
      return {
        ok: false,
        reason: "io_failed",
        message: `IO interrupted / would block (EAGAIN): ${detail}`,
      };
    }
    return {
      ok: false,
      reason: "path_changed",
      message: `Resolution race detected (EAGAIN): ${detail}`,
    };
  }

  if (errno === ERRNO.ENOENT) {
    if (phase === "root_cap_open" || phase === "root_open" || phase === "root_statx") {
      return {
        ok: false,
        reason: "root_unavailable",
        message: `Root directory does not exist (ENOENT): ${detail}`,
      };
    }
    if (phase === "parent_open" || phase === "parent_statx") {
      return {
        ok: false,
        reason: "parent_missing",
        message: `Parent directory path does not exist (ENOENT): ${detail}`,
      };
    }
    if (phase === "file_create_exclusive") {
      return {
        ok: false,
        reason: "parent_missing",
        message: `Parent directory does not exist for creation (ENOENT): ${detail}`,
      };
    }
    // file_open_existing or statx
    return {
      ok: false,
      reason: "path_changed",
      message: `Target file does not exist (ENOENT): ${detail}`,
    };
  }

  if (errno === ERRNO.EEXIST) {
    return {
      ok: false,
      reason: "path_changed",
      message: `File already exists for exclusive create (EEXIST): ${detail}`,
    };
  }

  if (errno === ERRNO.ENOTDIR || errno === ERRNO.EISDIR) {
    return {
      ok: false,
      reason: "wrong_target_type",
      message: `Incompatible target or component type (${
        errno === ERRNO.EISDIR ? "EISDIR" : "ENOTDIR"
      }): ${detail}`,
    };
  }

  if (errno === ERRNO.EACCES || errno === ERRNO.EPERM || errno === ERRNO.EROFS) {
    return {
      ok: false,
      reason: "access_denied",
      message: `Access denied (errno ${errno}): ${detail}`,
    };
  }

  if (errno === ERRNO.EINVAL || errno === ERRNO.E2BIG) {
    return {
      ok: false,
      reason: "secure_access_unavailable",
      message: `Kernel rejected arguments or structure size (errno ${errno}): ${detail}`,
    };
  }

  return {
    ok: false,
    reason: "io_failed",
    message: `Native operation error (errno ${errno}): ${detail}`,
  };
}
