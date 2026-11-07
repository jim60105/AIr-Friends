# Design

## Context

See `proposal.md` for motivation. The gate (`define-bun-go-no-go-gate`) evaluates evidence bound to a tree hash, so all final runs must use one unchanged `migration/bun/poc/` tree. The hash excludes evidence and record files, so committing them does not invalidate them. The evidence also binds `src/acp/filesystem-access-linux.ts`, `src/acp/command-syntax.ts` and `src/utils/ssrf.ts`, so a `master` security fix merged after the runs makes them stale. Because `feat/migrate-to-bun` is not pushed by this batch, the owner decides how the commit reaches the arm64 host.

## Goals / Non-Goals

**Goals:** one final run of each suite, a recorded outcome and proof that Deno is intact.

**Non-Goals:**

- No code, test or criterion change. If a run reveals a harness bug, stop and fix it in the owning `prove-*` change; final runs then restart from task 1.1.
- No closing of any P0 blocker. Boxes in the source design stay unchecked.
- No QEMU evidence for `aarch64`; the `ubuntu-24.04-arm` runner is native.
- No master unfreeze and no planning of steps 3 to 8.

Recorded deviation: the harness arch label is normalized here. `gate/run-in-container.ts` wrote `arch: machine()`, and Bun's `os.machine()` reports `arm64` on the arm64 runner while `gate/catalog.ts` and `evaluateCriterion` key on `aarch64`, so the gate silently dropped genuine arm64 evidence. `gate/evidence.ts` now exports `normalizeArch`, which the evidence writer and the `machine()`-keyed libc lookup in `suites/harness.spec.ts` both use; `x86_64` evidence keeps `arch: "x86_64"`. No criterion, threshold, suite behavior, catalog entry, `run-suite.sh` or `Containerfile` changes. The fix belongs to `build-bun-poc-harness`, which is already archived, so it ships here as this deviation and both architectures are re-captured from the new anchor.

## Decisions

### D1. Run order

All suites use the same `POC_SPAWN_BACKEND`, and the gate rejects a mismatch. If `.evidence-wip/x86_64/process.json` shows `bun`, export `POC_SPAWN_BACKEND=bun` for task 1.2. On x86_64, run `process`, `acp`, `acp-failure`, `ffi`, `ffi-enosys`, `egress`, `injection` and `injection-noconfig`. On aarch64, run `ffi` and `ffi-enosys`. Each writes `evidence/<arch>/<suite>.json`.

`run-suite.sh` needs `git`, `podman` and network access for the image build. It does not need Bun on the host. The script derives the output directory from `uname -m`, so the same command works on both architectures.

### D2. Outcome handling

`gate/record.ts` writes the record for either outcome and exits 0. A No-Go is a legitimate end state and is committed like a Go. The agent reports its blockers and stops; it neither fixes them nor reruns to change the result. A record listing only `missing` for `aarch64` means tasks 2.1 and 2.2 were not done, so task 3.1 must not run before them.

### D3. Deno check

Run with the repository root as working directory:

```bash
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/acp/filesystem-access-linux.test.ts tests/utils/egress-proxy.test.ts
deno test --no-run migration/
```

The first two must pass and the third must report "No test modules found". The isolation condition in the gate already covers changed paths; this adds a direct runtime check. It runs only these files because `capture-deno-baseline` recorded the full suite and no product file has changed since.

## Risks / Trade-offs

- [The arm64 runner cannot run the suites] → The run produces no evidence and the outcome stays blocked at task 2.2. Fix the workflow in `build-bun-poc-harness`. The agent must not substitute emulated evidence. Changing the catalog needs an owner decision through an OpenSpec change.
- [Pushing publishes the branch] → The repository is public, so task 2.1 scans before the push.
- [Network is down while building] → `podman build` uses its cache when the tree is unchanged, and otherwise the run stops before writing evidence.
