# Bun Runtime Migration Design

- **Date:** 2026-11-07
- **Status:** Approved design, pending written-spec review
- **Baseline:** `master` at `734c8b0`, version `0.36.1`
- **Branch:** `feat/migrate-to-bun`
- **Input:** local handoff document (`tmp/AIr-Friends-handoff-attachment.md`, untracked), re-verified
  against the baseline

## 1. Goal

Replace Deno with Bun in one merge. After the merge, neither the repository nor the container image
depends on `deno`. Existing features, persisted data formats and permission policy stay unchanged.

Deno's team announced on 2026-10-09 one more year of monthly fix and security releases, after which
it ends development. Deno stays open source, JSR keeps operating, and Deno Deploy closes after six
months. This project is self-hosted and does not use Deno Deploy, so the pressure is the end of
upstream maintenance, not an immediate outage.

### Decisions

| Topic                | Decision                                                                   |
| -------------------- | -------------------------------------------------------------------------- |
| Final runtime        | Bun only                                                                   |
| Delivery             | One long-lived branch, one cutover                                         |
| `master`             | Frozen for the whole migration; security fixes only, ported to the branch  |
| Built-in skills      | TypeScript on Bun with a hardened shebang and an exact approval grammar    |
| Early exit           | Go/No-Go proof of concept before mass conversion                           |

### Success criteria

1. All tests pass on Bun and the test-parity gate (section 6) passes.
2. Every P0 release blocker (section 9) passes.
3. `linux/amd64` and `linux/arm64` images run.
4. An existing `/app/data` mounts unchanged, and rollback to the old Deno image works.

### Out of scope

Cloudflare Workers, persisted-format rewrites, ACP protocol changes, new features, Helm structure
changes, and changing the Skill API authentication scheme.

## 2. Corrections to the handoff document

The handoff was based on version `0.32.0`. Its direction holds, but its baseline does not.

| Item                     | Handoff           | Baseline                    |
| ------------------------ | ----------------- | --------------------------- |
| Version                  | 0.32.0            | 0.36.1                      |
| `Deno.*` matches in src  | ~230 in 36 files  | 460 in 57 files             |
| Test files               | 107               | 197                         |
| `Deno.test(` matches     | ~2,234            | 3,376                       |
| `Deno.*` matches in tests | not stated       | 7,870                       |

The baseline counts are grep matches and include comments and type references. They are not an
effort estimate.

The handoff omits these items, all of which this design covers:

- **FFI:** `src/acp/filesystem-access-linux.ts` uses `Deno.dlopen` for descriptor-only
  `openat2`/`statx` access. No `node:*` replacement exists, so a shared-`node:*`-only strategy
  cannot work.
- **Skill execution:** 16 skill scripts use `deno run --allow-*` shebangs. The interpreter allowlist
  in `src/acp/skill-inventory.ts` and the `deno run *` rule in `agent-config/opencode.json` are part
  of the approval boundary.
- **Build-time Deno:** `deno bundle` builds the OMP extension and `deno run` prepares the OMP native
  cache.
- **Identifiers:** `/home/deno`, `DENO_DIR`, `DENO_NO_UPDATE_CHECK` and `DENO_ENV` appear in the
  confinement list, environment allowlists, Helm values and the image.
- **New subsystems:** `src/platforms/email/` and the OMP agent integration postdate the handoff.
- **Production sandbox:** as of 2026-07-18, `bwrap` confinement was not possible on the production
  Talos cluster (containerd 1.7).

## 3. Probe evidence

Throwaway probes ran on 2026-11-07 on Linux x86_64 with Bun 1.4.2, Deno 2.9.0 and Node.js 24.16.0.
They show feasibility only. None of them satisfies a P0 blocker.

**Runtime smoke test.** All three runtimes passed explicit-`env` isolation, a 32 MiB stdin/stdout
round trip through `cat`, `node:net` half-close, and SIGTERM exit reporting.

**FFI.** `bun:ffi` called `openat2` through `syscall`. A symlink returned `ELOOP` (40), a directory
escape returned `EXDEV` (18), and a missing path returned `ENOENT` (2). Alternating failures over
10,000 calls, with periodic event-loop yields, produced no errno mismatch.

**Working-directory injection.** A trusted script ran from a directory containing an attacker `.env`
and a `bunfig.toml` that set `preload`:

| Invocation                                | `.env` loaded | `preload` executed |
| ----------------------------------------- | ------------- | ------------------ |
| `bun run skill.ts`                        | yes           | yes                |
| Direct shebang (`bun run`)                | yes           | yes                |
| `bun run --no-env-file`                   | no            | yes                |
| `bun run --no-env-file --config=<empty>`  | no            | no                 |
| `bun build --compile` with defaults       | yes           | yes                |

The agent can write to its workspace, so a plain `deno run` to `bun run` swap would let it run
arbitrary code inside a trusted skill and defeat entrypoint-based approval. Section 4.4 addresses
this.

**Current Deno flags.** The shebang flags are unscoped. In practice they deny only `run`, `ffi` and
`sys`. The real boundary is the ACP approval gate with entrypoint matching.

## 4. Architecture

### 4.1 API selection

| Concern                                     | API                                  | Reason                                                       |
| ------------------------------------------- | ------------------------------------ | ------------------------------------------------------------ |
| Files, paths, env, signals, TCP, UDP, DNS   | `node:*`                             | Documented and keeps a future runtime change possible        |
| Child processes                             | `node:child_process` behind one boundary | Smoke test passed; use `Bun.spawn` only if the PoC requires it |
| HTTP servers                                | `Bun.serve`                          | Same fetch model as `Deno.serve`, smallest handler change    |
| libc calls                                  | `bun:ffi`                            | No `node:*` equivalent                                       |

### 4.2 Filesystem FFI

Replace only the `Deno.dlopen` backend with `bun:ffi`. Keep the `LinuxNativeCalls` interface, so
callers and confinement logic do not change. Failure to open libc stays fail-closed.

### 4.3 Agent processes

`createAgentProcess` is the single spawn boundary for OpenCode and OMP:

```ts
interface AgentProcessHandle {
  pid: number;
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<{ code: number | null; signal: string | null; success: boolean }>;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}
```

Rules:

- `env` is always passed explicitly. Spreading `process.env` is forbidden.
- Tests read the real child environment instead of inspecting spawn arguments.
- These behaviors stay unchanged: SIGKILL 2 seconds after SIGTERM, `dumb-init`, process-pool
  cleanup, and crash-signal rejection of pending ACP calls.
- Other `Deno.Command` call sites move to `node:child_process`, each keeping its current environment
  semantics. Sites that use `clearEnv` must still pass an explicit environment.

### 4.4 Skill execution and approval

Every built-in skill uses one shebang form:

```text
bun run --no-env-file --no-install --config=/opt/air/skill-bunfig.toml <script>
```

- `src/acp/skill-inventory.ts` accepts exactly two invocation forms for a trusted script: direct
  execution of its path, which applies the shebang, and the literal `bun run` form above. The
  safe-flag set is removed. Every other flag is denied, including `--preload`, `--require`,
  `--import`, `--inspect`, `--env-file`, `--cwd` and `--tsconfig-override`.
- `/opt/air/skill-bunfig.toml` is an empty, root-owned, read-only file in the image. Development and
  CI create the same file at that path. A missing file must stop the skill instead of falling back to
  working-directory discovery; the PoC verifies this behavior, and if Bun falls back, the shebang
  launcher must check the file first.
- `agent-config/opencode.json` replaces `deno run *` with `bun *: ask` and adds `bunx *: deny`.
- Built-in skills have no third-party runtime dependencies. `@std/flags` becomes `parseArgs` from
  `node:util`, with argument-behavior tests. No package cache is needed at run time, so `DENO_DIR`
  leaves the allowlists with no Bun replacement.

### 4.5 Daemon startup

Container and `package.json` start commands pass `--no-env-file` and the trusted config. This prevents
a `.env` load that Deno never performed. `env_file` in `compose.yml` is unaffected.

### 4.6 Network code

`src/utils/egress-proxy.ts` and `src/utils/gelf-transport.ts` move to `node:net`,
`node:dns/promises` and `node:dgram`. The proxy keeps full A/AAAA validation, connection to the
validated IP, metadata blocking, allowlist semantics, `Connection: close` on plain HTTP, half-close,
and short-write handling. Existing adversarial tests move unchanged in intent.

### 4.7 Sandbox detection

Keep real `unshare` and `bwrap` execution as the probe, and keep fail-closed behavior. CI covers
both capable and incapable environments. If the production cluster still lacks `bwrap` support, the
pass condition is correct detection and correct fail-closed behavior. `bwrap` success is required
only if the cluster has been upgraded.

### 4.8 HTTP and signals

`src/dashboard/server.ts`, `src/skill-api/server.ts` and health checks move to `Bun.serve`. Client
address handling, authentication and endpoints stay unchanged. The dashboard's self-SIGTERM must
reach the migrated handlers in `src/shutdown.ts` and `src/core/error-handler.ts`.

## 5. Toolchain

| Item                                    | From                     | To                                       |
| --------------------------------------- | ------------------------ | ---------------------------------------- |
| Dependencies                            | `deno.json`, `deno.lock` | `package.json`, `bun.lock`, frozen in CI |
| Path aliases                            | import map               | `tsconfig.json` `paths`                  |
| Vento                                   | jsDelivr URL             | npm `ventojs@2.2.0`                      |
| `@std/path`, `fs`, `yaml` and similar   | JSR                      | `node:*` and the `yaml` package          |
| `@std/assert`, `@std/testing/time`      | JSR                      | dev dependencies through `@jsr/*`        |
| Formatter                               | `deno fmt`               | dprint with the current style settings   |
| Linter                                  | `deno lint`              | oxlint                                   |
| Type check                              | `deno check`             | `tsc --noEmit` with Bun types            |
| OMP extension bundle                    | `deno bundle`            | `bun build --format=esm`                 |

`scripts/omp/bundle-audit.ts` stays in force. `@node-rs/jieba` must load and tokenize correctly on
both architectures. Bun is pinned to an exact version and an image digest. Each Bun upgrade reruns
the injection regression suite.

## 6. Testing

- `Deno.test` converts to `bun:test`. Assertions keep `@std/assert`, so 198 importing files need no
  assertion rewrite.
- Test files run sequentially because tests mutate `process.env`. `--timeout=120000` replaces Bun's
  5-second default, because Deno has no such default.
- **Parity gate:** the baseline records Deno test names. Before cutover, every name has a Bun
  counterpart, or the migration record lists why it was removed or skipped.
- **Accepted loss:** 432 Deno sanitizer options have no Bun equivalent. P0 integration tests check
  file-descriptor and process counts instead.
- **Coverage:** the 75% floor stays and is measured from Bun lcov. Deno's baseline number is
  reference only, because the tools count differently.
- **Injection suite (new):** run trusted skills from an agent-writable directory containing `.env`,
  `.env.local`, `bunfig.toml`, `tsconfig.json`, `package.json` and `node_modules`. Also attempt
  `BUN_OPTIONS` as a command prefix. Skill behavior must not change and the gate must deny the
  prefixed form.

Existing security tests must keep their intent, especially
`tests/acp/agent-connector-env-isolation.test.ts`, `tests/acp/filesystem-confinement.test.ts`,
`tests/acp/skill-inventory.test.ts`, `tests/acp/opencode-skill-permission-routing.test.ts`,
`tests/utils/egress-proxy.test.ts` and `tests/utils/ssrf.test.ts`.

## 7. Packaging and deployment

- Base image: `oven/bun:1.4.2-debian`, pinned by digest.
- Keep Node.js 24 (`npx` and `agent-browser`), `dumb-init`, UID 1000, GID 0, `cap_drop: [ALL]`,
  `no-new-privileges`, and `/app/data` and `/app/prompts` semantics.
- Rename `/home/deno` to `/home/air` (76 matches in 19 files). It is outside persistent mounts.
- Use existing `ENV` instead of `DENO_ENV`. Remove `DENO_DIR` and `DENO_NO_UPDATE_CHECK`.
- `src/healthcheck.ts` checks `bun` instead of `deno`.
- CI drops the `deno compile` job pinned to 2.8.3 and adds an image smoke test that runs `--help`.
- Update `.github/workflows/ci.yaml`, `release.yml`, `docker-publish-latest.yml`,
  `copilot-setup-steps.yml` and `docker-reused-setup-steps/action.yml`.
- Update `AGENTS.md`, `README`, `docs/` and the affected `openspec/specs/`.
- Reword `openspec/specs/container-packaging/spec.md`: OMP needs no additional runtime, while Bun is
  the application base.

**Breaking changes:** release as `0.37.0` and mark them `BREAKING` in the changelog. Deployments must
update `env.DENO_ENV` and any custom `AGENT_SKILLS_DIR` value, including the ArgoCD Helm parameters.

## 8. Work order

All steps happen on `feat/migrate-to-bun`.

1. **Baseline:** record the freeze SHA, Deno test names and results, coverage, and the old image
   digest. Back up `/app/data`.
2. **Go/No-Go PoC:** prove the `openat2`/errno path through the real backend, ACP with real OpenCode
   and OMP including backpressure, egress-proxy behavior, and injection defenses. An unsolvable
   blocker stops the migration, and `master` unfreezes.
3. **Toolchain:** section 5.
4. **Mechanical conversion:** convert `src/` and `tests/` together to `node:*` and `bun:test`.
5. **High-risk modules:** process lifecycle, egress proxy, GELF, FFI, HTTP, signals.
6. **Skills and gate:** section 4.4.
7. **Packaging and deployment:** section 7.
8. **Cutover:** section 10.

The branch may stay red between steps 4 and 6. Each of steps 5, 6 and 7 ends with its affected tests
passing.

The first implementation plan covers steps 1 and 2 only. Steps 3 to 8 are planned after a Go result,
so that plan can use the PoC findings.

## 9. P0 release blockers

- [ ] Unauthorized parent secrets are absent from real OpenCode and OMP child environments, and
      required variables are present.
- [ ] ACP handshake, large NDJSON traffic, stderr consumption, backpressure, EOF, timeout,
      cancellation and abrupt exit all pass.
- [ ] SIGTERM, SIGKILL after 2 seconds, container stop, pool cleanup and restart leave no orphan
      processes.
- [ ] `openat2`/`statx` confinement passes on `amd64` and `arm64`, including fail-closed behavior.
- [ ] Egress-proxy DNS, metadata, IP pinning, HTTP CONNECT and half-close regression tests pass.
- [ ] The injection suite passes.
- [ ] Sandbox detection and fail-closed behavior pass under the target container permissions.
- [ ] Memory, reminders, workspaces, Skill API token validation and permission isolation keep their
      behavior across restart.
- [ ] Native dependencies and external tools work on both architectures.
- [ ] CI, container deployment and a rollback drill pass with no known cutover blocker.

## 10. Cutover and rollback

1. Run the new image in isolation against a copy of `/app/data`. Exercise Discord, Misskey, Email,
   reminders, memory, the Skill API, OpenCode and OMP.
2. Compare agent startup time, memory, file descriptors and leftover processes with the baseline.
   Set numeric thresholds from baseline data, before this comparison runs. The rule is no material
   regression.
3. Merge, release `0.37.0`, and switch the image through ArgoCD.
4. On failure, return to the old image digest and old parameters. No data restore is expected
   because formats do not change. Keep the pre-cutover backup anyway.
5. Unfreeze `master` after the new image runs stably in production for one week. During that week,
   only fix migration regressions.

## 11. Risks

| Risk                                                          | Mitigation                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| Bun's Node.js compatibility differs under real ACP load       | Go/No-Go PoC; `Bun.spawn` fallback behind the spawn boundary  |
| A Bun upgrade adds a new implicit config source               | Exact version pin; injection suite on every upgrade           |
| Deno sanitizer coverage is lost                               | FD and process-count checks in P0 integration tests           |
| A production-only issue appears after cutover                 | Isolated data-copy trial; rollback by image digest            |
| A long freeze blocks feature work                             | PoC runs first and stops early; no scope additions            |
| Security fixes land during the freeze                         | Port every such fix to the branch                             |
