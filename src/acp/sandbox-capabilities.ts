// src/acp/sandbox-capabilities.ts
//
// Functional capability probes for the agent sandbox (F12 D4 / F14 D2).
//
// Both the network-egress isolation (F14) and the filesystem confinement (F12) depend on
// namespace/capability privileges that a non-root, `restricted-v2`-style container may or
// may not grant. These MUST be determined by actually attempting the operation (a functional
// probe), never by a mere `which <binary>` existence check — the binary can exist while the
// syscall is blocked. Empirically (verified under rootless podman as UID 1000, including
// `--security-opt no-new-privileges`):
//
//   - bare `unshare --net`                        FAILS (needs CAP_SYS_ADMIN in current userns)
//   - `unshare --user --map-root --net`           SUCCEEDS (nested user namespace grants it)
//   - `bwrap --unshare-user ... --ro-bind / /`    SUCCEEDS (bwrap uses the userns-first path)
//
// The gating factor is whether the node permits unprivileged user-namespace creation
// (`sysctl user.max_user_namespaces`), not container capabilities or `no-new-privileges`.
// Where userns creation is disabled, every probe below fails and callers MUST fail closed.
//
// Probes are synchronous (`outputSync`) and cached, so `SandboxManager.buildSpawnOptions`
// can consult them without becoming async.

import { createLogger } from "@utils/logger.ts";

const logger = createLogger("SandboxCapabilities");

function runProbeSync(command: string, args: string[]): boolean {
  if (Deno.build.os !== "linux") return false;
  try {
    const output = new Deno.Command(command, {
      args,
      stdout: "null",
      stderr: "null",
    }).outputSync();
    return output.success;
  } catch {
    return false;
  }
}

/**
 * Probe whether the agent process can be placed in its own network namespace.
 *
 * Uses the userns-first incantation (`unshare --user --map-root --net`) rather than a bare
 * `unshare --net`, because the bare form requires CAP_SYS_ADMIN in the current user
 * namespace and fails in a non-root container, whereas creating a user namespace first is
 * permitted for unprivileged processes and grants CAP_SYS_ADMIN inside it.
 */
export function probeNetworkNamespace(): boolean {
  return runProbeSync("unshare", ["--user", "--map-root", "--net", "true"]);
}

/**
 * Probe whether `bwrap` can establish a filesystem confinement (user + mount namespace with
 * a fresh `/proc`). This is the mechanism F12 D4 uses to hide `/proc/1/environ` and sibling
 * users' workspaces from the agent.
 */
export function probeFilesystemConfinement(): boolean {
  return runProbeSync("bwrap", [
    "--unshare-user",
    "--unshare-pid",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--ro-bind",
    "/",
    "/",
    "true",
  ]);
}

/** Cached probe results so the (cheap but non-zero) syscalls run once per process. */
let networkNamespaceProbe: boolean | undefined;
let filesystemConfinementProbe: boolean | undefined;

export function canIsolateNetwork(): boolean {
  if (networkNamespaceProbe === undefined) {
    networkNamespaceProbe = probeNetworkNamespace();
    logger.info("Network-namespace isolation probe result: {ok}", { ok: networkNamespaceProbe });
  }
  return networkNamespaceProbe;
}

export function canConfineFilesystem(): boolean {
  if (filesystemConfinementProbe === undefined) {
    filesystemConfinementProbe = probeFilesystemConfinement();
    logger.info("Filesystem-confinement (bwrap) probe result: {ok}", {
      ok: filesystemConfinementProbe,
    });
  }
  return filesystemConfinementProbe;
}

/** Override cached probe results (test-only). */
export function setSandboxCapabilityCacheForTest(
  network: boolean | undefined,
  confinement: boolean | undefined,
): void {
  networkNamespaceProbe = network;
  filesystemConfinementProbe = confinement;
}

/** Reset cached probe results (test-only). */
export function resetSandboxCapabilityCache(): void {
  networkNamespaceProbe = undefined;
  filesystemConfinementProbe = undefined;
}
