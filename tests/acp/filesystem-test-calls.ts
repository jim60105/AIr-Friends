import { isAbsolute, join, relative } from "@std/path";
import {
  decodeLinuxDev,
  ERRNO,
  type LinuxNativeCalls,
  X86_64_CONSTANTS,
} from "@acp/filesystem-access-linux.ts";

/** Offline native-call model with real file handles/content. Does not certify libc or openat2. */
export function createFilesystemTestCalls(beforeOpen?: (path: string) => void): LinuxNativeCalls {
  const handles = new Map<number, { path: string; file: Deno.FsFile }>();
  let nextFd = 10;
  const errno = (error: unknown): number => {
    if (error instanceof Deno.errors.NotFound) return ERRNO.ENOENT;
    if (error instanceof Deno.errors.AlreadyExists) return ERRNO.EEXIST;
    if (error instanceof Deno.errors.PermissionDenied) return ERRNO.EACCES;
    return ERRNO.EIO;
  };
  const open = (path: string, flags: number) => {
    beforeOpen?.(path);
    try {
      const info = (() => {
        try {
          return Deno.lstatSync(path);
        } catch (error) {
          if (error instanceof Deno.errors.NotFound) return undefined;
          throw error;
        }
      })();
      if (info?.isSymlink) return { fd: -1, errno: ERRNO.ELOOP };
      if ((flags & X86_64_CONSTANTS.O_DIRECTORY) && !info?.isDirectory) {
        return { fd: -1, errno: ERRNO.ENOTDIR };
      }
      const write = !!(flags & X86_64_CONSTANTS.O_WRONLY);
      const file = Deno.openSync(path, {
        read: !write,
        write,
        createNew: !!(flags & X86_64_CONSTANTS.O_EXCL),
        create: !!(flags & X86_64_CONSTANTS.O_CREAT) && !(flags & X86_64_CONSTANTS.O_EXCL),
      });
      const fd = nextFd++;
      handles.set(fd, { path, file });
      return { fd, errno: 0 };
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
          if (Deno.lstatSync(component).isSymlink) return { fd: -1, errno: ERRNO.ELOOP };
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) return { fd: -1, errno: errno(error) };
        }
      }
      return open(target, Number(flags));
    },
    statx: (fd) => {
      try {
        const info = handles.get(fd)!.file.statSync();
        const dev = decodeLinuxDev(info.dev!);
        return {
          statx: {
            mask: 0x07ff,
            mode: info.isDirectory ? 0o040755 : 0o100644,
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
        return { bytesRead: handles.get(fd)!.file.readSync(buffer) ?? 0, errno: 0 };
      } catch (error) {
        return { bytesRead: -1, errno: errno(error) };
      }
    },
    write: (fd, buffer) => {
      try {
        return { bytesWritten: handles.get(fd)!.file.writeSync(buffer), errno: 0 };
      } catch (error) {
        return { bytesWritten: -1, errno: errno(error) };
      }
    },
    ftruncate: (fd, length) => {
      try {
        handles.get(fd)!.file.truncateSync(Number(length));
        return { result: 0, errno: 0 };
      } catch (error) {
        return { result: -1, errno: errno(error) };
      }
    },
    close: (fd) => {
      handles.get(fd)!.file.close();
      handles.delete(fd);
      return { result: 0, errno: 0 };
    },
  };
}
