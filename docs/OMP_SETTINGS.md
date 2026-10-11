# OMP Owned Settings Translation & Integration Guide

This document describes the translation of AIr-Friends / OpenCode settings into deployment-owned configuration for the Oh-My-Pi (OMP) coding agent, pinned to official upstream `v18.6.1` / commit `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`.

---

## 1. OpenCode to OMP Configuration Translation

| Subsystem / Concern            | OpenCode Equivalent (`agent-config/opencode.json`)                       | OMP Pinned Mapping / Key                                                                                                           | Native Behavioral Differences & Notes                                                                                                                                                                                                                                                                                                                                                                         |
| :----------------------------- | :----------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Approval Mode (Restricted)** | `permission: { "*": "deny", ... }`                                       | `tools.approvalMode: write` (`agent-config/omp/restricted.yml`)                                                                    | Explicit non-YOLO native mode. Auto-approves `read` tier actions; `write` and `exec` tier calls (e.g. bash, destructive edits) remain gated by ACP client permissions.                                                                                                                                                                                                                                        |
| **Approval Mode (YOLO)**       | `permission: { "*": "allow" }`                                           | `tools.approvalMode: yolo` (`agent-config/omp/native-yolo.yml`)                                                                    | Maximally permissive native mode; auto-approves `read`, `write`, and `exec` tier actions, skipping ordinary tier-based prompts. No restricted clamps cross into YOLO.                                                                                                                                                                                                                                         |
| **LSP Integration**            | `permission: { lsp: "deny" }` (build **and** yolo, explicit per-agent)   | `lsp.enabled: false` in BOTH overlays (restricted since row 8; native-YOLO pinned by row 25) + `--no-lsp` (both modes, LSP row 17) | Decision 5 all-off: both OMP modes carry `--no-lsp` AND both mode documents pin the shared deployment disable (row 25 `pin-omp-yolo-lsp-settings` landed the native-YOLO pin; the redundant deployment pin never becomes a restricted YOLO tool policy). Wiring only — neither native server suppression nor implicit-startup suppression is proven; see `docs/AGENT_PERMISSIONS.md` (LSP Disabled: All-Off). |
| **Auto-Update & Channel**      | `autoupdate: false`                                                      | `startup.checkUpdate: false`<br>`marketplace.autoUpdate: off`<br>`update.channel: stable`                                          | Disables automated startup update checks and marketplace auto-updates, pinning update channel to `stable`. Pinned schema has no whole-updater kill switch; binary replacement via explicit `omp update` remains a deliberate deployment action.                                                                                                                                                               |
| **Conversation Compaction**    | `compaction: { auto: true, prune: true }`                                | `compaction.enabled: true`                                                                                                         | Pinned native strategy uses `methodOrder` (remote, snapcompact, handoff, shake, soft) and token thresholds. OpenCode's `prune` parameter has **no native equivalent** in OMP. No prune key is invented.                                                                                                                                                                                                       |
| **System Prompt Override**     | `prompt: "{file:/app/prompts/system_prompt_override.md}"`                | `--system-prompt <path>` CLI argument & `<agent dir>/SYSTEM.md`                                                                    | Maps override file to the official custom-prompt route (`docs/system-prompt-customization.md`). Retains generated context, skills, rules, and footer, but replaces the default instruction block (removing default tool-policy guidance). Runtime application is a P0 user-verified checklist item.                                                                                                           |
| **Legacy Payload Mounts**      | `prompts/system_self_research.md`, `system_spontaneous.md`, etc.         | None (consumed directly by AIr-Friends pipeline)                                                                                   | Per-file prompt mounts consumed by the AIr-Friends orchestrator need no agent-settings translation.                                                                                                                                                                                                                                                                                                           |
| **Gemini Provider**            | `provider.gemini` (`GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`)     | Provider ID `google` (`GEMINI_API_KEY` only)                                                                                       | Pinned OMP names the Gemini backend `google`. `GOOGLE_GENERATIVE_AI_API_KEY` is never passed to OMP processes (enforced by row 7).                                                                                                                                                                                                                                                                            |
| **OpenRouter Provider**        | `provider.openrouter` (`OPENROUTER_API_KEY`)                             | Provider ID `openrouter` (`OPENROUTER_API_KEY`)                                                                                    | Reuses the existing credential variable. No new credentials or profile variables are introduced.                                                                                                                                                                                                                                                                                                              |
| **Application Title**          | `headers: { "X-Title": "AIr-Friends" }`                                  | `providers.openrouter.headers: { X-Title: AIr-Friends }` (`agent-config/omp/models.yml`)                                           | Custom provider headers in `models.yml` are preserved on OpenRouter requests (`packages/ai/src/providers/openai-shared.ts:228`).                                                                                                                                                                                                                                                                              |
| **HTTP-Referer Attribution**   | `headers: { "HTTP-Referer": "https://github.com/jim60105/AIr-Friends" }` | **Not preservable** through supported configuration                                                                                | Pinned OMP hard-codes `HTTP-Referer: https://omp.sh/` and `X-OpenRouter-Title: omp` via `getOpenRouterHeaders()` in `packages/ai/src/utils/openrouter-headers.ts`, which overrides model/config headers in `openai-shared.ts:229-231`.                                                                                                                                                                        |
| **Disabled Providers**         | N/A (OpenCode uses explicit provider list)                               | `disabledProviders: [...]` (`agent-config/omp/restricted.yml`)                                                                     | Complete replacement array disabling all 81 catalog and hosted provider backends outside approved set (`google`, `openrouter`).                                                                                                                                                                                                                                                                               |

---

## 2. Authoritative Record-Reset Application Gate

The authoritative record-reset strategy (`reset-then-mode-null`) evaluated in P0 remains an **unresolved application gate**.

### Upstream Merge Behavior

In official OMP `v18.6.1` (`packages/coding-agent/src/config/settings.ts`):

1. `#readConfigOverlays` folds all CLI overlay files into a single aggregated mapping before layer merge.
2. `#mergeOwnLayers` deep-merges the aggregated overlay on top of global and project configuration using `#deepMerge`.
3. `#deepMerge` retains base-only entries, and configured whole-setting `null` counts as unset during settings resolution.

### Security Consequence

If a lower configuration layer (such as a project `.omp/config.yml` or global settings) contains tool approval grants (`allow`) or prompt/deny entries:

- In **restricted mode**: lower-layer grants (e.g. `unknown_tool: allow`) **survive** through the CLI overlay merge into the effective process configuration.
- In **YOLO mode**: lower-layer prompts or denials **survive**, violating the intended permissive posture.

Because overlay ordering cannot clear base-only entries:

- **No working settings-layer reset is fabricated or certified.**
- The **restricted execution-time default-deny policy (row 14)** is the operative security boundary holding containment while this gate stands.
- **Decision 3 disposition (DECIDED 2026-10-09, `isolate-omp-settings-discovery` row 26):** admission no longer waits on a supported-native-reset verdict or a separate user decision — control moved to the settings **discovery paths** instead of the merge behavior (section 6). The pinned verdict above stays `unresolved` verbatim: the binary still provides no deep-merge reset barrier, and nothing here claims it does. Restricted execution-time default-deny remains the second boundary. The machine-readable disposition rides `recordResetGate.applicationDisposition` in `src/acp/omp-settings.ts`.

---

## 3. Hostile Layer Neutralization & Precedence Contracts

Precedence in OMP follows: `defaults < global config.yml < project .omp/config.yml < --config overlays < runtime env`.

To prevent hostile or accidental workspace/global configuration from loosening security pins, the spawn layer (row 9) and packaging layer (row 20) must enforce the following contracts:

1. **Deployment-owned launch working directory**: Pinned OMP discovers project settings strictly within `<cwd>/.omp/`. Launching from a deployment-controlled working directory prevents workspace `.omp/config.yml` files from entering the merge.
2. **Empty deployment-owned agent directory**: `PI_CODING_AGENT_DIR` must point to an empty directory under the process state root, preventing hostile global configuration inheritance.
3. **Protected overlay asset storage**: Owned overlays and `models.yml` must reside in locations outside agent-writable directories.
4. **Environment isolation**: Child processes must never inherit `OMP_PROFILE`, `PI_PROFILE`, `PI_CONFIG_FILES`, or `XDG_CONFIG_HOME`.
5. **Overlay ordering**: When invoking OMP with multiple `--config` arguments, the mode document (`restricted.yml` or `native-yolo.yml`) must be placed **last** among deployment overlays.

---

## 4. Zero Configuration Drift Confirmation

This change introduces **no new configuration fields**, **no new environment variables**, and **no new Helm chart values**:

- Owned assets follow the deployment-owned file pattern established by `agent-config/opencode.json`.
- Provider credentials reuse the existing `GEMINI_API_KEY` and `OPENROUTER_API_KEY` handled by row 7.
- `config.example.yaml`, `.env.example`, and `helm/values.yaml` remain unmodified.

---

## 5. Non-Goals and Downstream Ownership

The following areas are explicitly out of scope for this change and belong to downstream rows:

- **Row 9 (`spawn-mode-scoped-omp-agents`)**: Subprocess launch arguments, `--config` interleaving, `--system-prompt` flag passing, `PI_CODING_AGENT_DIR` assignment, and process working directory setup.
- **Row 10 (`isolate-omp-process-pools-by-mode`)**: Pool separation and mode-distinct state roots.
- **Row 14 (`define-omp-restricted-tool-decisions` / `wire-omp-restricted-tool-enforcement`)**: Runtime tool inventory, execution-time default-deny policy, and per-tool `tools.approval` records.
- **LSP row 17 (`disable-restricted-agent-lsp`)**: both-mode `--no-lsp` carriers and per-agent OpenCode LSP denial (wiring only; native cold-start proof remains user runtime-observed). Row 25 (`pin-omp-yolo-lsp-settings`) landed the mandatory native-YOLO `lsp.enabled: false` settings pin: `lsp.enabled` is a shared deployment key required boolean-false in both mode documents.
- **Row 20 (`package-pinned-omp-runtime`)**: Checksum validation and packaging of `agent-config/omp/*` assets outside agent-writable roots.

> Runtime verification for this area is consolidated in the single checklist artifact [USER-RUNTIME-VERIFICATION.md](USER-RUNTIME-VERIFICATION.md) (section D: LSP off in OMP restricted+YOLO and OpenCode build+yolo; implicit-startup suppression unverified).

---

## 6. Owned-Only Settings Discovery (row 26 `isolate-omp-settings-discovery`)

Decision 3 is applied as **settings-discovery-path control**: rather than trusting the (unresolvable) native merge reset, the deployment guarantees that NO hostile lower layer exists to inherit from in the first place.

### Source plan and inventory

`ompSettingsSourcePlan` (`src/acp/omp-settings.ts`) is the typed, deployment-owned plan composed per launch over the canonical row-9/10 mode roots: owned HOME (`{baseRoot}/omp-agent/{mode}/home`), agent dir, neutral launch cwd, XDG data home, process tmp, and the exact resolved owned `--config` overlay paths (mode document last). `PINNED_FORBIDDEN_SETTINGS_SOURCES` is a bounded path table traced at the pinned revision — native global (`config.yml`, compat `config.yaml`, legacy `settings.json`), native project (`.omp/config.yml`, `.omp/settings.json`), and the foreign-provider discovery providers (claude/codex/cursor/gemini/opencode user + project files), each row citing its `discovery/*.ts loadSettings` source symbol. It is an enumerated inventory, never a general filesystem scan, and invents no disable key.

### Mandatory environment control

Every OMP child has `HOME`, all XDG selectors, `OMP_PROFILE`, `PI_PROFILE`, `PI_CONFIG_FILES`, `PI_CODING_AGENT_DIR` and the foreign provider selectors (`CLAUDE_CONFIG_DIR`, `CURSOR_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CONFIG_DIR`) removed unconditionally — regardless of `filterEnv`/`allowedEnvVars`, sandboxed or not (`sanitizeOmpDiscoveryEnv`, `src/acp/sandbox-manager.ts`) — after which `finalizeOmpSpawnEnvironment` assigns ONLY the exact plan values (`HOME` = owned HOME — an unset HOME could let the native homedir fallback return the daemon home) and fails closed if any other forbidden selector survived. The bootstrap `omp --version` observability probe spawns with an explicitly sanitized environment copy too, so it never inherits the daemon's discovery selectors. OpenCode's HOME/XDG semantics never consult this machinery.

### Pre-native-request observer

`src/acp/omp/settings-sources.ts` is a metadata-only observer (lstat/realpath; never reads content, never writes, never deletes or migrates a user file). Before every spawn and before every native session `new`/`load`/recovery it verifies: authority roots exist, are directories, and are link-free; every pinned forbidden source is ABSENT at its anchors (global under owned HOME/agent dir, project at the ACTUAL session cwd and neutral launch cwd, foreign-project across a bounded ancestor walk — the pinned `getProjectPath` itself is cwd-only; the ancestor walk is this deployment's stricter posture); owned overlays are plain files outside the agent-writable roots whose size/mtime identity stays stable across rechecks (same-path replacement fails closed). Unexpected presence, links, unreadable metadata, or missing authority fail closed with a bounded, content-free `SettingsSourceRejectionError`; nothing is created on the user's behalf.

### Responsibility and limits (user-owned / unverified)

- **Sustained absence is a deployment-control responsibility**: the preflight is a per-request snapshot decision, not a race-free watcher. Undetectable mid-process mutation of a host file, and native autonomous settings reload semantics, remain user-owned runtime evidence (USER-RUNTIME-VERIFICATION.md section J).
- **Operator-visible rejections carry their own reason**: a spawn/new/load/recovery refusal surfaces as a bounded `SettingsSourceRejectionError` (or the `settings_sources_rejected` recovery-abort reason pooled-side), never relabeled as a timeout — cleaning the named path is the remedy.
- **Ancestor strictness is a deployment posture**: foreign-project files at ANY ancestor of the session cwd reject, so a developer host whose home directory (1–3 levels above a workspace) holds personal `.claude`/`.codex`/etc. config will see OMP launches refused there; the containerized deployment layout keeps ancestors clean. This stricter-than-native posture is deliberate — relaxing it is a user decision, not a fallback.
- **No mock or unit result clears the reset gate**: `recordResetGate` stays `unresolved`; the unit/mock suite certifies deployment-side control logic only.
- **Zero configuration drift**: this change adds no new config fields, environment variables, or Helm values; the plan is internal composition over existing roots.
- **Sandbox filesystem confinement (`sandbox.filesystemConfinement`) is not compatible with OMP launches**: its bind set predates this change and does not expose the plan roots (`ownedHome`/agent dir/launch cwd/overlays); enabling it for `agentType: omp` fails at exec, not at the preflight (the observer checks daemon-side paths). The shipped default is off; binding the plan roots is future work, not a claim made here.
- **Row 27 handoff**: the source plan rides `AgentConfig.settingsSourcePlan`; the pre-native-check seam is `AgentConnector.verifyOmpSettingsSourcesBeforeRequest` (connect / createSession / reconnect-and-resume), with accepted overlay identities spanning rechecks.
