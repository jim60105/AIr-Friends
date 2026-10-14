# Proposal

## Why

The image ships two skill trees. `Containerfile:265` copies the repository `skills/` tree to `/home/deno/.agents/skills` (`--chown=$UID:0 --chmod=775`, daemon-writable), and a dedicated `owned-skills-stager` stage (`:101-105`, running `scripts/stage-owned-skills.ts`) stages the bundled catalog plus `lib` into `/opt/air/skills` (`:273`, root-owned `0:0` `0755`). The second tree exists only to serve the OMP-specific owned root that `unify-skill-root-and-inventory` removes and `align-omp-skill-trust-to-shared-root` makes unnecessary: once both agent types resolve one configured root and OMP admits it, a separately packaged, catalog-filtered skill tree is dead weight that contradicts the single-install-location requirement and keeps a stale root in the image.

## What Changes

- Delete the `owned-skills-stager` stage, the `/opt/air/skills` install instruction and `scripts/stage-owned-skills.ts`. **BREAKING**: `/opt/air/skills` no longer exists in the image and is referenced by no code path, Containerfile instruction or manifest entry.
- Keep the personal-tree `COPY` (`COPY --link --chown=$UID:0 --chmod=775 skills/ /home/deno/.agents/skills/`) as the ONLY skills tree, which is also the tree external runtime installation publishes into.
- Reduce `src/core/bundled-skills.ts` to its two remaining roles — external-install collision protection and the authored source-parity fixture — and remove its packaging role.
- Keep the owned OMP artifact tree, its digest manifest scope (`/opt/air/omp` only), the extension bundle contract and the pinned agent versions exactly as they are.
- Rewrite the packaging documentation and the tests that pin the staged tree.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `container-packaging`: the frozen requirement `Owned Skill Image Excludes External Publication` and its scenarios (the `/opt/air/skills` install, the bundled-only staging filter and the root-owned owned skill root) are removed and replaced by the single-packaged-tree contract for both agent types.

## Impact

- Image build: `Containerfile` (stage and install instructions removed, personal-tree COPY retained).
- Code: `scripts/stage-owned-skills.ts` deleted; `src/core/bundled-skills.ts` roles trimmed.
- Documentation: `docs/OMP_PACKAGING.md` (the `/opt/air/skills` row and the ownership rationale), `docs/DEVELOPMENT.md`/`AGENTS.md` container sections that enumerate the image's skill trees, `docs/USER-RUNTIME-VERIFICATION.md` rows whose acceptance object is the owned skill tree; CHANGELOG.
- Tests: `tests/core/bundled-skills.test.ts` (staging and Containerfile assertions), plus the packaging parity fixture.
- **Depends on** `align-omp-skill-trust-to-shared-root`, which depends on `unify-skill-root-and-inventory`: removing the second tree is only safe once no code path selects, declares or trusts it.
