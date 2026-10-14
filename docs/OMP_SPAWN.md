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

Unlike OpenCode (which uses ACP `setSessionMode()` to toggle into `"yolo"` mode on an existing process), OMP never supports mixed-mode process reuse. Consequently:

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

1. P0 compatibility contracts ([docs/OMP_COMPATIBILITY.md](OMP_COMPATIBILITY.md)):
   every recorded `incompatible`/`unresolved` boundary verdict stands verbatim
   beside its DECIDED disposition. Nothing here reopens or re-litigates them,
   and no change in the OMP batch waits on an unmet prerequisite.
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
