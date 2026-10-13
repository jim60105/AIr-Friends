# Tasks

## 1. One skill tree in the image

- [ ] 1.1 Delete the `owned-skills-stager` stage (`Containerfile:101-105`), delete `scripts/stage-owned-skills.ts` and remove the `/opt/air/skills` install instruction (`Containerfile:273`) together with the comments that explain the staged catalog (`:267-272`, `:95-100`). Keep the personal-tree COPY (`:265`) as the only skills tree. Verify: the Containerfile parses, `/opt/air/skills` appears nowhere in it, and the staged-tree assertions in `tests/core/bundled-skills.test.ts:161-188` are replaced by assertions that exactly one skills COPY exists and no second tree is installed.
- [ ] 1.2 Trim `src/core/bundled-skills.ts` to the collision and parity roles: remove the packaging claims from its header (`:13-16`) and keep `BUNDLED_SKILLS`, `RESERVED_SKILL_ENTRIES`, `collidesWithBundledContent` and `isBundledSkillName`. Verify: `deno task test:unit` over `tests/core/bundled-skills.test.ts` with the staging fixture (`:16`, `:54-107`) replaced by a container-image assertion, while the catalog parity (`:18-38`) and collision cases (`:40-42`) stay green.
- [ ] 1.3 Confirm the owned OMP artifact tree and manifest are untouched: `/opt/air/omp`, its `PACKAGE-MANIFEST.sha256` generation (`Containerfile:301-322`), the extension bundle contract and the pinned agent versions stay byte-identical. Verify: no diff in the manifest generation step and `deno task test:unit` over the packaging suite (`tests/utils/omp-packaging.test.ts`) stays green.

## 2. Packaging documentation

- [ ] 2.1 Rewrite `docs/OMP_PACKAGING.md:79` and the ownership rationale at `:88-100`: the image ships one skill tree at the personal root, the tree is agent-writable by design, and `/opt/air/skills` is gone; keep the `/opt/air/omp` rows and the manifest-scope statement. Verify: the documented layout lists exactly one skill tree and the manifest row set is unchanged.
- [ ] 2.2 Remove the remaining staged-root/stager references from `docs/OMP_DISCOVERY.md:93` (the declaration clauses were already rewritten by `align-omp-skill-trust-to-shared-root`), and correct the container section of `docs/DEVELOPMENT.md`/`AGENTS.md` if either enumerates the second tree. Verify: a search restricted to the shipped surfaces — `Containerfile`, `scripts/`, `src/`, `agent-config/`, `helm/`, `docs/`, `prompts/`, `config.example.yaml`, `.env.example` — returns no occurrence of `stage-owned-skills` or `/opt/air/skills`; test fixtures may keep the literal as data and are deliberately exempt.
- [ ] 2.3 Add the CHANGELOG entry for this change, naming the removed image tree and the one shared tree. Verify: the entry states the operator-visible image change.

## 3. Deployment documentation and runtime-acceptance rows

- [ ] 3.1 Update the runtime-acceptance rows in `docs/USER-RUNTIME-VERIFICATION.md` whose object was the owned skill tree (the OMP discovery row at `:61` and the owned skill-URI row at `:65` now name the deployment-resolved shared root), keeping each row's unverified status. Verify: every row that named `/opt/air/skills` names the resolved root instead and still reads unverified.

## 4. Integration verification

- [ ] 4.1 Run `deno task ci` once over the whole cutover and `openspec validate collapse-skill-packaging-to-one-tree --strict`; report only exercised results. Building or running the image, and the live both-agent `send-reply` acceptance, remain user-owned and unverified here.

## Workflow follow-up

- Apply only after `unify-skill-root-and-inventory` and `align-omp-skill-trust-to-shared-root`; then archive this change and sync its deltas into the main specs.
