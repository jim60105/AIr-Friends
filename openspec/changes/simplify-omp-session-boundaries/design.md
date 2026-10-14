# Design

## Context

Observed `AgentConnector.verifyOmpSettingsSourcesBeforeRequest()` and `verifyOmpExecutableSourcesBeforeRequest()` run before spawn/new/load; `setSessionGateContext()` re-observes OMP `ownedSkillsBaseline` from `agentConfig.settingsSourcePlan`. `ChatbotClient.observeFilesystemRoots()` imports `PINNED_CRITICAL_SKILLS` and checks critical references. These are additional OMP preconditions around existing shared callbacks. The shared `SkillsRootObservation` in `src/core/skills-root.ts` already carries canonical root and optional dev/ino identity. `buildSkillAutoApproveList()` consumes that observation independently of OMP configuration.

## Goals / Non-Goals

Use the shared root and session contexts at ACP callback boundaries; remove OMP-specific lifecycle scanning and critical metadata. Preserve protected no-follow IO, shared root/path containment, callback extension restrictions, command policy, existing sandbox mounts and script inventory. Native read auto-approval is outside callback policy. No native extension cutover or YAML changes in this unit.

## Decisions

1. Delete connector preflight methods, fields, getter and every connect/createSession/reconnect call. Remove only their error imports and special classifications in `SessionOrchestrator.classifyRecoveryFailure()` and creation catches. Native/transport/shared-policy errors retain existing isolation and reporting.
2. Remove `observeOwnedSkills()` and `ownedSkillsBaseline` from context registration. OMP's callback trusted root uses `options.agentConfig.skillsRoot`, the same factory-produced shared observation already used by inventory and confinement, rather than the settings plan. Construct the existing root metadata fields from that observation (`ownedRootPath` and `canonicalOwnedRootPath` equal `root`, `source: deployment_owned`, `rootIdentity: identity`). An unavailable identity remains unavailable and follows the existing shared callback denial. This creates no discovery fallback and does not change OpenCode's supplied `ctx.trustedSkills` choice.
3. Remove `criticalSkills` from shared `TrustedSkillsSource`, its deep-copy consumers and fixtures. Move the complete `CriticalSkillReference` declaration from `filesystem-roots.ts` into the existing OMP-only `owned-skills.ts` producer, without a shared re-export. Give that producer an internal `OwnedSkillsObservation extends TrustedSkillsSource` return/previous type carrying its existing `criticalSkills` field. This preserves the still-live native bootstrap consumer while removing critical metadata from the daemon callback contract. Remove `PINNED_CRITICAL_SKILLS` import and critical-reference-only checks from the ACP client. Keep shared canonical root identity and no-follow access rules.
4. `setSessionGateContext()` retains existing merge order, cloned write-extension values, per-ACP-ID cache and replay. Session context generations used by common callbacks remain; external critical-skill generation suppliers and assertions are deleted. `setSessionContext()` itself calls `nextRegistrationGeneration()`, so retain that helper for common callback generations and make it private after external fixtures migrate.
5. Keep `src/acp/omp/owned-skills.ts`: `extension/critical-skills.ts` imports and re-exports `observeOwnedSkills()`, and `observeDeclaredSkillRoots()` calls it before old bootstrap admission. Also keep `settings-sources.ts`, `executable-sources.ts`, `discovery-guard.ts`, `omp-settings.ts` and extension bootstrap until `cutover-omp-native-runtime` replaces their complete closure. No live prerequisite is deleted here. The OMP-only type remains part of that existing working mechanism, without a new runtime bridge.

## Risks / Trade-offs

Shared callback denial semantics must not be reduced while metadata is removed. Retain tests for sibling session paths, read extensions, readonly skill targets, all-target writes, and protected IO side effects. Do not add tests promising that cancelled discovery concerns are never handled by upstream. Native extension bootstrap limitations persist until the atomic cutover and are documented as the current interim state.

## Migration Plan

Connector, client, type consumers and affected fixture builders change together. No settings/pool path changes occur. Current callback and lifecycle docs are updated in this unit; later documentation consolidation does not postpone these updates.
