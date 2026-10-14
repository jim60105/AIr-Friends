# OMP Native Settings, Providers & Skill Discovery

This document describes the HAND-AUTHORED native configuration AIr-Friends
deploys for the Oh-My-Pi (OMP) coding agent, pinned to official upstream
`v18.6.1` / commit `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`.

Every OMP configuration file is authored by hand and consumed by native OMP
itself. Application startup, the extension build and the image build never
generate, serialize, template or rewrite them: the container build only COPIES
the tracked authored bytes into their installed locations. Consequently a YAML
parse or schema-validation error ORIGINATES FROM NATIVE OMP STARTUP and flows
through the existing session error reporting — there is no app-owned schema
mirror, overlay composition or launch-time configuration write to pre-validate
it, and none is invented here.

---

## 1. Authored Mode Settings

| Authored source                    | Installed copy                              | Selected for        |
| :--------------------------------- | :------------------------------------------ | :------------------ |
| `agent-config/omp/restricted.yml`  | `/opt/air/omp/config/restricted.yml`        | `yolo === false`    |
| `agent-config/omp/native-yolo.yml` | `/opt/air/omp/config/native-yolo.yml`       | `yolo === true`     |

The installed copies are root-owned `0644` inside root-owned `0755`
directories (root-owned so the agent process cannot rewrite the policy that
governs it). `resolveOmpConfigPath()` (`src/utils/omp-paths.ts`) returns the
installed copy when it exists and the authored development-tree path
otherwise; the factory passes exactly ONE `--config` value per launch — the
selected mode document (see [OMP_SPAWN.md](OMP_SPAWN.md) §2). The install is
content-faithful: the installed bytes are the authored bytes.

### 1a. Exact key surface per mode

| Key                                                          | `restricted.yml` | `native-yolo.yml` | Native meaning                                                                                       |
| :----------------------------------------------------------- | :--------------- | :---------------- | :--------------------------------------------------------------------------------------------------- |
| `tools.approvalMode`                                         | `write`          | `yolo`            | Non-YOLO native approval vs. maximally permissive native approval.                                   |
| `tools.approval.read` / `.grep` / `.glob` / `.find` / `.todo` / `.web_search` | `allow`          | (absent)          | Exact-name `allow` entries honored in every approval mode.                                           |
| `tools.approval.lsp`                                         | `deny`           | `deny`            | Exact-name native denial of the LSP tool in BOTH modes.                                              |
| `grep.enabled`                                               | `true`           | (absent)          | Native builtin search stays available under the supported activation control.                        |
| `glob.enabled`                                               | `true`           | (absent)          | Same, for `glob`.                                                                                    |
| `find.enabled`                                               | `auto`           | (absent)          | Availability stays judge/model-dependent (see below).                                                |
| `skills.enabled`                                             | `true`           | `true`            | Native skill discovery enabled.                                                                      |
| `skills.customDirectories`                                   | `["~/.agents/skills"]` | `["~/.agents/skills"]` | The stock image's shared skill tree, resolved by native `expandTilde()` (section 3).        |
| `startup.checkUpdate`                                        | `false`          | `false`           | Automated startup update checks disabled.                                                            |
| `marketplace.autoUpdate`                                     | `off`            | `off`             | Marketplace auto-updates disabled.                                                                   |
| `update.channel`                                             | `stable`         | `stable`          | Update channel pinned to `stable`.                                                                   |
| `compaction.enabled`                                         | `true`           | `true`            | Native conversation compaction enabled (section 4).                                                  |

Notes on the surface:

- **`tools.approvalMode: write`** is the explicit non-YOLO native mode:
  read-tier native actions are auto-approved, while `write` and `exec` tier
  calls (e.g. `bash`, destructive edits) still reach the ordinary ACP client
  permission path. `tools.approvalMode: yolo` skips the ordinary tier-based
  prompts, and no restricted clamp crosses into YOLO.
- **Exact-name approval is a POSTURE, not a default deny.** The pinned native
  settings schema has NO wildcard default-deny key, so nothing in the YAML
  enumerates the blocked names. Restricted default deny is enforced by the
  restricted capability extension's pre-dispatch name decision
  ([OMP_ENFORCEMENT.md](OMP_ENFORCEMENT.md), [OMP_TOOL_POLICY.md](OMP_TOOL_POLICY.md)):
  a native `tool_call` whose name maps to a permitted ability continues to
  native dispatch with no repeated native or ACP authorization, and every
  other name is blocked before execution. No restricted-entry name is
  mirrored into the YAML for that purpose.
- **`find.enabled: auto`** is pinned VERBATIM so availability stays
  judge/model-dependent; `auto` resolves only when the judge role is backed by
  a native TypeSafe model AND a model registry exists. No judge, model or
  backend is added to force it on.
- **`grep`/`glob`/`find` activation is not a filesystem boundary.** cwd,
  `.gitignore`, hidden-file filtering, candidate credential/binary filtering
  and output limits are BEHAVIOR controls: native local read/search runs under
  the process's ambient OS permissions ([OMP_ENFORCEMENT.md](OMP_ENFORCEMENT.md)).
- **LSP is denied natively in both modes** by the exact-name
  `tools.approval.lsp: deny` entry. No session-mode override participates for
  OMP, and no launch flag carries the denial (see [OMP_SPAWN.md](OMP_SPAWN.md)
  §2); the denial is a tool-policy pin and makes no claim about implicit
  language-server startup ([AGENT_PERMISSIONS.md](AGENT_PERMISSIONS.md)).
- **Keys REMOVED by the cutover**: `lsp.enabled`, `fetch.enabled`,
  `disabledProviders` and the alternate-skill-source toggles
  (`enableCodexUser` and its siblings) are no longer authored in any mode
  document. Native `read`/`web_search` and native skill-URI reading are the
  real routes; no project-owned fetch/search route or provider blacklist
  replaces them.

---

## 2. Native Provider Configuration

`agent-config/omp/models.yml` is installed VERBATIM by the Containerfile at
`/home/deno/.omp/agent/models.yml` — the NATIVE config-HOME path
(`getAgentDir()/models.yml`) that native OMP reads directly. It is **not** a
`--config` overlay: no application code reads, passes, translates or rewrites
its content, and no application flag names it — the launch only composes its
path to expose the file read-only under confinement (section 5). The former
`/opt/air/omp/config/models.yml` install is gone.

Development deployments MUST author the same file at the operator's native HOME
path (`$HOME/.omp/agent/models.yml`) before launch. The runtime never creates,
copies or symlinks the file.

### 2a. Provider schema and credentials

| Concern              | Authored / consumed value                                            |
| :------------------- | :-------------------------------------------------------------------- |
| Gemini provider      | native provider id `google`, credential `GEMINI_API_KEY`              |
| OpenRouter provider  | native provider id `openrouter`, credential `OPENROUTER_API_KEY`      |
| Application title    | `providers.openrouter.headers.X-Title: AIr-Friends`                   |

The OMP launch assigns `GEMINI_API_KEY` and `OPENROUTER_API_KEY` only;
`GOOGLE_GENERATIVE_AI_API_KEY` is never passed to an OMP process. Model
selection stays catalog-based against the native advertised catalog: there is
no project-generated provider blacklist, and a requested model missing from
that catalog keeps the existing explicit session-scoped selection error rather
than an invented model ID.

### 2b. Native non-overridable identity headers (pinned source evidence)

Pinned OMP hard-codes `HTTP-Referer: https://omp.sh/` and
`X-OpenRouter-Title: omp` in `getOpenRouterHeaders()`
(`packages/ai/src/utils/openrouter-headers.ts`), which overrides model/config
headers in `openai-shared.ts:229-231`. This is a SOURCE observation of the
pinned revision: it is not a claim that configuration inspection, an authored
file or a mock preserves, replaces or overrides those headers, and the
authored `X-Title` header above is the only identity header configuration can
supply.

---

## 3. Native Skill Discovery Root

Both mode documents author `skills.enabled: true` and
`skills.customDirectories: ["~/.agents/skills"]` — the stock image's shared
skill tree, spelled with a native `~` that native `expandTilde()` resolves.
There is no app-owned skill-root generation step, interpolation or
root-equality check: the deployer authors the real root directly, in the same
file the deployer already owns.

- **Stock image**: `/home/deno/.agents/skills` — the Containerfile's skill
  `COPY` destination and the image's declared `AGENT_SKILLS_DIR` value, which
  is also Helm's default. The authored `~/.agents/skills` resolves to it.
- **Development / custom deployment**: the deployer MUST author the actual
  root in BOTH mode files AND configure `agent.skillsDir` /
  `AGENT_SKILLS_DIR` to that same root. Nothing interpolates
  `${AGENT_SKILLS_DIR}` or any other variable into the YAML, and a mismatch
  between the two is a deployment authoring error, not a runtime rejection
  performed by this application.

The same resolved root remains the ONE shared trusted skill-script root for
both agent types (prompts, script inventory, permission decisions, readiness
and the read-only confinement mount); native discovery consumes the
hand-authored YAML entry, and this deployment mirrors no second copy of it.

---

## 4. Native Compaction, Update and Prompt Behaviour

- **Compaction** (`compaction.enabled: true`): the pinned native strategy uses
  `methodOrder` (remote, snapcompact, handoff, shake, soft) and token
  thresholds. OpenCode's `prune` parameter has **no native equivalent** in
  OMP, and no prune key is invented. Whether the native strategy behaves
  identically to OpenCode's compaction is upstream-owned runtime evidence.
- **Updates**: `startup.checkUpdate: false`, `marketplace.autoUpdate: off` and
  `update.channel: stable` disable automated update checks and marketplace
  auto-updates and pin the channel. The pinned schema has no whole-updater
  kill switch, so binary replacement via an explicit `omp update` remains a
  deliberate deployment action.
- **System prompt**: the override is passed as the `--system-prompt <path>`
  CLI argument (the official native custom-prompt route). The operator mount
  `/app/prompts/system_prompt_override.md` wins whenever it exists, otherwise
  the installed `/opt/air/omp/prompt/SYSTEM.md` artifact is used (see
  [OMP_SPAWN.md](OMP_SPAWN.md) §2). Generated context, skills, rules and the
  footer are retained while the default instruction block (and its default
  tool-policy guidance) is replaced; runtime application remains a
  user-verified checklist item.
- **Legacy payload prompts** (`prompts/system_self_research.md`,
  `system_spontaneous.md`, …) are consumed directly by the AIr-Friends
  pipeline: they are per-file payload mounts and need no agent-settings
  translation.

---

## 5. Filesystem Confinement

`sandbox.filesystemConfinement` now has a real OMP input path. The factory
supplies `AgentConfig.runtimeMounts` (optional, OMP only — `readOnlyPaths` and
`writableRuntimePaths`), which `SandboxManager.buildSpawnOptions()` APPENDS to
the shared confinement defaults.

| Direction       | Selected by the OMP launch                                                                                                                    |
| :-------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| Read-only       | the selected mode settings file; the selected system prompt; the restricted capability bundle (restricted launch only); the inherited-HOME `.omp/agent/models.yml` |
| Read-write      | the selected `<XDG_DATA_HOME>/omp` native data child (created before spawn)                                                                    |

The sibling mode/pool data roots, the pool parent, `dataRoot` and HOME are NOT
exposed, so the shared mount policy is not widened by these inputs. The shared
skill-root overlap refusal and the final read-only skill bind are unchanged,
and OpenCode passes no `runtimeMounts` — its mounts and observable access
outcomes are untouched.

---

## 6. Evidence Limits

- The contract above is SOURCE-observed from the authored files, the factory
  and the pinned upstream revision. Unit and mock tests certify the authored
  configuration bytes and the launch assembly decisions only; they never
  invoke the native binary, a provider, a container or a live platform
  ([USER-RUNTIME-VERIFICATION.md](USER-RUNTIME-VERIFICATION.md)).
- Native consumption of `skills.customDirectories`, the `find` judge
  resolution, native URL/web-search behavior and native compaction strategy
  differences remain upstream-owned runtime evidence.
- A YAML parse or validation error originates from native OMP startup; this
  deployment neither mirrors nor pre-validates the native schema.
- **Zero new configuration surface**: these authored files add no
  `config.yaml` field, no environment variable and no Helm value;
  `config.example.yaml`, `.env.example` and `helm/values.yaml` stay
  unmodified.
