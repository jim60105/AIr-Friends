# OMP Spawn-Mode-Scoped Agent Integration

This document defines the launch argument assembly, mode resolution, process state partitioning, and sandbox pass-through contracts for Oh-My-Pi (OMP) agents within AIr-Friends.

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

---

## 2. Launch Argument Assembly

Arguments are deterministically assembled from the owned-settings composition provided by `ompSettingsForMode(mode)` (`src/acp/omp-settings.ts`):

### Restricted Launch

- Subcommand: `acp`
- Base flags: `--no-extensions --no-lsp` (LSP disabled in every mode, decision 5 / row 17)
- Overlay configuration: `--config` flags for the generated skill-root declaration FIRST (a single-key document holding the deployment-resolved root) followed by the authored mode document `restricted.yml` LAST (`align-omp-skill-trust-to-shared-root`: a rewritten declaration can then never out-rank the authored pins).
- Trusted extension: `--trusted-extension <selected generated artifact>` — the launch assembly
  (`selectLaunchDeploymentModule()`, `src/acp/omp/deployment-module.ts`) consumes the resolver
  output VERBATIM: the image face `/opt/air/omp/extension/index.js` when that installed artifact
  exists, otherwise the deterministic GENERATED development entry
  `build/omp-extension/index.js` (repository-relative; the checkout's own bundling contract). The
  canonical source `src/acp/omp/extension/index.ts` (`OMP_TRUSTED_EXTENSION_PATH`) is the
  bundler INPUT and never a launch target, and an absent generated artifact fails the launch
  preflight naming the `deno task bundle:omp-extension` remedy.
- System prompt override: `--system-prompt /app/prompts/system_prompt_override.md`.
- **Invariant**: No `--yolo` or auto-approval CLI flags appear in restricted mode. Non-YOLO approval is pinned in `restricted.yml` (`tools.approvalMode: write`).

### Native-YOLO Launch

- Subcommand: `acp`
- Base flags: `--no-extensions --no-lsp` (LSP disabled in every mode, decision 5 / row 17)
- Overlay configuration: `--config` flags for the generated skill-root declaration FIRST followed by `native-yolo.yml` LAST (`tools.approvalMode: yolo`).
- Trusted extension: the SAME selected generated artifact as the restricted launch (the flag sits
  in the common argument assembly). The exemption is structural at the registration site — a
  native-YOLO process registers no restricted handler and no replacement tool.
- Disjointness check: Assembly asserts at runtime that no restricted overlay appears in a native-yolo launch.

---

## 3. Mode-Distinct Process State & Isolation

To ensure complete isolation between permission modes:

1. `PI_CODING_AGENT_DIR` is set to `{baseRoot}/omp-agent/{mode}`, preventing restricted and native-yolo processes from sharing mutable internal state.
2. `TMPDIR` is partitioned to `{baseRoot}/omp-agent/{mode}/tmp`.
3. Working directory (`cwd`) is set to `{baseRoot}/omp-agent/{mode}/cwd`, a deployment-controlled neutral directory with an empty `.omp/` layer. This completely prevents hostile project configuration inheritance from untrusted workspaces.
4. `XDG_DATA_HOME` is scoped under `{baseRoot}/omp-agent/{mode}/xdg-data`.
5. Canonical payload staging remains `{workspace}/tmp/{sessionId}`, independent of OMP internal state partitioning.
6. Row 26 (`isolate-omp-settings-discovery`): `HOME` is EXPLICITLY assigned to the deployment-owned `{baseRoot}/omp-agent/{mode}/home` (never inherited, never unset — the native homedir fallback must not reach the daemon home). Every settings-discovery selector (`HOME`, all XDG selectors, `OMP_PROFILE`, `PI_PROFILE`, `PI_CONFIG_FILES`, `PI_CODING_AGENT_DIR`) and every foreign provider config selector is mandatorily stripped from the OMP child regardless of `filterEnv`/`allowedEnvVars`; only the exact plan values are re-assigned afterwards (`sanitizeOmpDiscoveryEnv` then `finalizeOmpSpawnEnvironment` in `src/acp/agent-factory.ts`). The typed source plan rides `AgentConfig.settingsSourcePlan`.
7. `align-omp-skill-trust-to-shared-root` (`OMP_DECLARED_SKILL_ROOT`): the plan's RESOLVED skill root (`agent.skillsDir`, the ONE root both agent types resolve) is stripped like every other selector and then assigned and verified by `finalizeOmpSpawnEnvironment` on BOTH spawn routes. The trusted extension loaded in this child reads that value as its only witness of the declared root and verifies it is one absolute, existing, non-link directory; an absent or unacceptable value denies with zero skill authority and no workspace/HOME/cwd fallback. The skill-root declaration file itself is generated at launch at `{baseRoot}/omp-overlays/{mode}-skill-root.yml` and passed as the FIRST `--config` overlay — `{baseRoot}` being the mode's own base root (the pooled `{dataRoot}/omp-pools/{key}`, or the per-spawn session `{workspace}/tmp`), so the declaration is the ONE overlay the daemon must write at launch time; it is rewritten on every launch and its accepted `(dev, ino, ctime, size, mtime)` identity is captured after that write, so a later rewrite is refused.

### Settings-source lifecycle order (row 26)

The metadata-only settings-source observer (`src/acp/omp/settings-sources.ts`) is a RETAINED mechanism with no daemon-side per-request invocation since `simplify-omp-session-boundaries`: `AgentConnector` no longer calls it before the subprocess spawn in `connect()`, before native `session/new` in `createSession()`, or before teardown/respawn/`session/load` in `reconnectAndResumeSession()`, and it keeps no accepted-overlay identity baseline. The observer remains metadata-only for the generated skill-root declaration: that path is exempt from the agent-writable placement rule (the daemon must be writable to it at launch time) and is otherwise checked exactly like any other overlay (link, regular file, canonical parent, accepted `(dev, ino, ctime, size, mtime)` identity), so a post-launch rewrite is revealed by the accepted identity — restoring the modification time does not reproduce it; the declaration's CONTENT is validated by the launch assembly against the resolved root instead. Where it still gates a launch, a rejection (`SettingsSourceRejectionError`) performs no spawn, no session request, and no mutation of user files. See `docs/OMP_SETTINGS.md` section 6.

### Executable-source lifecycle order (row 27)

The metadata-only executable-source check (`src/acp/omp/executable-sources.ts`) no longer rides any connector lifecycle seam since `simplify-omp-session-boundaries`: the daemon has no pre-native-request invocation before spawn, `session/new` or recovery pre-teardown, so a found entry has no daemon-side rejection or recovery-abort reason of its own. The check observes the workspace's executable discovery shapes — `.omp/tools`/`tools` plus the foreign-provider `.claude/tools` project route (recursive, bounded), `.omp/plugins`/`plugins`, linked dependencies (`file:`/`link:`/`workspace:` specifiers and symlinked `node_modules` entries incl. `@scope`), the owned global routes under the plan's HOME/agent dir (custom-tool routes AND plugin routes — anything present fails closed; the owned roots themselves must be absolute, existing, non-link directories, never an empty-route interpolation), and configured module selectors in the observed child env — and NEVER executes, imports, or content-reads anything (lstat/realpath metadata plus bounded `package.json` entry declarations; no execute-bit logic: importable suffixes reject regardless of mode bits). The default metadata backend dispatches over the host runtime globals (a host `require` of `node:fs` first, the Deno sync namespace as fallback — no new static external enters the `@std/*`-only closure boundary; a host with neither fails every observation closed). A found entry, symlink, broken link, unknown shape, IO failure, or missing workspace authority throws a bounded, content-free `ExecutableSourceRejectionError` (≤8 named issues). Every observation binds the canonical workspace identity + resource generation, so a previous clean result is never reused as admission for a replaced workspace or a newly-grown entry. Its production consumer is the extension-load STARTUP CHECK: inside the extension itself (`--no-extensions`, image path only), the check runs as a restricted-identity-only STARTUP CHECK at trusted-module load (`extension/bootstrap.ts`) — a found executable module throws the load fail-closed before any decision returns, while a clean observation supplies the DECIDED decision-1 admission to the discovery guard (see `docs/OMP_DISCOVERY.md`). A development-tree/unidentified load takes NO observation and keeps the pinned fail-closed pre-import blockers verbatim — the startup check is production-only like the row-16 registration branch.

---

## 4. Inherited Verdicts, Landed Integration and Evidence Limits

Unit and mock tests in AIr-Friends verify configuration assembly and argument construction
decisions only. The pinned upstream verdicts below are INHERITED, not reopened, and the seams they
name are carried by their DECIDED dispositions and landed integrations — no change in the OMP
batch waits on an unmet prerequisite:

1. P0 compatibility contracts (`docs/OMP_COMPATIBILITY.md`): every `incompatible`/`unresolved`
   boundary verdict stands verbatim beside its DECIDED (2026-10-09) disposition. P0's
   application-halt ruling is superseded by §1a, so nothing here is application-blocked.
2. Row 8 authoritative record-reset gate (`docs/OMP_SETTINGS.md`) — the pinned `unresolved` merge
   verdict stands verbatim. Decision 3's application did not wait on it or on a separate user
   decision: it is DECIDED via settings-discovery-path control (row 26, `docs/OMP_SETTINGS.md`
   sections 2 and 6), with restricted execution-time default-deny as the second boundary.
3. Packaging and binary installation (row 20): landed — the root-owned `/opt/air/omp` tree plus
   the pinned `omp` v18.6.1 install. Official-runtime behavior (the native extension load and
   image acceptance) remains user-owned and UNVERIFIED (`docs/USER-RUNTIME-VERIFICATION.md`).
