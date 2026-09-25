# Tasks

## 1. Task definition

- [ ] 1.1 In `deno.json`, change `tasks.ci` to `deno task fmt:check && deno task lint && deno task check && deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi` (flag list preserved verbatim from the old task).

## 2. Verification

- [ ] 2.1 On a clean tree, run `deno task ci` and verify it passes end-to-end on master — this is the bug this change fixes, so its passing is the regression proof. Verify the old task still fails (`deno fmt --check` alone reproduces the ~260-file failure).
- [ ] 2.2 Verify failure propagation: introduce a temporary formatting violation in a file under `src/`, confirm `deno task ci` exits non-zero at the fmt step, and revert the file.
- [ ] 2.3 Confirm `.github/workflows/ci.yaml` needs no change: it still invokes `fmt:check`, `lint`, `check`, `test:unit`, `test:integration`, all unchanged.
