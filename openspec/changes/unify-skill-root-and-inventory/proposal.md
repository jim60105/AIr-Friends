# Proposal

## Why

OpenCode and OMP must share ONE skill design: one install location and one configuration value, with both agents able to discover, read, and execute the skills installed there. Today the shared resolver does not do that. `resolveTrustedSkillsRoot()` (`src/core/skills-root.ts:176-206`) selects `/opt/air/skills` image-first for OMP — with a validated repository `skills/` development fallback — and never consults `configuredSkillsDir`, while OpenCode selects `configuredSkillsDir` (default `"skills"`, container `/home/deno/.agents/skills`). Eligibility is asymmetric in the same way: the auto-approve inventory reads `BuildSkillAutoApproveListInput.agentType` (`src/acp/skill-inventory.ts:113-127`) and intersects OMP candidate names with the authored `BUNDLED_SKILLS` catalog (`:158-181`), so a runtime-installed external skill that OpenCode may execute is denied to OMP even when the two agents read the same physical directory.

## What Changes

- **One resolution.** Both agent types resolve the same absolute root from `configuredSkillsDir` alone. **BREAKING**: the OMP image-first branch, the OMP development fallback, and `agentType` as a root selector are deleted; `OMP_IMAGE_SKILLS_ROOT` stops being a selector and becomes at most the single default constant for that one value. The existing absolute/canonical/identity/`/`-refusal/fail-explicit posture is kept.
- **One eligibility rule.** The auto-approve inventory enumerates the one observed root for both agent types: `agentType` leaves `BuildSkillAutoApproveListInput` and the `BUNDLED_SKILLS` intersection leaves the inventory. `RESERVED_SKILL_ENTRIES`, the `scripts/*.ts`-only rule, the `deno`-only interpreter allowlist, and every root/target identity recheck stay exactly as they are.
- **One install destination.** Bootstrap keeps the required runtime installation of external skills and publishes them into that same resolved root. `src/core/skill-installer.ts`'s validated publication body is unchanged; only the destination argument it receives changes.
- **Consumers follow the single value.** The connector inventory, prompts/retries, the read-only skill mount, and readiness keep consuming one resolved root without gaining a second code path.
- **Config and documentation restated.** `config.example.yaml`, `.env.example`, `helm/values.yaml`, and the `AGENTS.md` configuration-consistency audit table state the one shared root; the docs that assert the per-agent root split are rewritten.
- **Tests rewritten**, because they currently pin the old asymmetry.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `configuration-and-deployment`: external-skill publication destination, the stock image's skill-directory declaration, and skill readiness — including the frozen scenario `OMP default does not trust external OpenCode installs`, which this change reverses.
- `acp-integration`: `Skill Auto-Approve List Construction` (the frozen OMP catalog-only eligibility sentences and both OMP-specific scenarios are reversed) and `Root-Exact Script Entrypoint Approval` (OMP root premises).
- `skills-and-reply`: `Deployment-Resolved Skill Script Root Identity` — one root shared by both agent types.
- `agent-sandbox-hardening`: `Resolved Skill Tree Has Read-Only Runtime Visibility` — the single resolved root is the tree mounted for both agents.

## Impact

- Code: `src/core/skills-root.ts`, `src/acp/skill-inventory.ts`, `src/bootstrap.ts`, `src/acp/agent-factory.ts` (call sites only), `src/healthcheck.ts` (follows the single root, no new branch), `src/core/session-orchestrator.ts` (cached root), `src/core/bundled-skills.ts` (eligibility role removed).
- Configuration/documentation: `config.example.yaml`, `.env.example`, `helm/values.yaml`, `AGENTS.md`, `docs/AGENT_PERMISSIONS.md`, `docs/DEVELOPMENT.md`, `docs/SKILLS_IMPLEMENTATION.md`; CHANGELOG.
- Tests: resolver, inventory, wiring, readiness, prompt-staging-literal, confinement/mount, and the `skillsDir` fixtures listed in tasks.md.
- **Not** in this change: the OMP ownership/trust ladder and its settings declaration (co-released `align-omp-skill-trust-to-shared-root`), the agent-side OpenCode discovery declaration (`generate-opencode-skill-discovery-declaration`), and the packaging collapse (`collapse-skill-packaging-to-one-tree`). This change alone resolves and enumerates one root, publishes into it, and restates its configuration; it does not remove `/opt/air/skills` from the image.
