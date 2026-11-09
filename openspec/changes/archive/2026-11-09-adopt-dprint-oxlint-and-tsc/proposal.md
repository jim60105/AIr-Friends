# Proposal

## Why

`deno fmt`, `deno lint` and `deno check` stop working once step 4 converts the tree, and the source design (section 5) names their replacements: dprint with the current style, oxlint, and `tsc --noEmit` with Bun types. Reformatting must land before the mass conversion so conversion diffs carry no formatting churn.

## What Changes

- Add dprint with the TypeScript, JSON and Markdown plugins configured with Deno's formatting profile and the `deno.json` `fmt` options, over `src/` and `tests/`.
- Add oxlint with rules that match the `deno lint` recommended set used today, and rewrite the 194 `deno-lint-ignore` comments to oxlint directives.
- Add `typescript` and a `check` script running `tsc --noEmit`. The script exists now; it passes only after step 6 (`enforce-bun-skill-approval-grammar` runs it as the step 6 exit gate).
- Add `fmt`, `fmt:check`, `lint` and `check` scripts to `package.json`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bun-toolchain`: this change adds requirements to the capability introduced by `add-bun-package-manifest` and
  modifies `Path Aliases Resolve Under Bun` (delta file `specs/bun-toolchain/spec.md`), because TypeScript rejects
  every module specifier beginning with `@types/` (TS6137), so the type checker cannot resolve that prefix.

## Impact

- New: `dprint.json`, `.oxlintrc.json`. Edited: `package.json`, `bun.lock`, and comment lines in `src/` and `tests/` (lint directives only, plus any formatting diff dprint produces).
- `deno.json` keeps its `fmt` and `lint` blocks until `migrate-ci-and-docs-to-bun` deletes the file.
- P0 ownership: none.
- No human review document.

## Batch:

depends-on: add-bun-package-manifest

Conflict note: edits comment lines across `src/` and `tests/`, so it must land before every step 4 change (`add-bun-conversion-codemod` and all `convert-*` changes). Shares `package.json` and `bun.lock` with the other step 3 changes; apply one at a time.
