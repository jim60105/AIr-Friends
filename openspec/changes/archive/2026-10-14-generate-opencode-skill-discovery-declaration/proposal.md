# Proposal

## Why

`unify-skill-root-and-inventory` makes one configured value, `agent.skillsDir`/`AGENT_SKILLS_DIR`, the single skill root for both agent types, and `bootstrap` publishes runtime-installed external skills into it. OpenCode does not follow that value: `agent-config/opencode.json:95-101` allows reads only under the hard-coded `~/.agents/skills/**`, `/home/deno/.agents/skills/**` and the workspace paths, and discovery relies on the implicit `~/.agents/skills` convention. The pinned OpenCode v1.17.13 runtime already declares the hook for this — `ConfigV1.Info.skills = { paths?: string[]; urls?: string[] }` — but the shipped configuration never uses it, so any operator root other than the container default is invisible to the agent that must discover and read the installed skills.

## What Changes

- Bootstrap declares the resolved root to OpenCode by writing it into the deployed OpenCode global configuration as the skill discovery path (`skills.paths`) and as an allowed `external_directory` location, preserving every other setting in that file, including the `deno run *` / `*.ts*` routing that sends skill executions to the ACP gate.
- The declaration is derived from the same resolved value every other consumer uses, and adds no configuration field, no Helm value, no credential and no environment override.
- Inspect-then-write: a file that already declares the resolved root (in any spelling that resolves to it, for example `~/...`) is left byte-identical, so a correct operator-mounted configuration keeps working; an absent file is created carrying exactly the declaration; a file that must be updated but cannot be written fails startup explicitly instead of starting an agent whose discovery contradicts the daemon's resolved root; and a root that is the daemon user's home directory or an ancestor of it is refused rather than turned into a home-scoped read allowance.
- Documents the operator and development consequences: the mounted `my-opencode.json` workflow and the fact that a development deployment writes into the developer's own OpenCode configuration.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `configuration-and-deployment`: adds the generated OpenCode skill discovery declaration as a requirement, including the discovery-path semantics, the no-op and failure postures, and the guarantee that it never becomes a second authority for script approval.

## Impact

- Code: `src/bootstrap.ts` (declaration step after config loading, alongside the existing external-skill publication), plus a generation helper next to the existing OpenCode path constants (`src/utils/opencode-paths.ts`).
- Tests: a new generation suite (substitution of only the declared keys, byte-identity for an already-correct file including a `~/` spelling, creation when absent, explicit failure for an unwritable target and for an over-broad root) and the bootstrap ordering assertion that the declaration precedes agent construction.
- Documentation: `docs/DEVELOPMENT.md` (the `my-opencode.json` mount rule and the template layout), `AGENTS.md` container section, `docs/USER-RUNTIME-VERIFICATION.md` (the deferred live-discovery row), CHANGELOG.
- Runs unconditionally, including on an OMP-default deployment, because a dashboard-selected OpenCode session there resolves the same root and would otherwise be unable to discover it.
- **Depends on** `unify-skill-root-and-inventory` for the resolved value; independent of the OMP trust alignment and the packaging collapse.
- ACP-side script approval is unaffected: the declaration grants discovery and file-read visibility only, and the inventory and permission gate remain the sole authority for execution.
