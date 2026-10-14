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
 * Runtime paths the agent needs to WRITE at runtime beyond the session workspace: the
 * browser cache/profile. The shared OpenCode data dir (`~/.local/share/opencode`) is NOT
 * bound — the agent runs with a session-scoped `XDG_DATA_HOME` under the workspace TMPDIR,
 * so its data dir (tool-output, auth, storage, logs) lives inside the session workspace
 * and the shared home-rooted dir is never written or visible to the confined process.
 */
export const DEFAULT_CONFINEMENT_WRITABLE_RUNTIME_PATHS: readonly string[] = [
  "/home/deno/.cache",
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
   * Per-launch runtime paths that must end up READ-ONLY even when a mandatory
   * writable mount covers an ancestor (session workspace / TMPDIR / shared
   * agent workspace). Emitted AFTER every writable bind, so the last bind wins
   * — the same technique the skill root uses below. Absent for OpenCode, which
   * supplies no runtime inputs.
   */
  runtimeReadOnlyPaths?: readonly string[];
  /**
   * Per-launch writable paths re-emitted AFTER {@link shadowedRuntimePaths}, so
   * the selected data child survives the shadowing of its parent. Absent for
   * OpenCode.
   */
  runtimeWritablePaths?: readonly string[];
  /**
   * Per-launch parents shadowed by an EMPTY tmpfs after the writable binds, so
   * a mode's sibling state directories sitting under a mandatory writable
   * ancestor are neither visible nor writable. Callers MUST only pass paths
   * whose parent is already bound in this namespace (bwrap creates missing
   * mountpoint parents against the real root otherwise).
   */
  shadowedRuntimePaths?: readonly string[];
  /**
   * The canonical deployment trusted skill-script root (`unify-skill-root-and-
   * inventory` D4, generalizing `unify-omp-skill-root-resolution` D4) — BOTH
   * agent types resolve this same value: mounted read-only at its LITERAL path
   * — never the agent HOME, never a guessed `/app/skills`, and never an
   * agent-writable parent mount. When it sits UNDER a mandatory writable mount
   * (development repository layouts), the read-only child bind is emitted
   * AFTER that writable parent so the child stays read-only. Absent (undefined)
   * simply means no extra mount — with no invented fallback root.
   */
  skillRoot?: string;
  /**
   * Whether the confined process keeps the parent's network namespace. F12 is a filesystem
   * confinement and keeps the network shared (`true`) so the agent can still reach the
   * loopback Skill API and any configured egress proxy; F14 owns network isolation.
   */
  shareNet: boolean;
}

/** Root-aware containment: handles `/` (everything below root) and the
 * boundary-safe separator rule for every other root. */
function containsPath(root: string, path: string): boolean {
  if (path === root) return true;
  if (root === "/") return path.startsWith("/");
  return path.startsWith(root + "/");
}

/** Best-effort canonical view of an existing bind source (post-duck B3): a
 * mandatory writable that is a SYMLINK to the skill root is the same physical
 * tree even though its spellings differ — the overlap check must observe
 * physically. A source that does not (yet) exist keeps its literal spelling:
 * bwrap `--bind-try` would create/mount it at that path. */
function canonicalSource(path: string): string {
  try {
    return Deno.realPathSync(path);
  } catch {
    return path;
  }
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

  // D4 validation BEFORE the spawn: the selected root may never EQUAL or
  // CONTAIN a mandatory writable mount (session workspace, session TMPDIR,
  // shared agent workspace, or any writable runtime path) — an agent-writable
  // parent or hole inside the mounted skill tree would silently undo the
  // read-only mount where the permission layer still reports the grant. A root
  // merely DESCENDING from a writable mount is legitimate (development repo
  // layouts) and is mounted read-only AFTER that parent below.
  if (opts.skillRoot !== undefined) {
    const mandatoryWritables: string[] = [
      opts.sessionWorkspace,
      opts.tmpDir,
      ...writableRuntime,
      // The per-launch writable inputs are bound LATE, but they are writable
      // mounts all the same: a skill root that equals or contains one of them
      // would be re-bound read-only over a writable state tree, so it must be
      // refused here exactly like every other mandatory writable.
      ...(opts.runtimeWritablePaths ?? []),
    ];
    if (opts.agentWorkspace) mandatoryWritables.push(opts.agentWorkspace);
    for (const writable of mandatoryWritables) {
      // Equal root OR the writable (physically) inside the root — compared on
      // BOTH spellings so a symlinked writable alias to the skill tree cannot
      // escape the refusal (B3) — or a filesystem-root skill selection, which
      // contains every mandatory writable by construction.
      const canonicalWritable = canonicalSource(writable);
      if (
        opts.skillRoot === "/" ||
        containsPath(opts.skillRoot, writable) ||
        containsPath(opts.skillRoot, canonicalWritable)
      ) {
        throw new Error(
          `Skill root "${opts.skillRoot}" equals or contains mandatory writable mount ` +
            `"${writable}" (canonical: "${canonicalWritable}") — an agent-writable skill ` +
            "root is refused before spawn",
        );
      }
    }
  }

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

  // Per-launch runtime reachability, emitted LAST among the writable/bind
  // steps so a mandatory writable ancestor can never widen or hide it:
  //   1. shadow the mode parent (hides sibling state under a writable tree),
  //   2. re-bind the selected data child inside that shadow,
  //   3. bind the selected authored assets read-only.
  for (const shadowed of opts.shadowedRuntimePaths ?? []) {
    a.push("--tmpfs", shadowed);
  }
  for (const rw of opts.runtimeWritablePaths ?? []) {
    a.push("--bind-try", rw, rw);
  }
  for (const ro of opts.runtimeReadOnlyPaths ?? []) {
    a.push("--ro-bind-try", ro, ro);
  }

  // D4: the trusted skill root, read-only at its literal path, bound LAST so a
  // skill tree that descends from a writable parent (development layouts)
  // remains read-only inside this mount namespace. `--ro-bind-try` tolerates an
  // absent path (a race-shrunk root simply leaves nothing mounted where the
  // inventory, rechecking root identity, already denies).
  if (opts.skillRoot !== undefined) {
    a.push("--ro-bind-try", opts.skillRoot, opts.skillRoot);
  }

  a.push("--", command, ...args);
  return { command: "bwrap", args: a };
}
