# Design

## Context

See proposal.md — Why. Verified current state:

- `Containerfile:101-105` defines the `owned-skills-stager` stage (`COPY --link skills/ /build-skills/skills/`, `COPY scripts/stage-owned-skills.ts /app/scripts/stage-owned-skills.ts`, `RUN deno run … /build-skills/skills /owned-skills`); `:265` copies the repository tree to the personal root (`COPY --link --chown=$UID:0 --chmod=775 skills/ /home/deno/.agents/skills/`); `:273` installs the stager output at `/opt/air/skills` (`--chown=0:0 --chmod=0755`).
- `scripts/stage-owned-skills.ts` stages ONLY `[...RESERVED_SKILL_ENTRIES, ...BUNDLED_SKILLS]`, refusing missing catalog entries, linked entries and escaping paths, and logging every excluded non-catalog entry.
- `src/core/bundled-skills.ts:13-16` documents the packaging role; `:23-43` is the 17-name `BUNDLED_SKILLS` catalog; `:46` is `RESERVED_SKILL_ENTRIES = ["lib"]`; `:57-59` is `collidesWithBundledContent`, used by `src/core/skill-installer.ts:175` and `:303` for external-install collision refusal; `tests/core/bundled-skills.test.ts:18-38` pins the catalog against the authored repository `skills/` directories.
- The digest manifest RUN at `Containerfile:301-322` regenerates `PACKAGE-MANIFEST.sha256` over `/opt/air/omp` only; the skills tree was never inside that scope, so removing an image skill tree cannot stale the manifest.
- Tests that pin the staged tree: `tests/core/bundled-skills.test.ts:16` (the staging script path), `:54-107` (the staging fixture and its catalog-count assertion), `:161-188` (the Containerfile assertions naming the stager `RUN` and the `/opt/air/skills` install).
- Documentation that pins it: `docs/OMP_PACKAGING.md:79` (the `/opt/air/skills/**` layout row) and `:88-100` (the ownership rationale for that row); `docs/OMP_DISCOVERY.md:93` (the staged-root and stager reference inside the critical-skill section).

## Goals / Non-Goals

**Goals:** one skill tree in the image, at the path every agent type resolves; the stage, its script and its Containerfile instructions gone; the bundled catalog reduced to the roles that survive; the owned OMP artifact tree, manifest scope and extension bundle untouched.

**Non-Goals:** changing what the image installs for OpenCode's config, the owned extension, the owned settings/prompt assets or the pinned agent versions; recutting or widening the manifest; adding a packaging filter or a replacement staging step; changing the authored repository `skills/` tree.

## Decisions

### D1. Delete the second tree instead of relocating it

Remove the `owned-skills-stager` stage, `scripts/stage-owned-skills.ts` and the `/opt/air/skills` install instruction. Keep the personal-tree COPY as the only skills tree, because it already installs the authored content at exactly the path the single configuration value resolves and receives runtime external installs. Alternative rejected: keep the stage and install its output at the shared root — that would add a second writer of the same tree and preserve the catalog filter that the eligibility unification already removed.

### D2. The catalog keeps only the roles that remain

`src/core/bundled-skills.ts` keeps `BUNDLED_SKILLS`, `RESERVED_SKILL_ENTRIES` and `collidesWithBundledContent` for external-install collision refusal (`src/core/skill-installer.ts:175`, `:303`) and for the authored source-parity fixture. Its packaging role disappears with the stager, and its eligibility role was already removed by the co-released unification change.

### D3. The owned artifact tree and its manifest scope do not change

`/opt/air/omp` (extension, settings overlays, prompt artifact, pinned version, `PACKAGE-MANIFEST.sha256`) is untouched, and no skill byte enters that digest set. No manifest recut is required, and this change therefore does not trip the project's recut invariant.

### D4. Ordering

This change removes a root that `unify-skill-root-and-inventory` stops selecting and `align-omp-skill-trust-to-shared-root` stops declaring and trusting. Applying it earlier would leave OMP pointing at a nonexistent tree, so it lands last. `docs/OMP_DISCOVERY.md:93` is edited by both this change and the trust-alignment change for different clauses of the same paragraph; the edits are sequential, trust-alignment first.

## Risks / Trade-offs

- **Image skill content is now the raw repository tree with no catalog filter**: a stray directory in a development checkout would be shipped. Mitigation: the tree is version-controlled, and the retained source-parity fixture (`tests/core/bundled-skills.test.ts:18-38`) fails on an unexpected authored directory; the tree is agent-writable by design and the runtime installs external skills into it anyway.
- **The packaging-time link refusal disappears**: the staging script used to fail the build on a linked catalog entry. Mitigation: the only remaining path is the repository-tree COPY, review sees the tree, and no immutability property is claimed for it under the accepted posture; a link cannot gain authority because the tree is mounted and read as content only.
- **Rollback requires an image rebuild** → reverting the change restores the previous image; no runtime state or manifest is affected.

## Migration Plan

Rebuild and redeploy the image as the last step of the four-change sequence; deploy it together with the two co-released changes. An operator referencing `/opt/air/skills` points that reference at the configured `AGENT_SKILLS_DIR` root. Rollback is a reverting rebuild.

## Dependencies and Conflicts

| Change | Relationship | Code/spec overlap | Scheduling |
| --- | --- | --- | --- |
| `unify-skill-root-and-inventory` | Transitive dependency: it stops selecting the tree this change removes | container-packaging deltas, `Containerfile`, `docs/OMP_DISCOVERY.md` | After it |
| `align-omp-skill-trust-to-shared-root` | Required dependency: it stops declaring and trusting the tree this change removes | container-packaging deltas, `Containerfile`, `docs/OMP_DISCOVERY.md:93` | Immediately before this change; same release |
| `generate-opencode-skill-discovery-declaration` | None | None | Any order |

Shared files with the predecessor changes, edited sequentially in this order: `Containerfile` and `scripts/` (this change alone), `src/core/bundled-skills.ts` and `tests/core/bundled-skills.test.ts` (after `unify-skill-root-and-inventory`), and the documentation set `docs/OMP_PACKAGING.md`, `docs/OMP_DISCOVERY.md`, `AGENTS.md`, `docs/DEVELOPMENT.md`, `docs/USER-RUNTIME-VERIFICATION.md` (after `align-omp-skill-trust-to-shared-root`).

## Open Questions

None that would change the specs, the approach or the task breakdown.
