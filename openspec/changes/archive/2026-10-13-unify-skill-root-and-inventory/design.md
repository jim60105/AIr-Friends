# Design

## Context

See proposal.md — Why. Verified current state (line references are the working tree's):

- `src/core/skills-root.ts:176-189` (OMP) selects `OMP_IMAGE_SKILLS_ROOT` image-first with a validated `DEV_SOURCE_SKILLS_ROOT` (`:48-50`) development fallback and never consults `configuredSkillsDir`; `:190-206` (OpenCode) resolves `configuredSkillsDir` (default `"skills"`) against the deployment cwd. Shared posture for both branches: canonical observation, `/`-refusal, explicit `ConfigError` (`:154-175`, `:198-206`). `src/utils/omp-paths.ts:73` defines `OMP_IMAGE_SKILLS_ROOT = "/opt/air/skills"`.
- Eligibility: `src/acp/skill-inventory.ts:113-127` (`BuildSkillAutoApproveListInput.agentType`), `:158-181` (OMP candidate names = `BUNDLED_SKILLS` ∩ configured names; OpenCode reads the directory), `:185-256` (`scripts/*.ts`-only enumeration with `(dev, ino, ctime, size)` identity), `:282` (`deno`-only interpreter allowlist), `:460-546` (decision-time physical entrypoint match plus root and script identity rechecks). `GENERIC_COMMAND_ALLOWLIST` (`src/acp/command-path-policy.ts:39-63`) contains no interpreter, so a non-Deno skill script can never be generic-approved either. `src/acp/agent-connector.ts:318-321` is the production construction site of that input.
- Install: `src/bootstrap.ts:192-195` publishes into `resolveTrustedSkillsRoot("opencode", config.agent.skillsDir)`; `src/core/skill-installer.ts:275-339` runs the upstream installer in a private installer HOME and publishes the validated tree, refusing bundled/`lib` collisions, links, traversal and escapes — unchanged by this change.
- Consumers: `src/healthcheck.ts:198-236`, `src/core/session-orchestrator.ts:222-257` (cached root) and `:272-281`, `src/acp/agent-factory.ts:60` (one observation per selected agent), the bwrap read-only skill mount, and `prompts/skills_root.md` (the one shared `## Skill Script Root` fragment).
- Deployment value: `config.example.yaml:66`, `.env.example:39-40`, `helm/values.yaml:70` describe it as OpenCode-only; `Containerfile:369` sets `AGENT_SKILLS_DIR=/home/deno/.agents/skills` and `:265` copies the repository `skills/` tree there; `AGENTS.md:1526-1545` holds the configuration-consistency audit table read by `tests/utils/config-trio-sync.test.ts`.
- `agent-config/opencode.json:92-93` routes `deno run *` and `*.ts*` to `ask` so skill executions reach the ACP gate, and `:95-101` allows reads only under `~/.agents/skills/**`, `/home/deno/.agents/skills/**` and the workspace paths. Making OpenCode's own declaration follow the resolved root is a separate change (`generate-opencode-skill-discovery-declaration`); this change only guarantees that the value exists and is used by every daemon-side consumer.

## Goals / Non-Goals

**Goals:** one absolute root resolved from one configuration value for both agent types; one eligibility rule over that root; the install destination equal to that root; every existing consumer keeping a single shape with no agent-type branch.

**Non-Goals:** the OMP ownership/trust ladder, the OMP settings declaration and the extension's read authorization (co-released `align-omp-skill-trust-to-shared-root`); the packaged-tree collapse and the removal of `/opt/air/skills` from the image (`collapse-skill-packaging-to-one-tree`); new configuration fields, environment variables or Helm values; and any relaxation of what an installed skill may execute (the `scripts/*.ts`-only and `deno`-only rules stay).

## Decisions

### D1. One resolver, one value, and `agentType` out of the selection

Keep `resolveTrustedSkillsRoot(agentType, configuredSkillsDir, options)` as the single boundary and keep `agentType` as an input for supported-type validation and error context only. Delete the OMP branch and `DEV_SOURCE_SKILLS_ROOT`; both types resolve `configuredSkillsDir` — absolute as given, relative against the deployment working directory, the documented `"skills"` default when unset or empty — and then pass through the existing canonical observation, `/`-refusal and explicit-failure posture. `OMP_IMAGE_SKILLS_ROOT` stops being a selector here; its definition survives only until its remaining consumers are parameterized in the trust change and its image tree is removed by the packaging change.

Alternatives rejected: a code-level default of `/home/deno/.agents/skills` (the default already lives in the config trio, Helm and the Containerfile; a second one in code would mask a missing deployment value); keeping a validated development fallback (two conventions for one value is the defect being removed); resolving per agent type then asserting equality (an assertion nobody needs if there is one selection).

### D2. Eligibility is root-observed for both agent types

Remove `agentType` from `BuildSkillAutoApproveListInput` and delete the `BUNDLED_SKILLS` candidate intersection, so both types enumerate the observed root exactly as OpenCode does today. Retained unchanged: `RESERVED_SKILL_ENTRIES` exclusion, `scripts/*.ts`-only enumeration, the `deno`-only interpreter allowlist, configured-name filtering through `isValidSkillNameComponent`, observed command-prefix handling for `SKILL.md` skills without a scripts directory, and every root/script identity recheck at decision time. `src/core/bundled-skills.ts` keeps only its external-install collision role and the source-parity fixture. The compensating invariants that bound the widened exposure are stated once in the co-released trust change's design (D6 here).

### D3. The install destination is that same value

`src/bootstrap.ts` calls `installExternalSkills(resolveTrustedSkillsRoot(config.agent.defaultAgentType, config.agent.skillsDir), config.agent.externalSkills)`. The installer body, its private installer HOME, `--copy` publication, collision/traversal/link refusals, failure isolation and refresh behavior are untouched: only the destination argument changes. Runtime installation of external skills is a required behavior of this deployment and is preserved exactly.

### D4. Consumers keep one shape

Readiness, the orchestrator cache, the connector inventory input, the read-only skill mount and prompt/retry rendering keep consuming the single resolved value; no consumer gains an agent-type branch, a second root or a fallback tree, and `src/healthcheck.ts` keeps its single `resolveTrustedSkillsRoot(getDefaultAgentType(...), ...)` call.

### D5. Ordering, co-release, and delta mechanics

This change alone leaves OMP unable to read or execute the shared root: `src/acp/omp/owned-skills.ts:61-87` and the extension's read replacement still refuse an agent-writable tree, and `agent-config/omp/restricted.yml:20-30`, `agent-config/omp/native-yolo.yml:7-13` plus `src/acp/omp-settings.ts:699-702` still declare and require the constant. The co-released `align-omp-skill-trust-to-shared-root` relaxes exactly those clauses and parameterizes that declaration, and it validates against this change's resolution — so this change MUST NOT be released without it, and the packaging collapse MUST follow both.

The deltas express changed scenario sets through `REMOVED` + `ADDED` (and `RENAMED` for a pure requirement rename) rather than `MODIFIED`, because `openspec validate` refuses a `MODIFIED` block that drops or renames an existing scenario, and keeping a scenario name whose body asserts the opposite behaviour would be the worse defect.

## Risks / Trade-offs

- **OMP is degraded between the two co-released changes** → the ordering rule in D5; both land in one release.
- **Widened execution eligibility**: the catalog no longer bounds what may run, so any `scripts/*.ts` under the configured root is eligible for both agents → intended by the requirement; bounded by the retained `scripts/*.ts`-only rule, the `deno`-only allowlist, the unchanged decision-time identity rechecks, and the invariants stated once in the trust change's design.
- **Test churn**: resolver, wiring, readiness, fixture and mount tests currently encode the asymmetric roots → rewritten inside the groups that own the behaviour, not in a trailing group.

## Migration Plan

No data migration and no operator action: an existing `AGENT_SKILLS_DIR` keeps naming the same directory for OpenCode and now names it for OMP too. Deploy together with `align-omp-skill-trust-to-shared-root`; roll back by reverting both. Nothing in this change writes to `/opt/air/skills` and nothing removes it, so a rollback needs no image action.

## Dependencies and Conflicts

| Change | Relationship | Code/spec overlap | Scheduling |
| --- | --- | --- | --- |
| `align-omp-skill-trust-to-shared-root` | Mandatory co-release partner: it validates against this change's resolution, and this change alone leaves OMP refusing the shared root | `src/acp/omp*`, acp-integration deltas, `agent-config/omp/*.yml` | Same release; apply this one first |
| `generate-opencode-skill-discovery-declaration` | Depends on this change's resolved value | `src/bootstrap.ts`, configuration-and-deployment deltas, `docs/DEVELOPMENT.md` | After it; same or next release |
| `collapse-skill-packaging-to-one-tree` | Depends on this change (it removes the tree this change stops selecting) | `Containerfile`, `scripts/`, container-packaging deltas | After the trust alignment |
| `openspec/changes/archive/2026-10-13-unify-omp-skill-root-resolution` | Archived predecessor; this change reverses its deliberate two-root selection | `src/core/skills-root.ts`, acp-integration | Already applied; no active edge |

Documentation files shared with the successor changes are edited sequentially in this order: this change (`docs/AGENT_PERMISSIONS.md`, `docs/DEVELOPMENT.md`, `docs/SKILLS_IMPLEMENTATION.md`, `AGENTS.md`), then `generate-opencode-skill-discovery-declaration` (`docs/DEVELOPMENT.md`, `AGENTS.md`, `docs/USER-RUNTIME-VERIFICATION.md`), then `align-omp-skill-trust-to-shared-root` (`docs/OMP_SETTINGS.md`, `docs/OMP_SPAWN.md`, `docs/OMP_DISCOVERY.md`, `docs/OMP_NETWORK.md`, `docs/AGENT_PERMISSIONS.md`, `docs/OMP_PACKAGING.md`, `docs/USER-RUNTIME-VERIFICATION.md`, `AGENTS.md`), then `collapse-skill-packaging-to-one-tree` (`docs/OMP_PACKAGING.md`, `docs/OMP_DISCOVERY.md`, `AGENTS.md`, `docs/DEVELOPMENT.md`, `docs/USER-RUNTIME-VERIFICATION.md`). `src/core/bundled-skills.ts` and `tests/core/bundled-skills.test.ts` are shared by this change (eligibility role) and the packaging collapse (packaging role), in that order.

## Open Questions

None that would change the specs, the approach or the task breakdown.
