## Context

See proposal.md and its matrix. The archived canonical selector owns CriticalSkillSelectionRecord and current resourceGeneration, but its settings deliberately declare no skills keys. Pinned `extensibility/settings.ts` registers actual root/source keys; `extensibility/skills.ts` filters some sources, then lets customDirectories outrank provider skills and maintains a process-global active snapshot. Decision 7 assigns root declarations to owned settings, without relabeling the native name-only incompatibility.

## Goals / Non-Goals

Use the same canonical deployment-owned root in overlays, selection and trusted reads, excluding workspace candidates from critical resolution across new/load/refresh. Preserve ordinary skills under owned roots and real staging/session identity. No global skills disablement, arbitrary configurable root, critical-id-table expansion, native patch or restricted YOLO handler.

## Decisions

### D1. Register and pin source-backed shared skill settings

Use pinned `packages/coding-agent/src/extensibility/settings.ts` registrations. In BOTH overlays set `skills.enabled: true`, `skills.customDirectories` to the complete replacement array of existing canonical deployment-owned skill roots, and false for `skills.enableCodexUser`, `skills.enableClaudeUser`, `skills.enableClaudeProject`, `skills.enablePiUser`, `skills.enablePiProject`, `skills.enableAgentsUser`, and `skills.enableAgentsProject`. The root value comes from the existing owned skills path contract (packaged `/opt/air/skills`, source-owned development equivalent), never workspace/config/model input. Preserve native-YOLO LSP false, approvalMode yolo and absence of restricted tool policy/provider clamp.

Extend the pinned registered-key validator for these exact boolean/array keys and semantic ownership checks. Reject unknown key/default fallback, tilde/relative/workspace roots, symlinks/links or non-owned/writable roots, empty/missing declarations and extra host/custom directories. Keep array replacement semantics and mode-file-last overlay order. Overlay content and typed constants must match. No invented generic project-skill-disable key.

Source switches alone do not exclude every discovery provider. `extensibility/skills.ts` admits managed skills unconditionally and other provider/project sources can remain reachable. Retain the row-26 owned-only HOME/XDG/settings posture and row-27 executable discovery checks. Native source-filter completeness remains a recorded evidence limit. Before critical resolution, apply the canonical candidate ownership filter to every provider/custom/managed candidate; no provider label or matching raw/name/alias can substitute for root membership. Foreign/workspace roots are never added to the declared custom root list.

### D2. One owned-settings-to-selection interface

Extend the existing settings-source plan with immutable ownedSkillRoots and source-toggle posture, derived by the existing path/root selectors. The extension's critical-skills adapter and discovery selection consume this declaration, not a second hardcoded root or model-supplied directory. Packaged extension cannot import `/app/src`; any shared helper joins the existing packaged closure and manifest. Validate canonical read-only root identity and exact selected SKILL.md source identity before issuing CriticalSkillSelectionRecord, using existing canonical filesystem primitives. Maintain resourceGeneration and session identity fields unchanged.

The declared roots are the sole critical candidate roots. Ignore/exclude every workspace/project candidate before name collision/precedence logic, including same-content copies, custom directory priority, namespaced aliases and managed/native candidates outside owned roots. Name-only critical request remains denied; a resolved critical reference must carry exact canonical owned instruction identity and current generation/session evidence. A missing owned instruction fails closed and cannot fall back to workspace or disable all skills.

### D3. Lifecycle consumption remains session-current

At new/load/refresh, regenerate selection from declared owned roots using current session identity/resourceGeneration. A process-global native skill snapshot cannot authorize a foreign-session or stale candidate. Detect missing declaration, writable/replaced/escaping root, changed source identity or selection mismatch and deny the affected resolution. Route read authorization through the existing trusted-root read decision and preserve ordinary owned skill discovery. No change to Skill API payload containment, literal --session-id, absolute staging or retry/delivery behavior.

### D4. Native gate and docs cutover

Consume row 27's DECIDED decision-7 disposition, while preserving `criticalSkillSelectionGate` native status/verdict and pinned resolveCollision/setActiveSkills limitations. Modify current requirement/scenarios that forbid new skills settings, plus current docs/tests saying no skills keys are pinned. Historical archived records and the compatibility ledger remain unchanged. Same-change recut of both overlay digests and changed installed extension closure inputs follows existing packaging conventions. Update discovery/settings/checklist docs and changelog after completed row-24 baseline.

## Risks / Trade-offs

Native process-global snapshots and providers beyond the seven switches remain unsupported full-selection evidence. The repository's canonical checks deny critical authority even if a native name resolves elsewhere; real native resource selection remains user-owned. A name-only URI cannot be used to claim canonical read authority. Two mode overlays must carry the same shared roots without copying restricted policy. Validation needs actual filesystem ownership observations as well as syntactically valid YAML.

## Migration Plan

Cut over existing composition and critical-selection callers to one owned settings declaration. Rebuild packaged assets/closure with recut manifest. No user-data migration, path alias, compatibility layer or archived artifact amendment.

### Authorized deployment prerequisite

The plan review found that the existing image installs skills only into the
agent-writable `/home/deno/.agents/skills` tree, and `/opt/air/skills` is only a
selector default, not an installed tree. On 2026-10-12 the controller authorized
the minimal prerequisite: install a content-faithful root-owned, agent-nonwritable
tree at `/opt/air/skills`, add its production resolver, and supply production
trusted-skill provenance at actual context-registration boundaries. No public
config, environment or Helm field is added. `/opt/air/skills` is outside the
`/opt/air/omp` manifest boundary; changed OMP overlays and extension closure
inputs still require their same-commit manifest recut. Real installation and
native lifecycle observations remain user-owned and UNVERIFIED.

Root observation must be independent of missing critical instructions: missing
pinned instructions deny only the affected critical authority, not ordinary
owned-root reads or unrelated workspace operations. Accepted root/instruction
identities must survive reobservation to detect replacement. Context provenance
uses the client's actual registration generation, not a synthetic `gen-N`
counter; passive reconnect replay does not mint authority.

## Verification and Handoff

Test parsed actual overlays and composed settings, registered types, source-toggle values, array replacement and rejection of ambient/relative/writable/extra roots. Test owned versus same-name/same-content workspace candidates, aliases/custom-priority/managed sources, name-only requests, missing instructions, link escapes and replaced read-only roots. New/load/refresh mocks verify fresh session/generation selection and preserved ordinary owned skills plus trusted reads. Acceptance certifies these repository decisions only; native resource resolution/extension loading remain user-owned and unverified.

## Pinned source references

- [Registered skill settings](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/extensibility/settings.ts)
- [Skill source filtering and collision/snapshot semantics](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/extensibility/skills.ts)
