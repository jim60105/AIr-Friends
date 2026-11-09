# Design

## Context

See `proposal.md`. Observed facts:

- Version `0.36.1` appears in `deno.json` (deleted by `migrate-ci-and-docs-to-bun`), `package.json` (added by `add-bun-package-manifest`), `helm/Chart.yaml` `appVersion` (chart `version` 0.21.0) and `CHANGELOG.md`. Release commits are titled `chore(release): vX.Y.Z`. `CHANGELOG.md` follows Keep a Changelog with an `[Unreleased]` section.
- Breaking items collected from the batch: Bun runtime and image base (`package-bun-container-image`); `HOME` `/home/air` and `AGENT_SKILLS_DIR` under `/home/air` (`rename-deno-runtime-identifiers`, `package-bun-container-image`); `ENV` replaces `DENO_ENV` (`rename-deno-runtime-identifiers`); skills accept only the direct and literal `bun run` forms and `opencode.json` routes `bun *`/denies `bunx *` (`enforce-bun-skill-approval-grammar`); `binary:bun` in readiness checks (`port-http-servers-to-bun-serve`); `bundle-omp-extension.sh` takes two arguments (`bundle-omp-extension-with-bun`); line-coverage floor replaces branch coverage (`migrate-ci-and-docs-to-bun`).
- Rollback reference: `ghcr.io/jim60105/air-friends@sha256:fad837549aaeeadb7ac6be51d58cdb2f25c3effb0dedc8abbf0eb32df93b0059` with `env.DENO_ENV` and `AGENT_SKILLS_DIR=/home/deno/.agents/skills`.

## Goals / Non-Goals

**Goals:** final gates on the final tree; recorded evidence; no Deno dependency in the repository; release prepared.

**Non-Goals:**

- No merge, tag, push or ArgoCD change (owner).
- No code change except what a failing final gate requires; a failing gate stops this change and is fixed in a follow-up to the owning change.

## Decisions

### D1. Final Deno reference check

Runtime independence is the invariant: no shipped code, configuration, image or workflow depends
on Deno. These checks must all print nothing after the deletions:

```bash
git grep -niE '(^#!.*deno)|(\bdeno[[:space:]]+run\b)' -- skills scripts src .github/workflows
git grep -niE '\bdeno\b' -- package.json
git grep -niE '\bdeno\b' -- Containerfile agent-config helm bunfig.toml tsconfig.json .env.example config.example.yaml
git grep -nE '\bDENO_' -- src skills scripts agent-config helm Containerfile bunfig.toml tsconfig.json package.json .github/workflows
git grep -niE '\bdeno\.(json|lock)\b' -- src skills scripts .github/workflows Containerfile package.json bunfig.toml tsconfig.json
```

Together with the passing `bun install --frozen-lockfile`, format check, lint and type check, they
prove that no load-bearing Deno dependency remains.

The reference inventory
`git grep -niE '\bdeno\b|deno\.|DENO_' -- . ':!CHANGELOG.md' ':!docs/superpowers/' ':!openspec/changes/archive/' ':!openspec/specs/'`
is then run as an inventory, and every hit is classified into exactly one of these classes, with a
count and example path in the task report:

1. this active change's own artifacts;
2. a security-negative assertion that a Deno-era value is absent or ignored;
3. a test fixture that exercises a legacy Deno artifact;
4. a comment documenting preserved behavior or migration rationale;
5. formatter or tool configuration (dprint's Deno-style mode);
6. historical material excluded by this inventory (changelog, `docs/superpowers/`, archived
   changes, `openspec/specs/`).

A hit that fits none of these classes is a failure: fix it or stop. No hit may be deleted merely
to make the inventory quieter; negative assertions, fixtures and comments stay. `openspec/specs/`
is excluded because archived history and purposes there are maintained through OpenSpec; any
remaining main-spec Deno mention is reported in the task report for a follow-up.

The check was amended on 2026-11-10 with supervisor authorization; see Recorded deviations.

### D2. Evidence and checklist

Before deleting `migration/bun/`, copy into the changelog entry: the parity result totals (baseline 3,836; matched; exceptions by disposition), the drill `compare.ts` output, and the rollback drill result. In section 9 of the design document, change each `- [ ]` to `- [x]` and append the owning change names and the CI run URL from `migrate-ci-and-docs-to-bun`. A box whose evidence is missing stays unticked and stops the change.

### D3. Changelog entry

```markdown
## [0.37.0] - <date>

### Changed
- **BREAKING**: The runtime is Bun 1.4.2 (image base `oven/bun:1.4.2-debian` pinned by digest); Deno is no longer used.
- ... one bullet per breaking item from design Context ...

### Migration
- Set `env.ENV` instead of `env.DENO_ENV`, and move any custom `AGENT_SKILLS_DIR` under `/home/air` (Helm values and ArgoCD parameters).
- Rollback: deploy `ghcr.io/jim60105/air-friends@sha256:fad8375…0059` with the previous parameters. Persisted `/app/data` formats are unchanged.

### Verification
- Test parity, drill comparison and rollback drill summaries (design D2).
```

The existing `[Unreleased]` item stays under `[Unreleased]`.

## Recorded deviations

- **D1 evidence check amended (supervisor-authorized, 2026-11-10).** The original D1 expected the
  inventory command to print nothing after the deletions. That result is unattainable without
  weakening the tree: the inventory's path set includes this change's own design, proposal, tasks
  and spec deltas, the security suite deliberately asserts that Deno-era values are absent (for
  example `DENO_DIR` in `tests/acp/agent-connector-env-isolation.test.ts`), hostile Deno
  shebangs and user names appear as fixtures, and comments document preserved Deno semantics.
  Deleting those would weaken assertions or destroy rationale. The amended check proves runtime
  independence directly and requires every inventory hit to be classified into the six recorded
  evidence classes; the deviation is why the task report shows a non-empty inventory.
- **Local gate composition (non-root host).** Tasks 1.1 and 1.2 assume a host that provides the
  image's trusted config and a clean environment. This host is non-root and has no
  `/opt/air/skill-bunfig.toml`, so the four trusted-config suites (`tests/acp/skill-injection`,
  `tests/skills/scripts`, `tests/skills/end-to-end-delivery`, `tests/skills/staging-compat`) ran
  inside the final image, while the remaining 203 test files ran on the host with
  `--no-env-file --isolate` in a minimal environment and an isolated `XDG_CACHE_HOME` holding the
  pinned `18.6.1` payload. The two JUnit reports were merged into one report for parity. The image
  smoke and the final image ran exactly as task 1.3 states. CI runs the literal commands.

## Risks / Trade-offs

- [Archiving the `REMOVED` deltas leaves empty capability specs] → After archive, delete any `openspec/specs/<capability>/` directory left without requirements, in the archive commit.
- [A final gate fails] → Stop; do not delete `migration/bun/` until all gates pass, because the parity tool and drill live there.
