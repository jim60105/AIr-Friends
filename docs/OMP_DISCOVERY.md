# OMP Configuration Discovery

Native OMP discovers its own configuration. The native-runtime cutover removed
this deployment's app-owned discovery apparatus — the pre-import exclusion
bootstrap, the executable-source precheck, the settings-source observer and
source plan, the generated skill-root declaration, the module-trust ladder and
the readiness gate — so there is no app-side discovery prerequisite, ownership
epoch or readiness signal any more. What is actually true now is below.

## What native OMP discovers

- **Settings**: the selected hand-written mode document, passed explicitly on
  the command line (`omp acp --config <mode settings> --system-prompt <prompt>`).
  The mode documents are authored by hand and are never generated, serialized,
  templated or rewritten by the application (`agent-config/omp/restricted.yml`,
  `agent-config/omp/native-yolo.yml`; installed read-only at
  `/opt/air/omp/config/`).
- **Project settings**: whatever native OMP finds under `.omp/` in its process
  working directory — the caller/session `workingDir`. There is no neutral
  launch cwd.
- **Model configuration**: the native config-HOME path `getAgentDir()/models.yml`.
  The Containerfile installs `agent-config/omp/models.yml` VERBATIM at
  `/home/deno/.omp/agent/models.yml`. It is not an overlay, and no application
  code reads, passes, translates or rewrites it. A development deployment must
  author the same file at the operator's native HOME path
  (`$HOME/.omp/agent/models.yml`) before launch.
- **Skills**: `skills.customDirectories` in the hand-written mode YAML.

The authored keys are exactly: `tools.approvalMode` plus exact-name
`tools.approval.<name>` entries; `grep.enabled`, `glob.enabled`,
`find.enabled: auto`; `skills.enabled` and `skills.customDirectories`;
`startup.checkUpdate: false`; `marketplace.autoUpdate: off`; `update.channel:
stable`; `compaction.enabled: true`.

## Environment

The shared sandbox environment filter is the ONLY environment control
(`agent.sandbox.filterEnv`, default on; `src/acp/sandbox-manager.ts`). It
admits `BASE_ALLOWED_ENV` plus the per-agent-type set plus operator
`allowedEnvVars`, minus `NEVER_PASS_ENV`. For OMP the agent-type set is exactly
`GEMINI_API_KEY` and `OPENROUTER_API_KEY`; platform tokens (`DISCORD_TOKEN`,
`MISSKEY_TOKEN`), the dashboard passphrase, the raw Skill API secret and the
profile/foreign-provider config selectors never reach the process. There is no
OMP-specific discovery sanitization, no foreign-provider selector blacklist hook
and no settings-source consistency prerequisite.

The launch itself assigns: `HOME` inherited normally (no isolated HOME, no
`PI_CODING_AGENT_DIR`), `XDG_DATA_HOME` = `ompXdgDataHome(baseRoot, mode)` —
`{baseRoot}/omp-agent/{mode}/xdg-data` — with its `omp` child created before
spawn because native OMP redirects its data directory to `$XDG_DATA_HOME/omp`
when that application directory already exists, and `TMPDIR` per the existing
pooled/session convention (`{repoPath}/channel-tmp/{poolKey}` when pooled, else
`{workingDir}/tmp`). `baseRoot` is `{repoPath}/omp-pools/{poolKey}` when pooled,
else `{workingDir}/tmp`. `SESSION_ID`, `SKILL_SHARED_PROCESS`, `SKILL_JWT_DIR`,
`AGENT_WORKSPACE`, the browser binary and the egress-proxy variables are
unchanged.

## Shared skills root

The deployment's skill root is the same `agent.skillsDir` value (env
`AGENT_SKILLS_DIR`) resolved for every agent type by `src/core/skills-root.ts`:
ONE absolute, deployment-owned root; relative roots anchor at the deployment
process working directory, never the agent child's HOME; an unresolvable root
fails explicitly. For OMP the deployer authors that root in the hand-written
mode YAML — the stock image declares `~/.agents/skills` (native `expandTilde()`
resolves `~`), and a development/custom deployment authors its actual root
there AND sets `agent.skillsDir` to the same root. Nothing interpolates or
rewrites the authored value.

Whether the pinned binary's `skills.customDirectories` consumption behaves as
authored is runtime-unverified: it is a source-observation of the authored
document, not an observation of the native binary.

## No app-owned discovery prerequisite

There is no pre-import exclusion bootstrap, no executable-source precheck, no
per-request settings-source observation or source plan, no generated skill-root
declaration, no module-trust ladder and no authenticated readiness handshake.
Native OMP owns its own discovery; the shared environment filter is the only
environment control the deployment applies.

Restricted sessions still load one small capability bundle via
`--trusted-extension` (native-YOLO loads none); that is execution-time tool
admission, documented in [`OMP_TOOL_POLICY.md`](OMP_TOOL_POLICY.md) and
[`OMP_ENFORCEMENT.md`](OMP_ENFORCEMENT.md), not a discovery gate.

---

## Related Documentation

- [OMP Upstream Compatibility (`docs/OMP_COMPATIBILITY.md`)](OMP_COMPATIBILITY.md)
- [OMP Spawn & Process Scoping (`docs/OMP_SPAWN.md`)](OMP_SPAWN.md)
- [OMP Settings & Composition (`docs/OMP_SETTINGS.md`)](OMP_SETTINGS.md)
- [Agent Permissions Specification (`docs/AGENT_PERMISSIONS.md`)](AGENT_PERMISSIONS.md)

> Runtime verification for this area is consolidated in the single checklist
> artifact [USER-RUNTIME-VERIFICATION.md](USER-RUNTIME-VERIFICATION.md).
