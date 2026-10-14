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

### Owned native local read/search posture (row 29 `admit-trusted-omp-native-builtins`)

`agent-config/omp/restricted.yml` (and the byte-equal `RESTRICTED_YAML_CONTENT`)
carry, in addition to `tools.approvalMode: write`:

| Key                              | Pinned value                                                            | Source-backed meaning                                                                                                                                                                                                                                                                                                                                                 |
| :------------------------------- | :---------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools.approval`                 | `{read: allow, grep: allow, glob: allow, find: allow}`                  | `tools/settings.ts` `cfgToolsApproval` record (per-tool `allow`/`prompt`/`deny`, honored in every approval mode). Exact-name `allow` for the native read/search builtins the restricted inventory admits, so approved read-tier calls need no human elicitation. It is an approval POSTURE: provenance still denies SDK/foreign same-name calls before native approval.   |
| `grep.enabled` / `glob.enabled`  | `true` / `true`                                                         | `cfgGrepEnabled`/`cfgGlobEnabled` booleans: the native builtin search tools stay available under the supported activation control.                                                                                                                                                                                                                                    |
| `find.enabled`                   | `auto`                                                                  | `cfgFindEnabled` enum pinned VERBATIM so availability stays judge/model-dependent: `auto` resolves only when the judge role is backed by a native TypeSafe model AND a model registry exists. No judge, model or backend is added to force it on.                                                                                                                      |
| `fetch.enabled`                  | `false` (restricted-only)                                               | `cfgFetchEnabled`, consumed by `fetch.ts` `materializeReadUrlToFile`: native URL materialization (including native `grep` URL roots) throws before any fetch. The registered owned `read` replacement performs its OWN controlled per-hop transport and never consults this key, so controlled URL reading stays available — and a disabled key is NOT a complete URI-route block (the decoder's root screen is). |

Validation: `assertOwnedSettingsDocument` checks this key surface through a
CLOSED entry-name set plus the pinned value vocabulary (unknown tool name,
unknown value, a `null` reset and an empty branch all reject), requires these
exact values in restricted mode, keeps `tools.approvalMode: write`, and rejects
both new restricted-only keys in the native-YOLO document — whose bytes are
unchanged.

What this is NOT: there is no `allowedPaths`-style path ACL, no exclusion list,
and no per-user path-confinement claim in the pinned schema. cwd, `.gitignore`,
hidden-file filtering, candidate credential/binary filtering and output limits
are BEHAVIOR controls, not a filesystem boundary: native local read/search runs
under the process's ambient OS permissions (see `OMP_ENFORCEMENT.md`,
"Accepted native local posture").

---

## 2. Authoritative Record-Reset Application Gate

The authoritative record-reset strategy (`reset-then-mode-null`) evaluated in P0 remains an **unresolved application gate**.

### Upstream Merge Behavior

In official OMP `v18.6.1` (`packages/coding-agent/src/config/settings.ts`):

1. `#readConfigOverlays` folds all CLI overlay files into a single aggregated mapping before layer merge.
2. `#mergeOwnLayers` deep-merges the aggregated overlay on top of global and project configuration using `#deepMerge`.
3. `#deepMerge` retains base-only entries, and configured whole-setting `null` counts as unset during settings resolution.

The deployment relies on exactly that fold for its skill directory
(`align-omp-skill-trust-to-shared-root` D3): the launch passes TWO overlays —
the generated single-key skill-root declaration FIRST
(`skills.customDirectories` holding the deployment-resolved root) and the
authored mode document LAST (enablement, the seven foreign-source toggles, the
approval/LSP/update pins, declaring NO skill directory). The fold therefore
takes the directory from the declaration and every other pin from the authored
document, and because the authored document is last a rewritten declaration can
never out-rank a pin. The declaration is rewritten at every launch
(symlink-refusing, unconditional overwrite) and its parsed content is validated
against the daemon's own resolved root before the process starts.

### Security Consequence

If a lower configuration layer (such as a project `.omp/config.yml` or global settings) contains tool approval grants (`allow`) or prompt/deny entries:

- In **restricted mode**: lower-layer grants (e.g. `unknown_tool: allow`) **survive** through the CLI overlay merge into the effective process configuration.
- In **YOLO mode**: lower-layer prompts or denials **survive**, violating the intended permissive posture.

Because overlay ordering cannot clear base-only entries:

- **No working settings-layer reset is fabricated or certified.**
- The **restricted execution-time default-deny policy (row 14)** is the operative security boundary holding containment while this gate stands.
- **Decision 3 disposition (DECIDED 2026-10-09, `isolate-omp-settings-discovery` row 26):** admission no longer waits on a supported-native-reset verdict or a separate user decision — control moved to the settings **discovery paths** instead of the merge behavior (section 6). The pinned verdict above stays `unresolved` verbatim: the binary still provides no deep-merge reset barrier, and nothing here claims it does. Restricted execution-time default-deny remains the second boundary. The machine-readable disposition rides `recordResetGate.applicationDisposition` in `src/acp/omp-settings.ts`.

- **An owned approval record is a posture, never a reset (row 29
  `admit-trusted-omp-native-builtins`):** the restricted overlay's exact
  `tools.approval` `allow` entries narrow the posture for their own names, but
  they cannot NULLIFY a lower-layer survivor (the merge preserves base-only
  keys), so a hostile/legacy lower layer stays the settings-discovery-path
  control's responsibility (section 6) — with the restricted execution-time
  default-deny decision denying any name the inventory does not carry. Nothing
  here claims the record performs a reset.

---

## 3. Hostile Layer Neutralization & Precedence Contracts

Precedence in OMP follows: `defaults < global config.yml < project .omp/config.yml < --config overlays < runtime env`.

To prevent hostile or accidental workspace/global configuration from loosening security pins, the spawn layer (row 9) and packaging layer (row 20) must enforce the following contracts:

1. **Deployment-owned launch working directory**: Pinned OMP discovers project settings strictly within `<cwd>/.omp/`. Launching from a deployment-controlled working directory prevents workspace `.omp/config.yml` files from entering the merge.
2. **Empty deployment-owned agent directory**: `PI_CODING_AGENT_DIR` must point to an empty directory under the process state root, preventing hostile global configuration inheritance.
3. **Protected overlay asset storage**: Authored overlays and `models.yml` must reside in locations outside agent-writable directories. The ONE exception is the generated skill-root declaration (`{baseRoot}/omp-overlays/{mode}-skill-root.yml`), which must be writable by the daemon at launch time; it is exempt from the placement rule alone and keeps every other overlay check (link, regular file, canonical parent and the accepted size/mtime identity that reveals a post-launch rewrite), plus its content is validated against the resolved root before the launch.
4. **Environment isolation**: Child processes must never inherit `OMP_PROFILE`, `PI_PROFILE`, `PI_CONFIG_FILES`, or `XDG_CONFIG_HOME`.
5. **Overlay ordering**: When invoking OMP with multiple `--config` arguments, the generated skill-root declaration is placed **first** and the mode document (`restricted.yml` or `native-yolo.yml`) **last** among deployment overlays.

---

## 4. Zero Configuration Drift Confirmation

This section's original change introduced **no new configuration fields**, **no new environment variables**, and **no new Helm chart values**; its successor `align-omp-skill-trust-to-shared-root` keeps that posture — it adds no operator-facing field, and the internal `OMP_DECLARED_SKILL_ROOT` conveyance is a deployment-owned launch value assigned from the source plan, never an operator surface (`config.example.yaml`, `.env.example` and `helm/values.yaml` stay unmodified):

- Owned assets follow the deployment-owned file pattern established by `agent-config/opencode.json`.
- Provider credentials reuse the existing `GEMINI_API_KEY` and `OPENROUTER_API_KEY` handled by row 7.
- `config.example.yaml`, `.env.example`, and `helm/values.yaml` remain unmodified.

---

## 5. Non-Goals and Downstream Ownership

The following areas are explicitly out of scope for this change and belong to downstream rows:

- **Row 9 (`spawn-mode-scoped-omp-agents`)**: Subprocess launch arguments, `--config` interleaving, `--system-prompt` flag passing, `PI_CODING_AGENT_DIR` assignment, and process working directory setup.
- **Row 10 (`isolate-omp-process-pools-by-mode`)**: Pool separation and mode-distinct state roots.
- **Row 14 (`define-omp-restricted-tool-decisions` / `wire-omp-restricted-tool-enforcement`)**: Runtime tool inventory, execution-time default-deny policy, and approval-record interpretation. The owned overlay's exact `tools.approval` entries and the native local search activation pins are row 29's surface (section 1a / `admit-trusted-omp-native-builtins`).
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

`align-omp-skill-trust-to-shared-root` adds exactly ONE deployment-owned
assignment to that set: `OMP_DECLARED_SKILL_ROOT` carries the plan's RESOLVED
skill root to the extension loaded in the child. Like every other selector it is
stripped from an inherited environment and then assigned and verified by
`finalizeOmpSpawnEnvironment` on both spawn routes, so the extension's only
witness of the declared root is a launch-environment value the child cannot
choose (an absent or unacceptable value denies with zero skill authority).

### Pre-native-request observer

`src/acp/omp/settings-sources.ts` is a metadata-only observer (lstat/realpath; never reads content, never writes, never deletes or migrates a user file). Before every spawn and before every native session `new`/`load`/recovery it verifies: authority roots exist, are directories, and are link-free; every pinned forbidden source is ABSENT at its anchors (global under owned HOME/agent dir, project at the ACTUAL session cwd and neutral launch cwd, foreign-project across a bounded ancestor walk — the pinned `getProjectPath` itself is cwd-only; the ancestor walk is this deployment's stricter posture); owned overlays are plain files outside the agent-writable roots whose size/mtime identity stays stable across rechecks (same-path replacement fails closed). Unexpected presence, links, unreadable metadata, or missing authority fail closed with a bounded, content-free `SettingsSourceRejectionError`; nothing is created on the user's behalf.

The generated skill-root declaration is observed as one more owned overlay, with
ONE named exemption and no content read: the declaration path is exempt from the
`plan.agentDir`/`plan.ownedHome` placement rule (it must be writable at launch
time), while the link, regular-file, canonical-parent and accepted
`(dev, ino, ctime, size, mtime)` identity checks apply to it unchanged — so a
post-launch rewrite of the declaration is revealed by that identity, exactly
like a replaced authored overlay: restoring the modification time (or the size)
does not reproduce the accepted inode identity, and an unavailable identity
metadata set is refused rather than trusted. Because the authored mode document
is passed LAST, such a rewrite can never out-rank the pins. The declaration's
CONTENT is validated at launch by the assembly (`assertOwnedSettingsDocument`
against the daemon's resolved root), never by this preflight.

### Responsibility and limits (user-owned / unverified)

- **Sustained absence is a deployment-control responsibility**: the preflight is a per-request snapshot decision, not a race-free watcher. Undetectable mid-process mutation of a host file, and native autonomous settings reload semantics, remain user-owned runtime evidence (USER-RUNTIME-VERIFICATION.md section J).
- **Operator-visible rejections carry their own reason**: a spawn/new/load/recovery refusal surfaces as a bounded `SettingsSourceRejectionError` (or the `settings_sources_rejected` recovery-abort reason pooled-side), never relabeled as a timeout — cleaning the named path is the remedy.
- **Ancestor strictness is a deployment posture**: foreign-project files at ANY ancestor of the session cwd reject, so a developer host whose home directory (1–3 levels above a workspace) holds personal `.claude`/`.codex`/etc. config will see OMP launches refused there; the containerized deployment layout keeps ancestors clean. This stricter-than-native posture is deliberate — relaxing it is a user decision, not a fallback.
- **No mock or unit result clears the reset gate**: `recordResetGate` stays `unresolved`; the unit/mock suite certifies deployment-side control logic only.
- **Zero configuration drift**: this change adds no new config fields, environment variables, or Helm values; the plan is internal composition over existing roots.
- **Sandbox filesystem confinement (`sandbox.filesystemConfinement`) is not compatible with OMP launches**: its bind set predates this change and does not expose the plan roots (`ownedHome`/agent dir/launch cwd/overlays); enabling it for `agentType: omp` fails at exec, not at the preflight (the observer checks daemon-side paths). The shipped default is off; binding the plan roots is future work, not a claim made here.
- **Row 27 handoff**: the source plan rides `AgentConfig.settingsSourcePlan`; the pre-native-check seam is `AgentConnector.verifyOmpSettingsSourcesBeforeRequest` (connect / createSession / reconnect-and-resume), with accepted overlay identities spanning rechecks.

## 7. Deployment-Owned Skill Roots (row 28 `pin-omp-owned-skill-roots`)

Decision 7 is applied as **skill-root ownership selection**: OMP skill discovery for the deployment comes exclusively from the settings-declared owned root, and every trusted-read selection decision consumes that declaration rather than a separately configurable root. Since `align-omp-skill-trust-to-shared-root` that declared root is the SAME deployment-resolved root every other agent type uses (`agent.skillsDir`) — there is no OMP-specific tree, constant or fallback — and admission is decided on canonical identity, link-free components and containment rather than on root ownership.

### Pinned skills block

The authored mode documents (`agent-config/omp/restricted.yml`, `agent-config/omp/native-yolo.yml`) and their composition constants carry `skills.enabled: true` and `enableCodexUser`/`enableClaudeUser`/`enableClaudeProject`/`enablePiUser`/`enablePiProject`/`enableAgentsUser`/`enableAgentsProject` all `false` — the seven foreign-source toggles switch OFF the compat/personal-tree discovery that would otherwise admit workspace-adjacent or home-directory skill candidates — and they declare NO skill directory. The DIRECTORY is carried by the generated declaration (`{baseRoot}/omp-overlays/{mode}-skill-root.yml`): a single-key document holding exactly the daemon's resolved root, written at every launch with a symlink-refusing unconditional overwrite and passed FIRST among the `--config` overlays with the authored mode document LAST.

`assertOwnedSettingsDocument` validates registered keys, types and these exact carrier semantics: the generated declaration must declare exactly the resolved root, an authored mode document must declare none (a drifted hard-coded directory rejects), both keep `skills.enabled: true` and the seven toggles `false`, and missing, wrongly typed or falling-back-to-default `skills` keys reject. The row-26 source plan carries `ownedSkillRoots: [<resolved root>]` plus the declaration path, so every parsed overlay — declaration and authored document alike — is validated against the root the daemon resolved, and the plan refuses any other value. That resolved root is the deployment's ordinary skill tree (`agent.skillsDir`; the container ships `AGENT_SKILLS_DIR=/home/deno/.agents/skills`) at the image's `$UID:0` `0775` posture: OMP admission no longer requires root ownership, agent-non-writability or non-group/world-writability. The separate OMP skill tree the earlier row-28 pin installed is gone: it is no longer declared or trusted by any OMP code path, and `collapse-skill-packaging-to-one-tree` removed it from the image, so this resolved root is the only skill tree that ships.

### Declaration-to-selection interface

`src/acp/omp/owned-skills.ts` (`observeOwnedSkills`) is the metadata-only producer bridging the declaration to selection: it lstats the declared root (canonical path, link-free components, real directory, `dev`/`ino` identity attestation; writability and ownership are deliberately NOT admission inputs), walks the `PINNED_CRITICAL_SKILLS` instruction layout (`review/SKILL.md`, `destructive/SKILL.md`, `lsp/SKILL.md`, `readiness/SKILL.md`), and mints `TrustedSkillsSource` with per-reference `sessionId`/`sessionGenerationId`/instruction-identity binding. The connector calls it in `setSessionGateContext` with the ACTUAL client's `nextRegistrationGeneration()`; the accepted observation becomes the baseline for replacement detection (a same-path root or instruction replacement throws or denies that identifier alone). An unobservable root without a baseline mints `null` — zero authority, fail closed; a non-authorizing (empty session/generation) observation is what the extension startup check uses. The client (`observeFilesystemRoots`) admits trusted reads only when `rootIdentity` is present and matches the currently canonicalized root, every reference is `deployment_owned`, pinned, session-matched, generation-current, and path-canonical; an unregistered name-only selector never authorizes anything. Workspace/provider/custom/managed skill candidates are excluded from OMP critical resolution before any collision or precedence decision, and ordinary (non-critical) owned skills plus global skill behavior are untouched.

The one place the ownership/mode observation survives is CRITICAL minting: the producer derives the root's own OBSERVED read-only fact and `evaluateCriticalSkillSelection` mints only when it is true — a writable tree therefore mints no critical authority (a planted pinned `*/SKILL.md` layout is refused) while ordinary skill admission never consults the flag. The read path (`read-replacement.ts`), the daemon's canonical-root observation (`filesystem-roots.ts`) and the inventory keep their identity, containment, link-free, `nlink === 1`, current-generation and writable-root-overlap requirements unchanged.

**The pinned instruction layout is currently unpopulated.** The deployment-resolved root (the repository `skills/` tree, installed as the stock image's `$UID:0` `0775` personal tree) contains none of the four pinned `*/SKILL.md` files, so every registration observably mints zero critical references — the safe fail-closed empty posture (no critical authority, no workspace fallback), never a silent fabrication. Because that shipped root is also agent-writable, the observed read-only carve-out above is what keeps a planted pinned layout authority-free; an operator who wants critical authority must supply a root whose observed ownership and mode are read-only. Unit/mock suites mint against synthetic pinned trees (a fixture `review/SKILL.md`), which prove the mechanism, not production content.

### Responsibility and limits (user-owned / unverified)

- **No new configuration surface**: no new config field, environment variable, or Helm value is introduced; the declared root is the deployment's existing `agent.skillsDir` / `AGENT_SKILLS_DIR` value (the ONE root both agent types resolve), and the internal `OMP_DECLARED_SKILL_ROOT` conveyance is a launch value assigned from the source plan, never an operator surface. Critical-id expansion stays pinned.
- **Native custom-directory semantics remain user-owned unverified**: whether the pinned OMP binary's `skills.customDirectories` consumption behaves as translated here is runtime evidence (USER-RUNTIME-VERIFICATION.md section B); nothing here claims native support beyond the translated settings shape.
- **Non-image hosts fail closed in the extension**: the in-child declaration check still consumes the installed `/opt/air/omp/config/{mode}.yml` document (there is no dev fallback for it), so a host without the owned tree mints zero skill authority there. Daemon-side callbacks use the resolved root instead, and an unobservable, linked, non-canonical or replaced root mints `null` — no fallback tree.
