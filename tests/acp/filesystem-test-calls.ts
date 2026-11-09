import { isAbsolute, join, relative } from "node:path";
import {
  decodeLinuxDev,
  ERRNO,
  type LinuxNativeCalls,
  X86_64_CONSTANTS,
} from "@acp/filesystem-access-linux.ts";
import fs from "node:fs";
import {
  isAlreadyExistsError,
  isNotFoundError,
  isPermissionDeniedError,
} from "../../src/utils/fs-compat.ts";

/** Offline native-call model with real file handles/content. Does not certify libc or openat2. */
export function createFilesystemTestCalls(beforeOpen?: (path: string) => void): LinuxNativeCalls {
  const handles = new Map<number, { path: string; fd: number }>();
  let nextFd = 10;
  const errno = (error: unknown): number => {
    if (isNotFoundError(error)) return ERRNO.ENOENT;
    if (isAlreadyExistsError(error)) return ERRNO.EEXIST;
    if (isPermissionDeniedError(error)) return ERRNO.EACCES;
    return ERRNO.EIO;
  };
  const open = (path: string, flags: number) => {
    beforeOpen?.(path);
    try {
      const info = (() => {
        try {
          return fs.lstatSync(path);
        } catch (error) {
          if (isNotFoundError(error)) return undefined;
          throw error;
        }
      })();
      if (info?.isSymbolicLink()) return { fd: -1, errno: ERRNO.ELOOP };
      if ((flags & X86_64_CONSTANTS.O_DIRECTORY) && !info?.isDirectory()) {
        return { fd: -1, errno: ERRNO.ENOTDIR };
      }
      // Node passes numeric flags straight to `open(2)`; the Linux `O_*` values
      // in `X86_64_CONSTANTS` are the same bits, so create/exclusive/truncate
      // semantics stay exactly those the production call requested.
      const fd = fs.openSync(path, flags, 0o666);
      const handle = nextFd++;
      handles.set(handle, { path, fd });
      return { fd: handle, errno: 0 };
    } catch (error) {
      return { fd: -1, errno: errno(error) };
    }
  };
  return {
    getArchitectureConstants: () => X86_64_CONSTANTS,
    open: (path, flags) => open(path, flags),
    openat2: (dirfd, path, flags) => {
      const parent = handles.get(dirfd)!;
      const target = join(parent.path, path);
      const rel = relative(parent.path, target);
      if (isAbsolute(path) || rel === ".." || rel.startsWith("../")) {
        return { fd: -1, errno: ERRNO.EXDEV };
      }
      // Model NO_SYMLINKS on every relative component, not just the final file.
      let component = parent.path;
      for (const part of rel.split("/")) {
        component = join(component, part);
        try {
          if (fs.lstatSync(component).isSymbolicLink()) return { fd: -1, errno: ERRNO.ELOOP };
        } catch (error) {
          if (!(isNotFoundError(error))) return { fd: -1, errno: errno(error) };
        }
      }
      return open(target, Number(flags));
    },
    statx: (fd) => {
      try {
        const info = fs.fstatSync(handles.get(fd)!.fd);
        const dev = decodeLinuxDev(info.dev!);
        return {
          statx: {
            mask: 0x07ff,
            mode: info.isDirectory() ? 0o040755 : 0o100644,
            ino: BigInt(info.ino!),
            devMajor: dev.major,
            devMinor: dev.minor,
          },
          errno: 0,
        };
      } catch (error) {
        return { errno: errno(error) };
      }
    },
    read: (fd, buffer) => {
      try {
        const handle = handles.get(fd)!.fd;
        return { bytesRead: fs.readSync(handle, buffer, 0, buffer.length, null), errno: 0 };
      } catch (error) {
        return { bytesRead: -1, errno: errno(error) };
      }
    },
    write: (fd, buffer) => {
      try {
        const handle = handles.get(fd)!.fd;
        return { bytesWritten: fs.writeSync(handle, buffer, 0, buffer.length, null), errno: 0 };
      } catch (error) {
        return { bytesWritten: -1, errno: errno(error) };
      }
    },
    ftruncate: (fd, length) => {
      try {
        fs.ftruncateSync(handles.get(fd)!.fd, Number(length));
        return { result: 0, errno: 0 };
      } catch (error) {
        return { result: -1, errno: errno(error) };
      }
    },
    close: (fd) => {
      fs.closeSync(handles.get(fd)!.fd);
      handles.delete(fd);
      return { result: 0, errno: 0 };
    },
  };
}
