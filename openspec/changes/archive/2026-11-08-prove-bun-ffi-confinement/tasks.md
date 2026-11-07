# Tasks

Prerequisite: `migration/bun/poc/run-suite.sh` and `migration/bun/poc/gate/catalog.ts` exist. Verify with `test -x migration/bun/poc/run-suite.sh && test -f migration/bun/poc/gate/catalog.ts`.

Gate design D7 applies: a failing check is a result. Never weaken an assertion, threshold or size, and never edit the catalog. Do not edit product files, `Containerfile`, `run-suite.sh` or `gate/`. Do not commit `.evidence-wip/`.

## 1. Backend

- [x] 1.1 Create `migration/bun/poc/ffi/bun-linux-native-calls.ts` exactly as design D1 specifies. Verify: `podman build -f migration/bun/poc/Containerfile -t air-friends-bun-poc:local .` exits 0, then `podman run --rm --user 1000:0 air-friends-bun-poc:local bun -e 'import { createBunLinuxNativeCalls as c } from "/repo/migration/bun/poc/ffi/bun-linux-native-calls.ts"; const r = c(); if (!r.calls) throw new Error(JSON.stringify(r)); console.log("ok")'` prints `ok`.

## 2. Suites

- [x] 2.1 Create `suites/ffi-helpers.ts` per design D2. Verify: covered by 2.2.
- [x] 2.2 Create `suites/ffi.spec.ts` with tests titled `FFI-01:` to `FFI-07:` and `FFI-09:`, following the method table in design D2 and covering the scenarios of every requirement in this change's spec except "Unimplemented system call". Verify: `migration/bun/poc/run-suite.sh ffi` exits 0 and `.evidence-wip/x86_64/ffi.json` holds at least one test per ID. Report any failed ID.
- [x] 2.3 Create `suites/ffi-enosys.spec.ts` with tests titled `FFI-08:`, covering the scenario "Unimplemented system call". Verify: `migration/bun/poc/run-suite.sh ffi-enosys` exits 0 and `.evidence-wip/x86_64/ffi-enosys.json` holds a `FFI-08:` test. Report any failed ID.
- [x] 2.4 Confirm isolation. Verify: `git status --porcelain` lists only `migration/bun/poc/ffi/`, `migration/bun/poc/suites/` and this change directory.

## Workflow follow-up

- The arm64 run of these two suites is an operator step in `record-bun-go-no-go`.
