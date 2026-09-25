## Batch:
- id: scope-ci-fmt-check
- depends-on: (none)
- conflicts: none. Files touched (`deno.json`, the `configuration-and-deployment` spec delta) are untouched by `docs-recall-engine-alignment` and `remove-dead-memory-config`; can run in parallel with either.

## Why

`deno task ci` begins with an unscoped `deno fmt --check`, which fails on ~260 pre-existing unformatted files on master (vendored `assets/jieba/dict.txt.big`, JSON schemas, `docs/`, `prompts/`, `openspec/` archives) — several Memory Recall v2 workers reported the local gate as unpassable and had to fall back to the CI-equivalent commands. GitHub Actions already uses the path-scoped `deno task fmt:check` (`src/ tests/`), so the unscoped step checks nothing CI checks and blocks the one gate developers are told to run locally (AGENTS.md contribution checklist item 6).

## What Changes

- Change the `ci` task in `deno.json` from `deno fmt --check && deno lint && deno check src/main.ts && deno test ...` to compose the existing scoped tasks: `deno task fmt:check && deno task lint && deno task check && deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi`. This matches the exact commands `.github/workflows/ci.yaml` runs (`fmt:check`, `lint`, `check`; `lint`/`fmt:check` are already `src/ tests/`-scoped).
- No repo-wide formatting sweep of the 260 unformatted files (deliberate: vendored dictionaries and archived artifacts should not churn), no change to the workflow file.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `configuration-and-deployment`: "Deno Project Structure" — the `ci` task scenario pins fmt-checking and linting to the `src/` and `tests/` scopes (matching `fmt:check` and `lint`), so the local gate is passable on master.

## Impact

- **Build**: `deno.json` `tasks.ci` (one line).
- **Workflow**: none — `.github/workflows/ci.yaml` already calls the scoped tasks.
- **Developer workflow**: `deno task ci` becomes usable locally and usable in change tasks as a single gate again.
