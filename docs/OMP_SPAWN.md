# OMP Spawn-Mode-Scoped Agent Integration

This document defines the launch argument assembly, mode resolution, process
data paths, environment and sandbox pass-through contracts for Oh-My-Pi (OMP)
agents within AIr-Friends.

Pinned to official OMP `v18.6.1` / commit `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`.

---

## 1. Spawn-Time Mode Resolution

In AIr-Friends, OMP permission modes are resolved strictly at spawn time via the effective `yolo` permission flag:

- `yolo === false` maps to mode `restricted`.
- `yolo === true` maps to mode `native-yolo`.

Unlike OpenCode (which uses ACP `setSessionMode()` to toggle into `"yolo"` mode
on an existing process), OMP never supports mixed-mode process reuse: the pinned
native ACP exposes **no per-session approval-mode field**, so the approval
posture is fixed at spawn for the process lifetime. Consequently:

- `getSessionModeOverride("omp", false)` returns `null`.
- `getSessionModeOverride("omp", true)` returns `null`.
- OpenCode's session mode switching behavior (`getSessionModeOverride("opencode", true) === "yolo"`) remains unchanged.

The resolved mode selects the mode settings document (section 2) and the mode-distinct native data root (section 3). It introduces no protocol override, environment key or control channel.

---

## 2. Launch Argument Assembly

The factory (`src/acp/agent-factory.ts`, `omp` branch) assembles the argument
list deterministically from the resolved mode:

```
omp acp --config <selected mode settings> --system-prompt <selected prompt>
```

### Restricted Launch

- Subcommand: `acp`
- Mode configuration: exactly ONE `--config` value —
  `resolveOmpConfigPath("agent-config/omp/restricted.yml")`
  (`src/utils/omp-paths.ts`): the installed copy
  `/opt/air/omp/config/restricted.yml` when it exists, otherwise the authored
  development-tree path. `tools.approvalMode: write` plus the exact-name
  approval entries (see [OMP_SETTINGS.md](OMP_SETTINGS.md) §1a) are parsed by
  native OMP itself.
- Trusted extension: `--trusted-extension <selected generated artifact>` —
  `resolveOmpExtensionPath()` returns the installed image artifact
  `/opt/air/omp/extension/index.js` when present, otherwise the deterministic
  GENERATED development entry `build/omp-extension/index.js`. The canonical
  source `src/acp/omp/extension/index.ts` is the bundler INPUT and never a
  launch target. A missing generated artifact fails the launch naming the
  `deno task bundle:omp-extension` remedy; raw source is never a fallback.
  The bundle is one small ESM file with zero external dependency edges whose
  default export registers the restricted capability handler through the
  official pre-dispatch tool-call API ([OMP_ENFORCEMENT.md](OMP_ENFORCEMENT.md),
  [OMP_TOOL_POLICY.md](OMP_TOOL_POLICY.md)).
- System prompt override: `--system-prompt <selected prompt>` —
  `resolveOmpSystemPromptPath()` prefers the operator mount
  `/app/prompts/system_prompt_override.md` when it exists, otherwise the
  installed `/opt/air/omp/prompt/SYSTEM.md` artifact, otherwise the mount path
  unchanged.
- **Invariant**: the argument list is exactly `acp`, `--config`,
  `--system-prompt` and (restricted launch only) `--trusted-extension`; no
  approval-mode, extension-suppression or LSP-suppression flag exists in
  either mode. Native ambient exploration stays enabled, and the LSP denial is
  carried by the exact-name native approval entry
  (`tools.approval.lsp: deny`) in each mode document — never by a launch flag.

### Native-YOLO Launch

- Subcommand: `acp`
- Mode configuration: exactly ONE `--config` value for
  `agent-config/omp/native-yolo.yml` (installed copy
  `/opt/air/omp/config/native-yolo.yml`), authored with
  `tools.approvalMode: yolo` and the single explicit `tools.approval.lsp: deny`
  exception.
- No extension: YOLO loads no `--trusted-extension` and registers no
  restricted handler, so its permissive native policy stands for every tool
  except the LSP denial.
- Same system prompt argument as the restricted launch.

Each mode selects its own document by construction, so a restricted document
can never be selected for a YOLO launch and vice versa.

### Native settings errors

The launch delegates configuration parsing entirely to native OMP. An invalid
authored document produces a NATIVE parse/startup error, which flows through
the existing session error reporting as the session's error; this application
performs no schema pre-validation and rewrites no file.

---

## 3. Mode-Distinct Native Data & Process Environment

1. **Working directory**: the process cwd is the caller/session `workingDir`
   (`cwd: workingDir`) in pooled and per-spawn shapes alike. No
   deployment-owned or mode-scoped working directory is used, so each session
   keeps its own working directory.
2. **HOME is inherited normally** (alongside `PATH`, `DENO_DIR`, `LANG`,
   `LC_ALL` and `USER`) and is never reassigned. Native OMP reads its model
   configuration from the inherited HOME's native config path
   (`~/.omp/agent/models.yml`).
3. **`XDG_DATA_HOME`** is the mode-distinct native data root
   `ompXdgDataHome(baseRoot, mode)` = `{baseRoot}/omp-agent/{mode}/xdg-data`,
   where `baseRoot` is `{dataRoot}/omp-pools/{poolKey}` for a pooled process
   and `{workingDir}/tmp` for a per-spawn process. Its `omp` child is created
   BEFORE spawn, because native OMP redirects its data directory (sessions,
   database, auth side files) to `$XDG_DATA_HOME/omp` when that application
   directory already exists. Restricted and native-YOLO processes therefore
   never share one mutable native data directory.
4. **`TMPDIR`** follows the existing shared/per-spawn convention:
   `{dataRoot}/channel-tmp/{poolKey}` when pooled, `{workingDir}/tmp`
   otherwise. Process tmp is NOT mode-specific.
5. **`SESSION_ID`** is assigned per-spawn when the session has one;
   **`SKILL_SHARED_PROCESS=1`** is assigned when pooled. `SKILL_JWT_DIR`,
   `AGENT_WORKSPACE`, the detected browser binary path and the egress proxy
   variables (`HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` and lowercase forms) keep
   their existing behavior.
6. **Environment filtering** is the shared filter/allowlist
   (`sandbox.filterEnv` / operator `allowedEnvVars`). Platform, dashboard and
   raw Skill API secrets stay denied, OpenCode's existing selector denials are
   unchanged, and OMP adds no separate discovery-environment step or selector
   prerequisite: the shared filtering choice is the whole OMP contract.
7. **Payload staging** remains `{session cwd}/tmp/{Skill API ID}`, independent
   of every native process data path above and unchanged by mode selection.

---

## 4. Confinement Mounts

When filesystem confinement is configured, the OMP branch supplies
`AgentConfig.runtimeMounts` (optional, OMP only) and
`SandboxManager.buildSpawnOptions()` merges it with the shared confinement
defaults:

- **Read-only**: the selected mode settings file, the selected system prompt,
  the restricted capability bundle (restricted launch only) and the
  inherited-HOME `.omp/agent/models.yml`.
- **Read-write**: the selected `<XDG_DATA_HOME>/omp` native data child.

Neither the sibling mode/pool data roots, the pool parent, `dataRoot` nor HOME
is exposed, and the shared skill-root overlap refusal plus the final read-only
skill bind are unchanged. OpenCode passes no `runtimeMounts` and keeps its
existing mounts. These are ordinary mount-reachability inputs for the selected
native assets; they are not a source-identity or module-trust mechanism.

---

## 5. Inherited Verdicts and Evidence Limits

Unit and mock tests in AIr-Friends verify argument construction, environment
assembly and configuration bytes only; they never invoke the native binary, a
provider, a container, a sandbox or a platform.

1. Pinned upstream compatibility observations ([docs/OMP_COMPATIBILITY.md](OMP_COMPATIBILITY.md)):
   the native-runtime cutover removed the former compatibility-contract/ledger
   apparatus and its decision register. The accepted upstream differences and
   native approval semantics that are still current are recorded there; the
   earlier governance verdicts survive only as historical evidence (see
   `CHANGELOG.md`). Nothing here reopens a superseded procedure.
2. Packaging and binary installation (row 20, revised by
   `simplify-omp-container-installation`): landed — the `/opt/air/omp` artifact
   tree, the `/usr/local/bin/omp` install and the pinned `omp` v18.6.1 pin all
   follow the image's ordinary `$UID:0` + `775` install convention, and no
   OMP-specific ownership policy or internal digest manifest remains.
   Official-runtime behavior (the native extension load, native settings parsing
   and both-architecture image acceptance) remains user-owned and UNVERIFIED
   ([USER-RUNTIME-VERIFICATION.md](USER-RUNTIME-VERIFICATION.md)).
3. Restricted tool policy is landed (the capability decisions consumed by the
   pre-dispatch handler) and its native invocation remains user-owned and
   unverified. Readiness stays cancelled (row 13 removed): no handshake,
   channel or tuple exists, and the accepted residual is that an extension
   which fails to load leaves the session without the restricted capability
   set.

---

## 6. Native Evidence — Real Pinned-Binary Acceptance

`tests/acp/omp-native-runtime-smoke.test.ts` is the REAL-binary probe for this
document's launch/mount contracts: it produces the CONFINED lifecycle/mount
evidence (initialize → `session/new` → advertised-catalog selection → load with
the same actual session id, plus the confined pooled consumers) and it sends NO
prompt. It never substitutes a mock, a synthetic session id or a fabricated
catalog for a missing prerequisite.

It is **not** the only suite that executes the official pinned binary. The
scripted-provider suite
`tests/integration/omp-native-runtime/native-runtime.integration.test.ts` (§7)
also runs the pinned `omp`, and it owns the native TOOL-DISPATCH evidence — real
restricted and native-YOLO tool dispatch against a loopback scripted model.

### 6.1 What the probe exercises

- **Fixture boundary.** The hand-authored
  `tests/fixtures/omp-native-runtime/home/.omp/agent/models.yml` (one
  credential-free, zero-cost `parity-fixture` provider/model; the fixture file
  IS the authored bytes) is copied byte-for-byte into a temporary HOME BEFORE the
  observation interval. The configured single skill root (`agent.skillsDir`) is
  provisioned from the tracked `skills/` tree inside that HOME, so the factory,
  the connector inventory and the confinement consumer all observe ONE root.
  The parent environment is restored in `finally`.
- **Both launch modes, unconfined.** Real `createAgentConfig` →
  real `AgentConnector`: `initialize`, `session/new`, advertised-catalog model
  selection, `session/cancel`, then respawn + `session/load` with the SAME
  actual session id and no OMP ownership/gate payload. No prompt is sent.
  This leg runs in `tests/mocks/omp-native-lifecycle-driver.ts` — a child
  process the probe executes under `strace -f`, so the PRODUCTION FACTORY's own
  filesystem operations and every native descendant land in ONE trace and the
  production argv is never wrapped. One trace per mode therefore covers both the
  initial start and the recovery respawn.
- **Advertised catalog.** The fixture model is selected from the ACTUAL
  advertised catalog; an unadvertised id is rejected as a `catalog-miss`
  (negative control), which proves the positive selection resolved through the
  real catalog. OMP advertises the concrete `provider/modelId` identity, so the
  selector is `parity-fixture/parity-fixture` — a bare id is a catalog miss by
  construction.
- **Confined pooled consumers.** One `AgentProcessPool`, one `poolKey`, two
  `run()` calls with opposite `permissionMode`, real connectors captured through
  the existing `connectorFactory` injection. Each mode persists native state
  beneath its own `{baseRoot}/omp-agent/{mode}/xdg-data/omp` (section 3.3) and is
  restored through its own connector afterwards.
- **Selected-root IO controls.** The shipped mount policy (`SandboxManager` +
  the factory's `runtimeMounts`) is spawned for real: the inherited-HOME native
  model file reads through its read-only mount, the selected native data child is
  WRITABLE, the configured skill root reads but refuses writes, and the SIBLING
  mode's state is unreachable.
- **Write observation.** The traced driver runs under
  `strace -f -y -e trace=openat,openat2,creat,rename,renameat,renameat2,unlink,unlinkat`
  AFTER provisioning. Required: ZERO writable opens or replacements of the
  authored inputs the launch selected (`--config`, `--system-prompt`,
  `--trusted-extension`, the inherited-HOME `models.yml` — derived from the
  factory output, so an installed image copy is watched exactly like a
  development-tree file), the expected native data writes beneath the selected
  `XDG_DATA_HOME/omp`, and READ-ONLY opens of the selected mode document and the
  fixture model file (so the zero-write result is a real observation, not an
  empty trace). Pathname operands are resolved against the descriptor
  directories `-y` decodes; an operand this observer cannot resolve that carries
  a watched file's name is treated as a POTENTIAL write (fail closed) rather
  than silently ignored, and only successfully completed opens count as
  consumption.

### 6.2 Prerequisites

Each is EXPLICIT and never downgraded to a mock:

| Prerequisite | Without `OMP_NATIVE_ACCEPTANCE` | With `OMP_NATIVE_ACCEPTANCE=1` |
| :--- | :--- | :--- |
| `omp --version` succeeds and reports exactly `18.6.1` | the native legs report UNEXERCISED | the run FAILS naming the missing binary, the non-zero probe or the reported version |
| `strace` available on `PATH` | the traced leg reports UNEXERCISED | the run FAILS naming the missing observer |
| bwrap can create a user/mount namespace AND this host can materialise the production mount list | the confined leg reports UNEXERCISED | the run FAILS naming the exact cause (no namespace privilege, or the host topology below) |

`OMP_NATIVE_ACCEPTANCE=1` is the ACCEPTANCE mode: it converts every unavailable
prerequisite into a failed test that names it, so a successful acceptance exit
means the native legs actually ran. Unset (ordinary `deno task test` / CI, which
ship no `omp`, `bwrap` or `strace`), an unavailable prerequisite leaves the leg
UNEXERCISED instead — never a mock substitute and never a native claim.

The confinement gate is the same one the existing real-bwrap IO controls use
(`tests/acp/sandbox-manager.test.ts`): `--ro-bind-try` tolerates a missing
source, but bwrap aborts the spawn when it cannot create the default read-only
bind destination `/usr/local/bin` — unspawnable wherever `/usr/local` is a
symlink into `/var` (Fedora Silverblue-style hosts). There is NO fallback to an
unconfined success.

### 6.3 Acceptance

```sh
omp --version   # must print the pin
OMP_NATIVE_ACCEPTANCE=1 deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi \
  tests/acp/omp-native-runtime-smoke.test.ts \
  tests/acp/filesystem-confinement.test.ts \
  tests/core/omp-pool-modes.test.ts
```

`omp --version` must report EXACTLY the `18.6.1` pin. A local binary reporting a
different version is a REPORTED MISMATCH: its results are labelled local-version
evidence and are never claimed as certification of the pinned image runtime.

The companion model-driven suite drives the same pinned binary against a
loopback OpenAI-compatible scripted provider to observe REAL native tool
dispatch (read/URL/skill, local search, todo, `web_search` registration,
ordinary `edit`/`write`, the shared command/destructive denials and the
default-denied unknown tool):

```sh
OMP_NATIVE_ACCEPTANCE=1 deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi \
  tests/integration/omp-native-runtime/native-runtime.integration.test.ts
```

The confined half requires the supported runtime: it was exercised in the
project container (real `/usr/local`, `bwrap`, `strace`, `dumb-init` and the
pinned binary present), where the probe ran confined restricted and native-YOLO
pool consumers, the mount controls above and the same-mode reload alongside the
two sibling suites.

To reproduce that evidence, run the same command with the checkout mounted in a
runtime that ships `bwrap`, `strace`, `dumb-init` and the pinned `omp`, exposes
`/usr/local` as a real directory, and provides the unprivileged user/mount
namespace privilege (`podman run --privileged` was used, with the checkout's
`agent-config/omp/*.yml` and generated `build/omp-extension/index.js` bound over
their `/opt/air/omp/**` image copies so the run consumes THIS checkout's
authored assets). On the host itself only the unconfined evidence is produced.

### 6.4 What this still does not claim

- Init/catalog/load/restore proves those mechanisms only. Native
  capability-handler execution stays the scripted native-dispatch change's
  evidence, and no readiness signal is inferred from a successful handshake.
- No public provider, proxy, platform, architecture or paid-model claim follows:
  the fixture `baseUrl` is a loopback address this probe never binds, and no
  prompt is ever sent.
- Public web-search backend success, proxy-mediated egress, platform delivery
  and the non-local architecture are NOT exercised: no credential, network
  path, platform service or second architecture is bound, and none of them is
  inferred from environment variables, mocks or a local build.
- The probe adds no production behavior, no configuration generator and no
  runtime mount; it consumes the shipped launch, mount and connector contracts
  unchanged.

---

## 7. Consumer Acceptance Record — `document-omp-parity-and-consumer-regressions`

This is the exercised evidence for the final consumer non-regression unit. It is
a RECORD of what one host ran, with its limits stated, not a certification.

**Environment.** Checkout of
`feat/document-omp-parity-and-consumer-regressions`, Linux x86_64 (Fedora), Deno
2.x. The official pinned executable was obtained from the release the image
pins: `omp-linux-x64` from `v18.6.1`, SHA-256
`c92a6846d02984e84f07c6362d18add3783f528f494ffcf1e0f26e594f327463` (identical to
`OMP_SHA256_X64` in the Containerfile), reporting `omp/18.6.1`.

**Commands and results.**

```sh
deno task fmt:check && deno task lint && deno task check          # clean
deno task bundle:omp-extension                                     # bundled
PATH=<pinned 18.6.1>:$PATH deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi \
  tests/integration/omp-lifecycle tests/integration/omp-skill-handoff \
  tests/integration/omp-native-runtime tests/core/skills-root.test.ts \
  tests/core/skill-root-wiring.test.ts tests/core/omp-pool-modes.test.ts \
  tests/acp/client.test.ts tests/acp/filesystem-authorization.test.ts \
  tests/acp/filesystem-confinement.test.ts tests/acp/command-path-canonical.test.ts \
  tests/acp/skill-inventory.test.ts tests/dashboard/server.test.ts \
  tests/utils/config-trio-sync.test.ts
# → ok | 401 passed (272 steps) | 0 failed (12s)
PATH=<pinned 18.6.1>:$PATH OMP_NATIVE_ACCEPTANCE=1 deno test … \
  tests/integration/omp-native-runtime/native-runtime.integration.test.ts
# → ok | 3 passed | 0 failed; restricted leg ran all 20 scripted steps,
#   native-YOLO leg all 7, real native dispatch against the loopback provider
#   (the restricted plan is 21 steps including the external-directory read below)
```

**Write observation (mutation events).** `strace` is not available on this host,
so the design's permitted equivalent filesystem watcher was used instead: an
inotify (`Deno.watchFs`) observer on the AUTHORED production paths
(`agent-config/omp/{restricted,native-yolo,models}.yml` and the inherited HOME's
`.omp/agent/models.yml`), with a positive control proving the watcher observed a
known mutation, running across the extension bundle build AND a real
`createAgentConfig` → `AgentConnector` → native `omp acp` start. Result: ZERO
create/modify/remove/rename MUTATION events on any authored configuration path —
the run establishes mutation-event absence on those paths (the hand-authored
native YAML is consumed, never synthesised or rewritten). The observer was
transient (not added to the repository).

**Writable-open FLAG classification: UNEXERCISED here.** `Deno.watchFs` reports
create/modify/remove/rename events, so this observer cannot separate a writable
open from a read-only open, nor classify a replacement event — the design's
decision-5 observation contract needs a flag-aware syscall observer. The command
that would produce it is:

```sh
OMP_NATIVE_ACCEPTANCE=1 deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi \
  tests/acp/omp-native-runtime-smoke.test.ts
```

run under
`strace -f -y -e trace=openat,openat2,creat,rename,renameat,renameat2,unlink,unlinkat`
in a runtime that ships `strace` and satisfies the §6.2 confinement
prerequisites.

**Evidence splits.** Real components: the orchestration/Skill API/handler/script
chain, the shared ACP policy modules, the official `omp` executable and its
native tool dispatch. Mocked/scripted: the model (a loopback OpenAI-compatible
scripted provider; no paid or public model call), the ACP subprocess in the
consumer suites, and the platform adapters. The native legs require the
documented `ClientConfig.nativeCalls` seam because this host exposes no owned
Debian libc at the path the production backend loads
(`/lib/x86_64-linux-gnu/libc.so.6`); real authorization and access-admission run
on real paths, but no `libc`/`openat2` claim follows from these legs.

**External-directory read route (captured, not asserted as policy).** The
restricted leg provisions a harmless OS-readable file in its own temporary
directory OUTSIDE every authorized root (workspace, staging, shared agent
workspace, trusted skills) and issues an ordinary native `read` for it. Observed
on this host: the native read calls the ACP `fs/read_text_file` callback, the
client refuses it with the bounded
`Filesystem request denied: rejected_filesystem_path_unavailable`, and the native
read tool still returns the file's own bytes through its own disk read. That is
the documented ambient-native read boundary: the route is RECORDED, the result
is differentiated from mock/model/image evidence, and no read policy is widened
or asserted. The same file's sentinel is reused by the shared-policy-denied
`bash` command, whose recorded `reject_once` decision is followed by an
assertion that the sentinel never appears in its output.

**Explicitly unexercised here.** The `strace`-based probe leg in
`tests/acp/omp-native-runtime-smoke.test.ts` and its confined pooled consumers
(no `strace`; this host cannot materialise the production confinement mount list
because `/usr/local` is a symlink into `/var`); the image build and its
installed-runtime scenario (no image build was run); proxy-mediated egress,
public-search backend success (the pinned binary's own keyless backend did reply
here, and that provider result is recorded, never asserted as a live-search
contract), platform delivery, and the non-local architecture.
