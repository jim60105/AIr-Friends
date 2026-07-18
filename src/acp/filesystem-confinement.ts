// src/acp/filesystem-confinement.ts
//
// bubblewrap-based filesystem confinement of the agent subprocess (F12 D4).
//
// The container runs unprivileged under a single UID (OpenShift arbitrary-UID model), so
// switching the agent to a second UID is not available. Instead the agent is wrapped in a
// mount namespace (via `bwrap`) that:
//
//   - mounts a FRESH `/proc`, so the daemon's `/proc/1/environ` (which inherits the
//     daemon's DISCORD_TOKEN / OPENROUTER_API_KEY / dashboard passphrase) is NOT visible;
//   - binds ONLY this session's own workspace + TMPDIR (and, for self-research, the shared
//     agent workspace) read-write — sibling users' workspaces under `/app/data/workspaces`
//     are never bound, so they are absent from the mount namespace and unreadable;
//   - binds the runtime (interpreters, opencode/agent-browser, caches, CA certs) read-only.
//
// This holds independent of the permission-layer configuration: even a permissive or
// misconfigured `opencode.json` cannot re-expose the daemon environ or cross-user data,
// removing the single-point-of-failure property of the permission gate alone.
//
// `bwrap` uses the userns-first technique (create a user namespace, which is permitted for
// unprivileged processes, then a mount namespace inside it), so it works in a non-root
// container where a bare `unshare --mount` would fail. Availability MUST still be confirmed
// by a functional probe (see sandbox-capabilities.ts) and callers MUST fail closed if the
// probe fails, rather than spawning the agent unconfined.

/** Runtime paths the agent needs to READ (interpreters, binaries, config, CA certs). */
export const DEFAULT_CONFINEMENT_READONLY_PATHS: readonly string[] = [
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/lib64",
  "/etc/ssl",
  "/etc/ca-certificates",
  "/etc/ca-certificates.conf",
  "/etc/resolv.conf",
  "/etc/hosts",
  "/etc/nsswitch.conf",
  "/etc/passwd",
  "/etc/group",
  "/etc/localtime",
  "/deno-dir",
  "/usr/local/bin",
  "/app/src",
  "/app/prompts",
  "/app/deno.json",
  "/app/deno.lock",
  "/home/deno/.config",
  "/home/deno/.agents",
];

/**
 * Runtime paths the agent needs to WRITE at runtime beyond the session workspace: opencode
 * session/auth state and the browser cache/profile. These are the agent's OWN home dirs (no
 * daemon secrets live in files here — the daemon's secrets are in its process environ, which
 * the fresh `/proc` already hides).
 */
export const DEFAULT_CONFINEMENT_WRITABLE_RUNTIME_PATHS: readonly string[] = [
  "/home/deno/.cache",
  "/home/deno/.local/share/opencode",
  "/home/deno/.agent-browser",
];

export interface BwrapConfinementOptions {
  /** This session's workspace directory (read-write). */
  sessionWorkspace: string;
  /** This session's TMPDIR (read-write). */
  tmpDir: string;
  /** Shared agent workspace for self-research sessions (read-write), if applicable. */
  agentWorkspace?: string;
  /** Read-only runtime paths. Defaults to {@link DEFAULT_CONFINEMENT_READONLY_PATHS}. */
  readOnlyPaths?: readonly string[];
  /** Read-write runtime paths. Defaults to {@link DEFAULT_CONFINEMENT_WRITABLE_RUNTIME_PATHS}. */
  writableRuntimePaths?: readonly string[];
  /**
   * Whether the confined process keeps the parent's network namespace. F12 is a filesystem
   * confinement and keeps the network shared (`true`) so the agent can still reach the
   * loopback Skill API and any configured egress proxy; F14 owns network isolation.
   */
  shareNet: boolean;
}

/**
 * Build the `bwrap` argv that runs `command args...` inside the confinement.
 *
 * Pure and deterministic so the argument construction can be unit-tested without spawning.
 */
export function buildBwrapConfinement(
  opts: BwrapConfinementOptions,
  command: string,
  args: string[],
): { command: string; args: string[] } {
  const readOnly = opts.readOnlyPaths ?? DEFAULT_CONFINEMENT_READONLY_PATHS;
  const writableRuntime = opts.writableRuntimePaths ?? DEFAULT_CONFINEMENT_WRITABLE_RUNTIME_PATHS;

  const a: string[] = [
    "--unshare-user",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--die-with-parent",
    // Fresh /proc hides the daemon's PID 1 environ; a private /dev avoids host device access.
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
  ];

  if (!opts.shareNet) a.push("--unshare-net");

  // Read-only runtime. `--ro-bind-try` does not fail if a path is absent in a given image.
  for (const ro of readOnly) {
    a.push("--ro-bind-try", ro, ro);
  }

  // Read-write: the agent's own runtime state dirs, then THIS session's workspace + TMPDIR.
  for (const rw of writableRuntime) {
    a.push("--bind-try", rw, rw);
  }
  a.push("--bind", opts.sessionWorkspace, opts.sessionWorkspace);
  a.push("--bind", opts.tmpDir, opts.tmpDir);
  if (opts.agentWorkspace) {
    a.push("--bind", opts.agentWorkspace, opts.agentWorkspace);
  }

  a.push("--", command, ...args);
  return { command: "bwrap", args: a };
}
