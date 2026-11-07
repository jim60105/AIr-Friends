# Design

## Context

See `proposal.md` for motivation. The gate (`define-bun-go-no-go-gate`) evaluates evidence bound to a tree hash, so all final runs must use one unchanged `migration/bun/poc/` tree. The hash excludes evidence and record files, so committing them does not invalidate them. The evidence also binds `src/acp/filesystem-access-linux.ts`, `src/acp/command-syntax.ts` and `src/utils/ssrf.ts`, so a `master` security fix merged after the runs makes them stale. Because `feat/migrate-to-bun` is not pushed by this batch, the owner decides how the commit reaches the arm64 host.

## Goals / Non-Goals

**Goals:** one final run of each suite, a recorded outcome and proof that Deno is intact.

**Non-Goals:**

- No code, test or criterion change. If a run reveals a harness bug, stop and fix it in the owning `prove-*` change; final runs then restart from task 1.1.
- No closing of any P0 blocker. Boxes in the source design stay unchecked.
- No QEMU evidence for `aarch64`.
- No master unfreeze and no planning of steps 3 to 8.

## Decisions

### D1. Run order

All suites use the same `POC_SPAWN_BACKEND`, and the gate rejects a mismatch. If `.evidence-wip/x86_64/process.json` shows `bun`, export `POC_SPAWN_BACKEND=bun` for task 1.2. On x86_64, run `process`, `acp`, `acp-failure`, `ffi`, `ffi-enosys`, `egress`, `injection` and `injection-noconfig`. On aarch64, run `ffi` and `ffi-enosys`. Each writes `evidence/<arch>/<suite>.json`.

`run-suite.sh` needs `git`, `podman` and network access for the image build. It does not need Bun on the host. The script derives the output directory from `uname -m`, so the same command works on both architectures.

### D2. Outcome handling

`gate/record.ts` writes the record for either outcome and exits 0. A No-Go is a legitimate end state and is committed like a Go. The agent reports its blockers and stops; it neither fixes them nor reruns to change the result. A record listing only `missing` for `aarch64` means task 2.1 was not done, so task 3.1 must not run before it.

### D3. Deno check

Run with the repository root as working directory:

```bash
deno check src/main.ts
deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys tests/acp/filesystem-access-linux.test.ts tests/utils/egress-proxy.test.ts
deno test --no-run migration/
```

The first two must pass and the third must report "No test modules found". The isolation condition in the gate already covers changed paths; this adds a direct runtime check. It runs only these files because `capture-deno-baseline` recorded the full suite and no product file has changed since.

## Risks / Trade-offs

- [No native arm64 host is available] → The outcome stays blocked at task 2.1. A full-system arm64 VM also qualifies, because its own kernel handles the system calls; qemu-user does not. An owner must supply a host or explicitly change the catalog through an OpenSpec change; the agent must not work around it.
- [Network is down while building] → `podman build` uses its cache when the tree is unchanged, and otherwise the run stops before writing evidence.
