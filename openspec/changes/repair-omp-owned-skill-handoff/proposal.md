# Proposal

## Why

OMP isolates child `HOME`, but skill recipes still point to `${HOME}/.agents/skills`, an empty isolated directory. The read replacement also rejects `skill://`, disconnecting owned skill discovery from readable instructions.

## What Changes

- Resolve one trusted absolute skills root per agent/deployment and supply literal `skillsDir` to every skill-instructing prompt and retry builder.
- Migrate bundled prompt/skill recipes away from child-HOME paths; preserve OpenCode's existing installed-root resolution and all session staging/authentication semantics.
- Support owned `skill://` reads through the pinned native read contract, with canonical ownership and generation checks; reject foreign/shadowed skills and other unsupported schemes.
- Keep isolated HOME, owned-only discovery settings, per-spawn/pooled identity, and secure read boundaries intact.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: Require deployment-owned skill URI admission and native same-tool read delegation.
- `skills-and-reply`: Require executable absolute-root recipes independent of child HOME in all handoff paths.
- `prompt-template-system`: Add the literal trusted skills-root variable and require it at each skill-instructing render caller.

## Impact

Targets: agent factory/path resolver, template variables, orchestrator/scheduler render callers, retry builder, `prompts/`, `skills/*/SKILL.md`, read replacement, and handoff coverage. Prerequisites: C2 native read contracts and C4 registration/provenance; serialize after C5. Rebuild/recut owned artifacts and update development/skill/runtime docs and changelog. Budget: 8.0h. `skillsDir` is an internal template variable, not new public configuration, environment override, or credential.
