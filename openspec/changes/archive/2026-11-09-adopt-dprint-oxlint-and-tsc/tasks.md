# Tasks

Prerequisite: `add-bun-package-manifest` is applied. Verify with `test -f package.json && test -f bun.lock && bun install --frozen-lockfile`.

Do not change code logic. Do not edit `migration/`, `Containerfile`, `deno.json`, `deno.lock` or `.github/`.

## 1. Formatter

- [x] 1.1 Add `dprint` as an exact `devDependency`, create `dprint.json` per design D1 with pinned plugin URLs, and add the `fmt` and `fmt:check` scripts. Verify: `bun install --frozen-lockfile` exits 0 after regenerating the lock, and `bunx dprint --version` prints a version.
- [x] 1.2 Run `bun run fmt:check`. If it reports files, run `bun run fmt`, then confirm both formatters agree. Verify: `bun run fmt:check` exits 0 and `deno fmt --check src/ tests/` exits 0 on the same tree.
- [x] 1.3 Confirm drift detection. Verify: change one indentation in `src/utils/hash.ts` to four spaces, observe `bun run fmt:check` exit non-zero naming the file, then restore it with `git checkout src/utils/hash.ts` (or undo if uncommitted) and observe exit 0.

## 2. Linter

- [x] 2.1 Add `oxlint` as an exact `devDependency`, create `.oxlintrc.json` per design D2 and add the `lint` script. Verify: `bunx oxlint --version` prints a version.
- [x] 2.2 Apply the directive rewrite table from design D2. Verify: `grep -rn 'deno-lint-ignore' src tests` prints nothing.
- [x] 2.3 Run `bun run lint`. Suppress each remaining finding with a next-line directive and list the file, line and rule in the task report. Verify: `bun run lint` exits 0.
- [x] 2.4 Confirm a missing directive fails. Verify: delete one `oxlint-disable-next-line typescript/no-explicit-any` line, observe `bun run lint` exit non-zero, restore it, observe exit 0.

## 3. Type check

- [x] 3.1 Add `typescript` as an exact `devDependency` and the `check` script per design D3. Verify: `bunx tsc --version` prints a version.
- [x] 3.2 Prove alias and Bun-type resolution on a scratch file. Verify: create `src/check-probe.ts` containing `import type { Logger } from "@utils/logger.ts"; export const v: string = Bun.version; export type P = Logger;`, run `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep check-probe` and see no output; then add `const n: number = "x";` to the probe, see that grep print an error; delete the probe. (TypeScript rejects any module specifier starting with `@types/` with TS6137, so the `@types/` alias cannot be exercised by `tsc`; another configured alias proves the same resolution.)

## 4. Housekeeping

- [x] 4.1 Verify scope: `git status --porcelain` lists only `package.json`, `bun.lock`, `dprint.json`, `.oxlintrc.json`, files under `src/` and `tests/` whose diff is formatting or lint directives only (`git diff --stat` reviewed), and this change directory.
