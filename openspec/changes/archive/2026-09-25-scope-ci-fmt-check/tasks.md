# Tasks

## 1. Task definition

- [x] 1.1 In `deno.json`, change `tasks.ci` to `deno task fmt:check && deno task lint && deno task check && deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi` (flag list preserved verbatim from the old task).

## 2. Verification

- [x] 2.1 On a clean tree, run `deno task ci` and verify it passes end-to-end on master — this is the bug this change fixes, so its passing is the regression proof. Verify the old task still fails (`deno fmt --check` alone reproduces the ~260-file failure). Verified: `deno task ci` exits 0 on a clean tree (`Task fmt:check` 253 files, `Task lint` 225 files, `Task check` clean, `ok | 2173 passed (42 steps) | 0 failed | 2 ignored`). Old first step `deno fmt --check` exits 1 (`Found 266 not formatted files in 814 files`) and the old second step `deno lint` also exits 1 (one `no-unused-vars` in `scripts/memory-recall-benchmark.ts`), so the pre-change `ci` could not pass at all.
- [x] 2.2 Verify failure propagation: introduce a temporary formatting violation in a file under `src/`, confirm `deno task ci` exits non-zero at the fmt step, and revert the file. Verified with `src/__fmt_probe.ts` (`const   x=1;`): `deno task ci` exits 1, the log shows the `Task fmt:check` banner and `error: Found 1 not formatted file in 254 files`, and contains no `Task lint`/`Task check`/test output — the `&&` chain stopped at the fmt step. Probe removed; `git status --porcelain` empty and `deno task fmt:check` exits 0 again.
- [x] 2.3 Confirm `.github/workflows/ci.yaml` needs no change: it still invokes `fmt:check`, `lint`, `check`, `test:unit`, `test:integration`, all unchanged. Verified: `git diff --exit-code master -- .github/workflows/` is empty and the file still runs `deno task fmt:check`, `deno task lint`, `deno task check`, `deno task test:unit`, `deno task test:integration`.
