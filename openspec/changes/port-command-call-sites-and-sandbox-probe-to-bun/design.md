# Design

## Context

See `proposal.md`. Observed call sites and their environment semantics:

| Site | Options | Semantics |
| --- | --- | --- |
| `git-credential-setup.ts:108` | `git config --global credential.helper store`, piped, no `env` | inherits parent env |
| `git-backup-service.ts:403` | `git <BYTE_PRESERVING_GIT_ARGS> ...`, `cwd: dataDir`, `env: { GIT_TERMINAL_PROMPT, GIT_AUTHOR_*, GIT_COMMITTER_* }`, no `clearEnv` | parent env merged with the listed vars; stdout bytes decoded by the caller |
| `skill-installer.ts:59` | `cmd args`, piped, `env` + `clearEnv: true` only when `options.env` is set | exact env when given, else inherit |
| `session-orchestrator.ts:6497` | `convert <gif>[0] <webp>`, stdout null, stderr piped; checks `success` and logs `code` | inherits parent env |
| `omp-version.ts:115`, `opencode-version.ts:90` | `<cmd> --version`, piped, `spawn()` then `output()` raced against a timeout that SIGKILLs; spawn throw → `null` | inherits parent env |
| `sandbox-capabilities.ts:30` | `outputSync()` of `unshare --user --map-root --net true` or `bwrap --unshare-user --unshare-pid --proc /proc --dev /dev --ro-bind / / true`; `Deno.build.os !== "linux"` → false; any throw → false | inherits parent env |
| `scripts/omp/prepare-native-cache.ts:191` | `<omp> acp`, `cwd`, `clearEnv: true`, `env: { HOME, XDG_DATA_HOME, TMPDIR, PATH }`, piped stdin/stdout/stderr | exact env |

`node:child_process` differences that matter: `spawn` of a missing binary does not throw; it emits `error` (`ENOENT`). `spawnSync` returns `{ error, status, signal }` instead of throwing. `env` replaces the parent environment entirely when given.

## Goals / Non-Goals

**Goals:** each site keeps its exact environment, exit-code and timeout behavior; P0-7 probe evidence.

**Non-Goals:**

- No `bwrap` success requirement: section 4.7 requires `bwrap` success only if the production cluster gained support (the 2026-07-18 note says it had not).
- No change to probe arguments, the probe cache, `SandboxManager` decisions or the version-check timeout values.
- No use of `createAgentProcess` for these short-lived tools.

## Decisions

### D1. Mapping

| Deno semantics | Bun |
| --- | --- |
| inherit parent env | omit `env` |
| `env` without `clearEnv` | `env: { ...process.env, ...listed }` |
| `env` with `clearEnv: true` | `env: listed` |
| `.output()` with piped stdout/stderr | `execFile(cmd, args, { cwd, env, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 })` promisified; map to `{ code: error?.code ?? 0, success, stdout: Uint8Array, stderr: Uint8Array }`. A spawn failure (`error.code` is a string such as `ENOENT`) keeps the old "threw" path. |
| `.outputSync()` | `spawnSync(cmd, args, { stdio: "ignore" })`; `success = result.error === undefined && result.status === 0` |
| `spawn()` + `output()` raced with timeout | `spawn(cmd, ["--version"], { stdio: ["ignore", "pipe", "pipe"] })`; collect stdout/stderr chunks; resolve on `close`; resolve `null` on `error`; the timeout arm calls `child.kill("SIGKILL")` and resolves `null` |

Keep every existing log message and returned shape. For `git-backup-service.ts`, keep the byte-preserving decoding of stdout exactly as the caller does today.

### D2. Sandbox probe

`runProbeSync`: `if (runtimeOs() !== "linux") return false;` then the `spawnSync` row. No other change.

### D3. Native cache preparer

Shebang `#!/usr/bin/env -S bun run --no-env-file`. Convert with the codemod and README; the `<omp> acp` child uses `spawn(executable, ["acp"], { cwd, env: { HOME, XDG_DATA_HOME, TMPDIR, PATH }, stdio: "pipe" })`, writes the initialize request with `child.stdin.write(bytes, callback)` awaited (Go record finding 1), and reads stdout through `Readable.toWeb(child.stdout)` so `readInitializeResponse` and `drainTail` keep their web-stream signatures. `Deno.env.get("PATH")` → `process.env.PATH`. `package.json` script `prepare:omp-natives` = `bun run --no-env-file scripts/omp/prepare-native-cache.ts`. The test's stub executable uses the same Bun shebang and `process.argv`/`process.stdin`.

### D4. Probe tests

`tests/acp/sandbox-capabilities.test.ts` writes executable `#!/bin/sh` stubs (`exit 0` or `exit 1`) named `unshare`/`bwrap` into a temp dir and sets `process.env.PATH` to that dir for the test (restored in `finally`), calling `resetSandboxCapabilityCache()` before each test and calling `probeNetworkNamespace()` / `probeFilesystemConfinement()` directly. The "missing" scenario uses an empty temp dir as `PATH`. The real-host scenario runs `spawnSync("unshare", ["--user", "--map-root", "--net", "true"])` directly with the original `PATH` and compares. Tests are sequential (Bun default), so the `PATH` mutation does not leak.

## Risks / Trade-offs

- [`execFile` `maxBuffer` truncates large git output] → 64 MiB is above any backup diff the service reads; an overflow raises an error, which the existing error path reports.
- [Probe result differs between Deno and Bun on the same host] → The real-host scenario ties the probe to the direct command result.
