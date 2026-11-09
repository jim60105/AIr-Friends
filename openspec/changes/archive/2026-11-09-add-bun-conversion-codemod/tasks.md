# Tasks

Prerequisite: `adopt-dprint-oxlint-and-tsc` and `add-bun-test-parity-check` are applied. Verify with `test -f dprint.json && test -f migration/bun/baseline/parity.ts && bun install --frozen-lockfile && test -d node_modules/typescript`.

Do not convert any existing `src/` or `tests/` file in this change.

## 1. Helper modules

- [x] 1.1 Create `src/utils/runtime-platform.ts` per design D2 and `tests/utils/runtime-platform.test.ts` (a `bun:test` file using `@std/assert`) with one test per `Architecture Name Normalization` and `Operating System Name Normalization` scenario, passing the machine or platform string as the argument. Verify: `bun test tests/utils/runtime-platform.test.ts` passes.
- [x] 1.2 Create `src/utils/fs-compat.ts` per design D1 and D2 and `tests/utils/fs-compat.test.ts` with one test per scenario of `Filesystem Error Classification`, `Path Removal Semantics`, `Temporary Path Creation` and `Path Existence`. For the permission scenario, create a directory with mode `0o000` and skip with `test.skipIf(process.getuid?.() === 0)` because root ignores modes. Verify: `bun test tests/utils/fs-compat.test.ts` passes.

## 2. Codemod

- [x] 2.1 Implement `migration/bun/convert/codemod.ts` per design D3 and D4. Verify: `bun run --no-env-file migration/bun/convert/codemod.ts --check tests/utils/hash.test.ts` prints one JSON line with `rewrites` greater than 0 and leaves the file unchanged (`git diff --quiet tests/utils/hash.test.ts`).
- [x] 2.2 Add `migration/bun/convert/codemod.spec.ts` with one test per scenario in `specs/bun-conversion-codemod/spec.md` and one test per row of the design D3 table, each feeding a source string to an exported `convertSource(text, fileName, options)` and comparing the output text. Verify: `bun test ./migration/bun/convert/codemod.spec.ts` passes (run from the repository root; if `bunfig.toml` `root` hides it, run `cd migration/bun/convert && bun test ./codemod.spec.ts`).
- [x] 2.3 Dry-run the codemod over the whole tree to size the manual work. Verify: `bun run --no-env-file migration/bun/convert/codemod.ts --check $(git ls-files 'src/*.ts' 'tests/*.ts' | grep -v '^src/dashboard/public/')` exits 0, and the task report lists the total `rewrites` and the ten most common `manual` reasons.

## 3. Reference note

- [x] 3.1 Write `migration/bun/convert/README.md` containing design D1, the D3 table, D4, D5 and D6 verbatim, plus the command lines. Verify: `grep -c '^| ' migration/bun/convert/README.md` is at least 40 (both tables present).

## 4. Housekeeping

- [x] 4.1 Verify: `bun run fmt:check` and `bun run lint` exit 0, and `git status --porcelain` lists only the seven new files from `proposal.md` Impact and this change directory.
