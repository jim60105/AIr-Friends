/**
 * `bun:ffi` implementation of the production `LinuxNativeCalls` interface.
 *
 * Mirrors `getRealLinuxNativeCalls()` in `src/acp/filesystem-access-linux.ts`
 * step for step, keeping its failure messages, but resolves symbols through
 * `bun:ffi` instead of `Deno.dlopen`. Nothing is cached at module scope, so
 * tests can build independent backends.
 */
import { type DynamicLibrary, dlopen, ptr, read } from "bun:ffi";
import { realpathSync } from "node:fs";
import {
  AARCH64_CONSTANTS,
  encodeOpenHow,
  type LinuxArchitectureConstants,
  type LinuxNativeCalls,
  OWNED_DEBIAN_LIBC_PATHS,
  parseStatxBuffer,
  X86_64_CONSTANTS,
} from "../../../../src/acp/filesystem-access-linux.ts";

export interface BunNativeInit {
  libcPath?: string;
}

export interface BunNativeResult {
  calls?: LinuxNativeCalls;
  error?: { reason: "unsupported_platform" | "secure_access_unavailable"; message: string };
}

const SYMBOLS = {
  syscall: { args: ["i64", "i64", "ptr", "ptr", "u64"], returns: "i64" },
  open: { args: ["ptr", "i32", "u32"], returns: "i32" },
  statx: { args: ["i32", "ptr", "i32", "u32", "ptr"], returns: "i32" },
  read: { args: ["i32", "ptr", "u64"], returns: "i64" },
  write: { args: ["i32", "ptr", "u64"], returns: "i64" },
  ftruncate: { args: ["i32", "i64"], returns: "i32" },
  close: { args: ["i32"], returns: "i32" },
  __errno_location: { args: [], returns: "ptr" },
} as const;

/** NUL-terminated UTF-8 bytes; production keeps its own copy private. */
function encodeCString(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  const cstr = new Uint8Array(bytes.length + 1);
  cstr.set(bytes);
  cstr[bytes.length] = 0;
  return cstr;
}

export function createBunLinuxNativeCalls(init?: BunNativeInit): BunNativeResult {
  if (process.platform !== "linux") {
    return {
      error: {
        reason: "unsupported_platform",
        message:
          `Operating system '${process.platform}' is not supported. Supported platform is Linux x86_64 or aarch64.`,
      },
    };
  }

  const platformArch = process.arch;
  let architecture: string;
  let constants: LinuxArchitectureConstants;
  if (platformArch === "x64") {
    architecture = "x86_64";
    constants = X86_64_CONSTANTS;
  } else if (platformArch === "arm64") {
    architecture = "aarch64";
    constants = AARCH64_CONSTANTS;
  } else {
    return {
      error: {
        reason: "unsupported_platform",
        message:
          `Architecture '${platformArch}' is not supported. Supported architectures are x86_64 and aarch64.`,
      },
    };
  }

  const libcPath = init?.libcPath ?? OWNED_DEBIAN_LIBC_PATHS[architecture];
  if (!libcPath) {
    return {
      error: {
        reason: "unsupported_platform",
        message: `No owned libc path defined for architecture '${architecture}'.`,
      },
    };
  }

  let realLibcPath: string;
  try {
    realLibcPath = realpathSync(libcPath);
  } catch {
    return {
      error: {
        reason: "secure_access_unavailable",
        message: `Owned system libc at '${libcPath}' cannot be resolved.`,
      },
    };
  }

  let dylib: DynamicLibrary<typeof SYMBOLS>;
  try {
    dylib = dlopen(realLibcPath, SYMBOLS);
  } catch {
    return {
      error: {
        reason: "secure_access_unavailable",
        message: "Failed to dlopen system libc.",
      },
    };
  }

  const symbols = dylib.symbols;
  // Resolve per failure so a cached thread-local address is never assumed valid.
  // A null location at init fails closed, as production does.
  if (symbols.__errno_location() === null) {
    return {
      error: {
        reason: "secure_access_unavailable",
        message: "__errno_location returned null pointer.",
      },
    };
  }
  const getImmediateErrno = (): number => read.i32(symbols.__errno_location()!);

  const emptyCString = new Uint8Array([0]);

  return {
    calls: {
      getArchitectureConstants: () => constants,
      open: (path: string, flags: number, mode: number) => {
        const cPath = encodeCString(path);
        const fd = symbols.open(ptr(cPath), flags, mode);
        const errno = fd < 0 ? getImmediateErrno() : 0;
        return { fd, errno };
      },
      openat2: (dirfd: number, pathname: string, flags: bigint, mode: bigint, resolve: bigint) => {
        const cPath = encodeCString(pathname);
        const how = encodeOpenHow(flags, mode, resolve);
        const fd = Number(
          symbols.syscall(constants.SYS_openat2, BigInt(dirfd), ptr(cPath), ptr(how), 24n),
        );
        const errno = fd < 0 ? getImmediateErrno() : 0;
        return { fd, errno };
      },
      statx: (fd: number) => {
        const buf = new Uint8Array(256);
        const res = symbols.statx(
          fd,
          ptr(emptyCString),
          constants.AT_EMPTY_PATH,
          constants.STATX_BASIC_STATS,
          ptr(buf),
        );
        if (res < 0) {
          const errno = getImmediateErrno();
          return { errno };
        }
        return { statx: parseStatxBuffer(buf), errno: 0 };
      },
      read: (fd: number, buffer: Uint8Array) => {
        const res = Number(symbols.read(fd, ptr(buffer), BigInt(buffer.byteLength)));
        const errno = res < 0 ? getImmediateErrno() : 0;
        return { bytesRead: res, errno };
      },
      write: (fd: number, buffer: Uint8Array) => {
        const res = Number(symbols.write(fd, ptr(buffer), BigInt(buffer.byteLength)));
        const errno = res < 0 ? getImmediateErrno() : 0;
        return { bytesWritten: res, errno };
      },
      ftruncate: (fd: number, length: bigint) => {
        const res = symbols.ftruncate(fd, length);
        const errno = res < 0 ? getImmediateErrno() : 0;
        return { result: res, errno };
      },
      close: (fd: number) => {
        const res = symbols.close(fd);
        const errno = res < 0 ? getImmediateErrno() : 0;
        return { result: res, errno };
      },
    },
  };
}
