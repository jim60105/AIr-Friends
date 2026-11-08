# Tasks

Prerequisite: `convert-acp-policy-and-filesystem-to-bun` is applied. Verify with `test -f src/utils/runtime-platform.ts && test -f /lib/x86_64-linux-gnu/libc.so.6 -o -f /usr/lib/x86_64-linux-gnu/libc.so.6`.

Do not change any exported type, constant or function other than the body of `getRealLinuxNativeCalls()` and the module imports.

## 1. Backend

- [ ] 1.1 Apply design D1. Verify: `grep -n 'Deno\.' src/acp/filesystem-access-linux.ts` prints only comments, and `git diff --stat src/acp/filesystem-access-linux.ts` shows changes only inside `getRealLinuxNativeCalls` and the import block (`git diff -U0` reviewed).
- [ ] 1.2 Confirm the real backend loads. Verify: `bun -e 'import { getRealLinuxNativeCalls } from "./src/acp/filesystem-access-linux.ts"; const r = getRealLinuxNativeCalls(); if (!r.calls) { console.error(r.error); process.exit(1) } console.log("ok")'` prints `ok`.

## 2. Tests

- [ ] 2.1 Convert both test files and add the two real-backend tests per design D2. Verify: `bun test tests/acp/filesystem-access-linux.test.ts tests/acp/filesystem-confinement.test.ts tests/acp/filesystem-access.test.ts tests/acp/filesystem-authorization.test.ts` passes with no deferred failure.
- [ ] 2.2 Parity. Verify: `bun test --timeout=120000 --reporter=junit --reporter-outfile=.parity/ffi.xml tests/acp/filesystem-access-linux.test.ts tests/acp/filesystem-confinement.test.ts; (cd migration/bun/baseline && bun run --no-env-file parity.ts --junit .parity/ffi.xml --scope tests/acp/filesystem-access-linux.test.ts --scope tests/acp/filesystem-confinement.test.ts)` exits 0.

## 3. Housekeeping

- [ ] 3.1 Verify: `bun run fmt:check` and `bun run lint` exit 0, and `git status --porcelain` lists only the files in `proposal.md` Impact and this change directory.
