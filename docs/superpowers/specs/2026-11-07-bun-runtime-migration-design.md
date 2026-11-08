# Bun Runtime Migration Design

- **Date:** 2026-11-07
- **Status:** Approved
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
  `<script>` token must contain a slash, because `bun run <name>` checks `package.json` scripts first.
  The safe-flag set is removed. Every other flag is denied, including `--preload`, `--require`,
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
- **Coverage:** the CI check reads the Branch column, so the current 75% floor is branch coverage.
  The baseline records all reported numbers. The floor stays on the equivalent Bun lcov measure;
  Deno's number is reference only, because the tools count differently.
- **Injection suite (new):** run trusted skills from an agent-writable directory containing `.env`,
  `.env.local`, `bunfig.toml`, `tsconfig.json`, `package.json` and `node_modules`. Also attempt
  `BUN_OPTIONS` as a command prefix. Flags cannot neutralize this variable, so the gate denying the
  prefixed form is the defense.

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

1. **Baseline:** record the freeze SHA, Deno test names and results, coverage, and the deployed
   image digest. No `/app/data` backup at this step, because nothing before cutover touches
   production data.
2. **Go/No-Go PoC:** prove the `openat2`/errno path through the real backend, ACP with real OpenCode
   and OMP including backpressure, egress-proxy behavior, and injection defenses. `arm64` evidence
   comes from the native `ubuntu-24.04-arm` GitHub Actions runner; the owner has no other arm64 host. An unsolvable
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

### OpenSpec proposals for steps 1 and 2

These changes live under `openspec/changes/`. Apply them in table order. Changes in the same order
group can swap places.

| Order | Change                             | Step | Scope                                                                             | Depends on                                                     |
| ----- | ---------------------------------- | ---- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1     | `capture-deno-baseline`            | 1    | Freeze SHA, Deno test names and results, coverage, rollback reference             | None                                                           |
| 2     | `build-bun-poc-harness`            | 2    | PoC workspace, pinned image, `run-suite.sh`, evidence collection, arm64 workflow  | `capture-deno-baseline`                                        |
| 3     | `define-bun-go-no-go-gate`         | 2    | P0-bound criteria catalog, evaluation, isolation condition, outcome verification  | `capture-deno-baseline`, `build-bun-poc-harness`               |
| 4     | `prove-bun-ffi-confinement`        | 2    | Real `openat2`, `statx` and errno path (FFI-01 to FFI-09)                         | `define-bun-go-no-go-gate`                                     |
| 4     | `prove-bun-agent-process-boundary` | 2    | Spawn boundary, backpressure, environment, signals (PROC-01 to PROC-09)           | `define-bun-go-no-go-gate`                                     |
| 4     | `prove-bun-egress-proxy`           | 2    | `node:net` proxy behavior (EGR-01 to EGR-08)                                      | `define-bun-go-no-go-gate`                                     |
| 4     | `prove-bun-injection-defenses`     | 2    | Shebang, approval grammar, missing-config behavior (INJ-01 to INJ-08)             | `define-bun-go-no-go-gate`                                     |
| 5     | `prove-bun-acp-real-agents`        | 2    | ACP success paths with real OpenCode and OMP (ACP-01 to 03, ACP-09, ACP-10)       | `define-bun-go-no-go-gate`, `prove-bun-agent-process-boundary` |
| 6     | `prove-bun-acp-failure-paths`      | 2    | Stalled reader, cancellation, timeout, abrupt exit, EOF (ACP-04 to ACP-08)        | `prove-bun-acp-real-agents`                                    |
| 7     | `record-bun-go-no-go`              | 2    | Final runs, arm64 CI evidence, recorded Go or No-Go outcome                       | All nine changes above                                         |

`record-bun-go-no-go` must run last, because changing `migration/bun/poc/` after its task 1.1
invalidates the evidence. A Go result does not check any box in section 9.

`record-bun-go-no-go` first recorded No-Go. `fix-bun-acp-harness-and-rerecord` corrected two harness
defects that had nothing to do with Bun: periodic fixture text that tripped OMP's thinking-loop
detector, and an ACP-06 test that never applied a client-side timeout. It then re-recorded the
outcome as **Go**: all 63 criteria pass on `x86_64` and `aarch64`
(`migration/bun/poc/GO-NO-GO.md`).

### OpenSpec proposals for steps 3 to 8

These changes live under `openspec/changes/` and were planned from the PoC findings. Apply them in
table order. Changes in the same order group can swap places, but changes that share
`package.json` or `bun.lock` (order 2) are applied one at a time. "Depends on" lists only direct
prerequisites that no other listed prerequisite already implies. Each proposal's `## Batch:` section
holds the full list and the conflict notes.

| Order | Change                                                  | Step | Scope                                                                                                  | Depends on                                                                                                                          |
| ----- | ------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `add-bun-package-manifest`                              | 3    | `package.json`, `bun.lock`, `bunfig.toml` and `tsconfig.json` with exact pins; `@node-rs/jieba` on x86_64 (P0-9) | Go outcome                                                                                                                          |
| 2     | `adopt-dprint-oxlint-and-tsc`                           | 3    | dprint with the current style, oxlint, `tsc --noEmit` check script                                     | `add-bun-package-manifest`                                                                                                          |
| 2     | `bundle-omp-extension-with-bun`                         | 3    | `bun build` OMP extension bundle, `bundle-audit.ts` kept, two-argument wrapper                         | `add-bun-package-manifest`                                                                                                          |
| 2     | `add-bun-test-parity-check`                             | 3    | Parity tool against `deno-tests.json`, exceptions record, `--allow-deferred`                           | `add-bun-package-manifest`                                                                                                          |
| 3     | `add-bun-conversion-codemod`                            | 4    | AST codemod, high-risk symbol owner table, runtime-platform (arm64 normalization) and fs-compat helpers | `adopt-dprint-oxlint-and-tsc`, `add-bun-test-parity-check`                                                                          |
| 4     | `convert-utils-platforms-and-test-support-to-bun`       | 4    | Utils, types, Discord and Misskey, test helpers, mocks and fixtures                                     | `add-bun-conversion-codemod`, `bundle-omp-extension-with-bun`                                                                       |
| 5     | `convert-core-state-and-schedulers-to-bun`              | 4    | Stores, schedulers, config, templates, memory recall, memory scripts                                    | `convert-utils-platforms-and-test-support-to-bun`                                                                                   |
| 5     | `convert-core-sessions-and-workspaces-to-bun`           | 4    | Orchestrator, workspaces, skill install, git backup, bootstrap                                          | `convert-utils-platforms-and-test-support-to-bun`                                                                                   |
| 5     | `convert-email-platform-to-bun`                         | 4    | Email platform and core email, `FileHandle` mapping                                                    | `convert-utils-platforms-and-test-support-to-bun`                                                                                   |
| 5     | `convert-acp-policy-and-filesystem-to-bun`              | 4    | ACP policy, filesystem, sandbox manager, skill-inventory filesystem seam                                | `convert-utils-platforms-and-test-support-to-bun`                                                                                   |
| 6     | `convert-acp-client-and-factory-to-bun`                 | 4    | ACP client and agent factory                                                                            | `convert-acp-policy-and-filesystem-to-bun`                                                                                          |
| 6     | `convert-skills-dashboard-and-skill-api-support-to-bun` | 4    | Skill handlers, dashboard support, Skill API registry                                                   | `convert-core-state-and-schedulers-to-bun`, `convert-core-sessions-and-workspaces-to-bun`                                           |
| 7     | `adopt-bun-agent-process-boundary`                      | 5    | `createAgentProcess` with callback stdin backpressure, real-child environment tests (P0-1, P0-2, P0-3) | `convert-acp-client-and-factory-to-bun`                                                                                             |
| 7     | `port-command-call-sites-and-sandbox-probe-to-bun`      | 5    | Remaining `Deno.Command` sites, native cache preparation, real sandbox probe tests (P0-7)              | `convert-core-sessions-and-workspaces-to-bun`, `convert-acp-policy-and-filesystem-to-bun`                                           |
| 7     | `port-egress-proxy-and-gelf-to-node-net`                | 5    | Proxy and GELF on `node:net`, `node:dns` and `node:dgram`; rebinding and half-close regressions (P0-5) | `convert-core-sessions-and-workspaces-to-bun`                                                                                       |
| 7     | `port-filesystem-ffi-to-bun-ffi`                        | 5    | `openat2`/`statx` on `bun:ffi` with real errno tests (P0-4 amd64)                                      | `convert-acp-policy-and-filesystem-to-bun`                                                                                          |
| 7     | `port-http-servers-to-bun-serve`                        | 5    | Dashboard, Skill API and health on `Bun.serve`; health probe checks `bun`                              | `convert-skills-dashboard-and-skill-api-support-to-bun`                                                                             |
| 8     | `port-process-lifecycle-and-pool-to-bun`                | 5    | Lifecycle primitives, process-tree SIGKILL on escalation, awaited pool stop (P0-3)                     | `adopt-bun-agent-process-boundary`, `convert-core-sessions-and-workspaces-to-bun`, `convert-core-state-and-schedulers-to-bun`       |
| 9     | `port-signals-and-entrypoint-to-bun`                    | 5    | `process.on` signal and error hooks, `parseArgs`, self-SIGTERM tests                                    | `port-http-servers-to-bun-serve`, `port-process-lifecycle-and-pool-to-bun`                                                          |
| 10    | `convert-agent-integration-suites-to-bun`               | 5    | Step 5 exit gate: agent integration suites, file-descriptor and process leak checks                   | `port-signals-and-entrypoint-to-bun`, `port-command-call-sites-and-sandbox-probe-to-bun`, `port-egress-proxy-and-gelf-to-node-net`, `port-filesystem-ffi-to-bun-ffi` |
| 11    | `convert-builtin-skills-to-bun`                         | 6    | Hardened shebang, `parseArgs` with argument tests, `skill-bunfig.toml` installer                       | `convert-agent-integration-suites-to-bun`                                                                                           |
| 12    | `enforce-bun-skill-approval-grammar`                    | 6    | Exact two-form grammar, `bun *: ask` and `bunx *: deny`, injection suite (P0-6), step 6 exit gate      | `convert-builtin-skills-to-bun`                                                                                                     |
| 13    | `rename-deno-runtime-identifiers`                       | 7    | `/home/air`, `ENV` only, `DENO_*` removed, confinement list                                            | `enforce-bun-skill-approval-grammar`                                                                                                |
| 14    | `package-bun-container-image`                           | 7    | Pinned `oven/bun` digest, root-owned immutable `/opt/air/skill-bunfig.toml`, image smoke and in-image tests (P0-4 seccomp, P0-7, P0-9 amd64) | `rename-deno-runtime-identifiers`                                                                                                   |
| 15    | `migrate-ci-and-docs-to-bun`                            | 7    | Bun CI on amd64 and arm64, open and restricted user-namespace runs, coverage floor, docs, `deno.json` and `deno.lock` removed | `package-bun-container-image`                                                                                                       |
| 16    | `drill-bun-cutover-and-rollback`                        | 8    | Restart-persistence tests (P0-8), container drill with thresholds fixed in advance, rollback drill, human-reviewed `TRIAL.md` | `migrate-ci-and-docs-to-bun`                                                                                                        |
| 17    | `cut-over-to-bun-release`                               | 8    | Final gates, section 9 evidence, `0.37.0` version and changelog, `migration/bun/` and migration-only specs removed | `drill-bun-cutover-and-rollback`                                                                                                    |

Section 9 ownership:

| P0   | Owning changes                                                                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 | `adopt-bun-agent-process-boundary`                                                                                                                                     |
| P0-2 | `adopt-bun-agent-process-boundary`, `convert-agent-integration-suites-to-bun`                                                                                          |
| P0-3 | `adopt-bun-agent-process-boundary`, `port-process-lifecycle-and-pool-to-bun`, `port-signals-and-entrypoint-to-bun`, `drill-bun-cutover-and-rollback`                   |
| P0-4 | `port-filesystem-ffi-to-bun-ffi`, `package-bun-container-image`, `migrate-ci-and-docs-to-bun`                                                                          |
| P0-5 | `port-egress-proxy-and-gelf-to-node-net`                                                                                                                               |
| P0-6 | `convert-builtin-skills-to-bun`, `enforce-bun-skill-approval-grammar`                                                                                                  |
| P0-7 | `port-command-call-sites-and-sandbox-probe-to-bun`, `package-bun-container-image`, `migrate-ci-and-docs-to-bun`                                                        |
| P0-8 | `drill-bun-cutover-and-rollback`                                                                                                                                       |
| P0-9 | `add-bun-package-manifest`, `package-bun-container-image`, `migrate-ci-and-docs-to-bun`                                                                                |
| P0-10 | `package-bun-container-image`, `migrate-ci-and-docs-to-bun`, `drill-bun-cutover-and-rollback`, `cut-over-to-bun-release`                                              |

These decisions are open for the owner. The changes name them, but they are not yet confirmed:

- **Coverage floor:** Bun 1.4.2 LCOV has no branch records, so `migrate-ci-and-docs-to-bun` moves the
  75% floor to line coverage over `src/`. The Deno baseline line coverage is 83.3%. This supersedes the
  Branch-column wording in section 6 once confirmed.
- **Drill thresholds:** `drill-bun-cutover-and-rollback` proposes these thresholds:
  - startup and idle memory: Deno median × 1.25
  - file descriptors: Deno maximum × 1.25
  - leftover processes: zero
  - stop time: under 15 s
- **Shutdown time:** the pool stop awaits disconnects and kills the process tree. This adds up to
  about 4 s to shutdown.
- **Error-handler fields:** Bun 1.4.2 does not fire `globalThis` `unhandledrejection`. The handler
  moves to `process.on`, and the uncaught-error log loses its separate filename, lineno and colno
  fields. The stack keeps that information.

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
