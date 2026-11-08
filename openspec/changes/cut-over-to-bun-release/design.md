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

`git grep -niE '\bdeno\b|deno\.|DENO_' -- . ':!CHANGELOG.md' ':!docs/superpowers/' ':!openspec/changes/archive/' ':!openspec/specs/'` prints nothing after the deletions. `openspec/specs/` is excluded because archived history and purposes there are maintained through OpenSpec; any remaining main-spec Deno mention is reported in the task report for a follow-up.

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

## Risks / Trade-offs

- [Archiving the `REMOVED` deltas leaves empty capability specs] → After archive, delete any `openspec/specs/<capability>/` directory left without requirements, in the archive commit.
- [A final gate fails] → Stop; do not delete `migration/bun/` until all gates pass, because the parity tool and drill live there.
