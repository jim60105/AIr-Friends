# Proposal

## Why

The Go record (`migration/bun/poc/GO-NO-GO.md`) lets the migration proceed to design section 8 step 3. Nothing in the repository can be installed, resolved or tested by Bun yet: dependencies, path aliases and test settings live only in `deno.json` (source design `docs/superpowers/specs/2026-11-07-bun-runtime-migration-design.md`, section 5). Every later conversion change needs this manifest first.

## What Changes

- Add `package.json` with every runtime dependency from `deno.json` pinned to the exact version in `deno.lock`, Vento from npm `ventojs@2.2.0`, the `yaml` package replacing `@std/yaml`, and `@std/assert` and `@std/testing` as `@jsr/*` aliases.
- Add `bun.lock` (frozen), `bunfig.toml` (JSR scope registry, exact installs) and `tsconfig.json` (`paths` for `@core/`, `@platforms/`, `@skills/`, `@types/`, `@utils/`, `@acp/`; Bun types).
- Add `package.json` scripts that replace the `deno task` entries one for one. Start scripts pass `--no-env-file` and the repository `bunfig.toml` explicitly (design section 4.5).
- Prove `@node-rs/jieba` loads and tokenizes under Bun on x86_64, and that `bun.lock` records both Linux GNU native packages (part of P0-9).
- `deno.json` and `deno.lock` stay in place. Deno still runs the unconverted tree until step 4 finishes; `migrate-ci-and-docs-to-bun` deletes them.

## Capabilities

### New Capabilities

- `bun-toolchain`: how the repository declares, installs and resolves its Bun dependencies, aliases and test settings.

### Modified Capabilities

- `configuration-and-deployment`: removes `Deno Project Structure` and `Deno Runtime with Explicit Permissions`, which `bun-toolchain` replaces. Bun has no permission flags.

## Impact

- New: `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.json`. Edited: `.gitignore`.
- No `src/`, `tests/` or `migration/` file changes. `bun test` does not pass yet; step 4 converts the tree.
- P0 ownership: part of P0-9 (x86_64 native load of `@node-rs/jieba`, both architectures locked). The arm64 run belongs to `package-bun-container-image` and `migrate-ci-and-docs-to-bun`.
- No human review document: every requirement is established by commands or tests.

## Batch:

depends-on: none (first step 3 change; requires the Go outcome recorded at `migration/bun/poc/GO-NO-GO.md`)

Conflict note: `adopt-dprint-oxlint-and-tsc`, `bundle-omp-extension-with-bun`, `add-bun-test-parity-check` and `add-bun-conversion-codemod` all add `devDependencies` or `scripts` to `package.json` and regenerate `bun.lock`. Apply them after this change, one at a time.
