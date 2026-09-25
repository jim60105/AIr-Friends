## Context

Current task: `"ci": "deno fmt --check && deno lint && deno check src/main.ts && deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi"`. The GitHub Actions workflow runs `deno task fmt:check` (`deno fmt --check src/ tests/`), `deno task lint` (already `src/ tests/`-scoped), `deno task check`, then tests. Verified on master: the unscoped fmt step fails on ~260 unformatted non-code files (`assets/jieba/dict.txt.big`, JSON schemas, `docs/`, `prompts/`, `openspec/changes/archive/`).

## Goals / Non-Goals

**Goals:**
- `deno task ci` passes on a clean checkout of master and fails exactly when CI's fmt/lint/check scope would fail.
- Single source of scope: the `ci` task delegates to the existing scoped tasks (`fmt:check`, `lint`, `check`) instead of duplicating paths, so the local gate and the workflow cannot drift again.

**Non-Goals:**
- No `deno fmt` sweep of the ~260 non-code files, and no `.gitignore`/fmt-exclude list — vendored dictionaries and archived change artifacts must not be reformatted.
- No change to `.github/workflows/ci.yaml`, the `test` permission flags, or test sharding (the workflow's `test:unit`/`test:integration` split stays as-is; `ci` keeps running the full `deno test` as before).

## Decisions

- **Delegate to the scoped tasks** (`deno task fmt:check && deno task lint && deno task check && deno test …`) rather than repeat `src/ tests/` inline: any future scope change lands in one place. The test command stays verbatim so coverage of `tests/integration` in the local gate is unchanged.
- **Reformatting the strays was rejected**: the unformatted set is dominated by vendored/generated data where reformatting is either meaningless (`dict.txt.big`) or would rewrite archived records; the unscoped check was never the intended contract (the spec text "fmt check" never named a repo-wide scope).

## Risks / Trade-offs

- A file under `docs/` etc. that someone does want format-checked gains no gate — accepted; it had no passing gate before either, and CI never checked it.
- The lint step narrows together with the fmt step (unscoped `deno lint` → `deno task lint`, `src/ tests/`), so the 18 TypeScript files under `skills/**/scripts/`, `skills/lib/` and `scripts/` leave the local gate. Accepted for the same reason: the unscoped lint step also fails on master (one `no-unused-vars` in `scripts/memory-recall-benchmark.ts`), CI only ever ran the scoped `deno task lint`, and the proposal already frames `ci` as composing the workflow's commands.
- Task nesting (`deno task` inside `deno task`) adds negligible process overhead; behavior on failure (exit code propagation through `&&`) is identical.
