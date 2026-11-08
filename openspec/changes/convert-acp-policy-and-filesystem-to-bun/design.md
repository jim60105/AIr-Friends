# Design

## Context

See `proposal.md`. This change follows the standard step 4 procedure, design D6 of `add-bun-conversion-codemod`, copied into `migration/bun/convert/README.md` with the rewrite table (D3), the high-risk symbol owners (D4) and the manual guide (D5). Read that file before starting.

Observed in this slice: 671 `Deno.` matches. Manual hotspots:

- Stats/Dirent properties: `src/acp/filesystem-roots.ts` (30), `src/acp/omp/session-artifacts.ts` (18), `src/acp/skill-inventory.ts` (8), `src/acp/command-path-policy.ts` (2), `tests/acp/filesystem-test-calls.ts` (4), two more test files.
- `src/acp/skill-inventory.ts` declares `interface ... { lstat(path): Deno.FileInfo; readDir(path): Deno.DirEntry[]; realPath(path): string }` with default implementations `Deno.lstatSync`, `[...Deno.readDirSync(path)]`, `Deno.realPathSync`, and compares `ctime` (Deno truncates it to whole seconds; `fs.Stats.ctimeMs` is fractional). It catches `Deno.errors.NotFound` to tell an absent scripts directory from other errors.
- Monkeypatching: `tests/acp/filesystem-authorization.test.ts` and `tests/acp/omp-bash-artifact-authorization.test.ts` replace `Deno.realPath`.
- Test-side `Deno.Command`: `tests/acp/sandbox-manager.test.ts` (2), `tests/acp/skill-inventory.test.ts` (1). `Deno.FsFile`: `tests/acp/filesystem-test-calls.ts`.

## Goals / Non-Goals

**Goals:** every file in D1 runs under Bun with the conventions of `migration/bun/convert/README.md`; every baseline test of the D1 test files has a passing or deferred Bun counterpart.

**Non-Goals:**

- No change to test names, assertions, test intent or production behavior. A test that cannot keep its name gets a `parity-exceptions.json` entry with a reason, never a silent rename.
- No edit to any file outside D1 except `migration/bun/baseline/parity-exceptions.json`.
- No port of a high-risk symbol owned by a step 5 or step 6 change (README D4). Calls to those symbols stay, and the tests that reach them fail with `ReferenceError: Deno is not defined` until the owner lands.
- No grammar, interpreter or allowlist change in `skill-inventory.ts`; no confinement-list change.

## Decisions

### D1. File list

36 files: 17 production or script files, 16 test files and 3 test helpers.

```text
src/acp/omp/extension/index.ts
src/acp/omp/extension/native-registration.ts
src/acp/omp/destructive-ingress.ts
src/acp/omp/tool-inventory.ts
src/acp/omp/session-artifacts.ts
src/acp/session-config.ts
src/acp/command-syntax.ts
src/acp/destructive-policy.ts
src/acp/recovery-ownership.ts
src/acp/filesystem-confinement.ts
src/acp/sandbox-manager.ts
src/acp/filesystem-access.ts
src/acp/filesystem-policy.ts
src/acp/filesystem-roots.ts
src/acp/command-path-policy.ts
src/acp/skill-inventory.ts
src/acp/types.ts
tests/acp/session-config.test.ts
tests/acp/filesystem-test-calls.ts
tests/acp/command-path-canonical.test.ts
tests/acp/command-test-fixture.ts
tests/acp/permission-gate-generic.test.ts
tests/acp/opencode-skill-permission-routing.test.ts
tests/acp/skill-inventory-fixture.ts
tests/acp/skill-inventory.test.ts
tests/acp/destructive-policy.test.ts
tests/acp/filesystem-authorization.test.ts
tests/acp/omp-restricted-tool-decisions.test.ts
tests/acp/recovery-ownership.test.ts
tests/acp/sandbox-manager.test.ts
tests/acp/filesystem-access.test.ts
tests/acp/filesystem-policy.test.ts
tests/acp/filesystem-roots.test.ts
tests/acp/omp-bash-artifact-authorization.test.ts
tests/acp/omp-session-artifacts.test.ts
tests/acp/omp-native-registration.test.ts
```

### D2. Skill inventory stat seam

Retype the seam as `lstat(path: string): Stats; readDir(path: string): Dirent[]; realPath(path: string): string`, with defaults `fs.lstatSync(path)`, `fs.readdirSync(path, { withFileTypes: true })` and `fs.realpathSync(path)`. `statTuple` keeps its whole-second `ctime` comparison by computing `Math.floor(stat.ctimeMs / 1000) * 1000`, so the identity rule is unchanged; the existing comment about Deno's truncation is updated to say the truncation is now explicit. `Deno.errors.NotFound` → `isNotFoundError`. Test fixtures implementing the seam return Node `Stats`-shaped objects (methods `isFile()`, `isDirectory()`, `isSymbolicLink()`).

### D3. Realpath patches

`tests/acp/filesystem-authorization.test.ts` and `omp-bash-artifact-authorization.test.ts` replace `fsp.realpath` (production calls `fsp.realpath` after the codemod). Restore it in `finally`.

## Risks / Trade-offs

- [A converted test now fails for a reason other than a deferred symbol] → Fix the conversion, not the assertion. If the failure is a real Bun behavior difference, stop and report it with the failing test name; do not add an exception for a failing test.
- [A `Dirent` from `readdirSync(..., { withFileTypes: true })` reports `isSymbolicLink()` differently from Deno's `isSymlink` for a symlink to a directory] → Both report the link itself, not the target; the inventory tests with symlinked scripts are the check.
