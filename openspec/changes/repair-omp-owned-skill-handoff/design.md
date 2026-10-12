# Design

## Context

Owned OMP settings name deployment-owned skills, and process isolation intentionally assigns a separate child HOME. Current recipes incorrectly derive script roots from that child HOME. The native read definition supports `readsSkillUris`, while the URL parser currently rejects every non-HTTP URI before native delegation.

## Goals / Non-Goals

**Goals:** Make owned skill instructions executable and readable in every session/spawn shape.

**Non-Goals:** Relax HOME isolation, symlink a second skill tree into child HOME, change payload staging/JWT identity, or trust a skill by name alone.

## Decisions

1. Resolve one absolute root through existing deployment path/owned-root logic. OMP uses the installed owned root or validated development source root. OpenCode resolves its existing installed skills directory from the daemon/deployment environment, not OMP's child HOME. Pass that resolved value as internal `skillsDir` to every relevant render and the retry builder. No public override or new subprocess secret is added.
2. Render quoted absolute script recipes from `skillsDir`, retaining the literal active Skill API id and current absolute payload-file paths. Migrate normal, spontaneous, lurk, research, summary, both maintenance forms, reminders, and missing-response retry together. Static SKILL.md examples refer to the literal root supplied in the current prompt instead of `${HOME}/.agents/skills`; no HOME fallback remains. Keep all content off command lines.
3. Give the registered native read replacement `readsSkillUris: true`. Classify HTTP(S), owned `skill://`, local paths, and forbidden schemes distinctly. Resolve a skill URI against the existing declared canonical owned skill source, verify ownership/resource generation and any resulting read target before native same-tool delegation, then use `ctx.invokeTool()` so native instruction handling/bookkeeping is preserved. The C4 native decoder must consume that authorized canonical target as the existing trusted-skills `path-target` route while preserving the original URI for native delegation; it must not classify every URI as a device or downgrade an arbitrary device to a path. No duplicate skill resolver, generic device URI pass-through, foreign root, or traversal fallback.
4. Make the native decoder and existing command policy recognize the resolved approved script path without treating prompt text as permission. Keep shared-session pointer/JWT authority and staging containment unchanged. Update existing handoff smoke to invoke the actual script at the rendered root, not a mock that merely echoes an API call.
5. Modify the existing portable-staging requirement in full to include skills-root instructions while retaining every identity/staging scenario. Add the internal template-variable behavior as an additive requirement so existing template semantics are retained.

## Risks / Trade-offs

- [One secondary renderer omits skillsDir] → Enumerate all skill-instructing render/retry callers and exercise their real rendered invocation paths.
- [Read is marked skill-capable but admits a shadowed URI] → Test foreign same-name skill, symlink/identity replacement, traversal, and stale-generation denial before delegation.
- [OpenCode bytes change while an old spec freezes them] → Amend only the recipe-form portion of its combined-suite scenario; preserve equivalent delivered response, launch/mode identity, and legacy payload compatibility rather than byte-copy tests.

## Migration Plan

Apply after C2/C4 and serialize after C5. Migrate every caller, instruction, and broken handoff consumer in one cutover. Rebuild/recut and document the new template variable and deployment root. Whole-change revert is rollback; no child-HOME shim. Budget: render/root migration 3.0h, skill URI integration 2.0h, focused handoff smoke 2.0h, docs/digests 1.0h, total 8.0h. Native/real-platform observation remains user-owned.
