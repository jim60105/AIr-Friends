# Tasks

Prerequisite: `convert-acp-policy-and-filesystem-to-bun` is applied. Verify with `test -f src/utils/runtime-platform.ts && test -f /lib/x86_64-linux-gnu/libc.so.6 -o -f /usr/lib/x86_64-linux-gnu/libc.so.6`.

Do not change any exported type, constant or function other than the body of `getRealLinuxNativeCalls()` and the module imports.

## 1. Backend

- [x] 1.1 Apply design D1. Verify: `grep -n 'Deno\.' src/acp/filesystem-access-linux.ts` prints only comments, and `git diff --stat src/acp/filesystem-access-linux.ts` shows changes only inside `getRealLinuxNativeCalls` and the import block (`git diff -U0` reviewed). No `Deno.` remains (grep prints nothing). `git diff --stat` reports 35 insertions/45 deletions in that one file; `git diff -U0` shows hunks only in the added import lines and inside `getRealLinuxNativeCalls` (the symbol table is a `symbolSpec` const in the function, so no module-level hunk).
- [x] 1.2 Confirm the real backend loads. Verify: `bun -e 'import { getRealLinuxNativeCalls } from "./src/acp/filesystem-access-linux.ts"; const r = getRealLinuxNativeCalls(); if (!r.calls) { console.error(r.error); process.exit(1) } console.log("ok")'` prints `ok`. Prints `ok` (exit 0) in the supported Debian 13.6 / bun 1.4.2 runtime (`localhost/air-friends-bun-poc:local`, the PoC image, same host kernel). The Fedora 44 host has no owned Debian libc path, so the same command there returns the designed fail-closed `secure_access_unavailable` for `/lib/x86_64-linux-gnu/libc.so.6` (exit 1).

## 2. Tests

- [x] 2.1 Convert both test files and add the two real-backend tests per design D2. Verify: `bun test tests/acp/filesystem-access-linux.test.ts tests/acp/filesystem-confinement.test.ts tests/acp/filesystem-access.test.ts tests/acp/filesystem-authorization.test.ts` passes with no deferred failure. 64 pass, 0 fail in the supported Debian / bun 1.4.2 runtime, including `Real backend - openat2 reports ELOOP for a symlink and EXDEV for an escape` and `Real backend - 10,000 alternating ENOENT and success with event-loop yields` executed against the real kernel. On the Fedora host the same command reports 62 pass, 2 skip, 0 fail: the two real-backend cases skip because the design's owned Debian libc path is absent, and no case is deferred. The codemod rewrote 14 and 35 sites with no manual entries; names and assertions are unchanged.
- [x] 2.2 Parity. Verify: `bun test --timeout=120000 --reporter=junit --reporter-outfile=.parity/ffi.xml tests/acp/filesystem-access-linux.test.ts tests/acp/filesystem-confinement.test.ts; (cd migration/bun/baseline && bun run --no-env-file parity.ts --junit .parity/ffi.xml --scope tests/acp/filesystem-access-linux.test.ts --scope tests/acp/filesystem-confinement.test.ts)` exits 0. Exit 0 in the supported Debian / bun 1.4.2 runtime: `baselineInScope 35, matched 35, missing [], failures [], deferred [], exceptionsApplied 0, invalidExceptions [], ok true`. Both new tests are absent from the Deno baseline by design, so no exception record is needed.

## 3. Housekeeping

- [x] 3.1 Verify: `bun run fmt:check` and `bun run lint` exit 0, and `git status --porcelain` lists only the files in `proposal.md` Impact and this change directory. Both exit 0. `git status --porcelain` lists `src/acp/filesystem-access-linux.ts`, `tests/acp/filesystem-access-linux.test.ts`, `tests/acp/filesystem-confinement.test.ts` and this change directory; `node_modules/`, `.parity/`, `.codegraph/` and `.omp-workspace-authorization.json` are ignored.
