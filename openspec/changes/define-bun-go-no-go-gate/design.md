# Design

## Context

See `proposal.md` for motivation. Observed facts:

- The host is Fedora, with libc only at `/lib64/libc.so.6`, while `src/acp/filesystem-access-linux.ts` owns `/lib/x86_64-linux-gnu/libc.so.6` and `/lib/aarch64-linux-gnu/libc.so.6`. Real backend proof therefore needs a Debian userland, so the suites run in a container.
- `docker.io/oven/bun:1.4.2-debian` resolves to index digest `sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73`, covering amd64 and arm64. A throwaway run with the flags in D3 worked on the host: UID 1000, GID 0, a writable `:Z` mount, and `openat2` reachable from `bun:ffi`.
- The host's `opencode` (1.18.23) and `omp` (18.18.0) are newer than the pins `1.18.21` and `18.6.1` in the root `Containerfile`. The image installs the pinned releases.
- `deno.lock` pins `@agentclientprotocol/sdk` 0.14.1 with `zod` 4.4.3.
- `bun test --reporter=junit --reporter-outfile=<f>` emits nested `<testsuite>` elements for `describe` blocks and marks skips with `<skipped />`.
- `.containerignore` patterns such as `*.md` and `node_modules/` match at the context root only, so nested paths reach the image unless removed.
- Bare `deno test` does not discover `*.spec.ts`.

## Goals / Non-Goals

**Goals:** fix the criteria before any result exists; make Go impossible without bound evidence; keep every proof-of-concept file under `migration/bun/poc/`.

**Non-Goals:**

- No checks here; the `prove-*` changes implement them.
- No edit to product files, CI, `.gitignore` or `.containerignore`.
- No type-check, lint or format setup for `migration/`.
- A Go result closes no P0 blocker. The suites exercise proof-of-concept copies, and each P0 blocker is re-proved against the migrated product in the later plan.

## Decisions

### D1. Layout

```text
migration/bun/poc/.gitignore            # node_modules/ and .evidence-wip/
migration/bun/poc/package.json
migration/bun/poc/bun.lock
migration/bun/poc/Containerfile
migration/bun/poc/run-suite.sh
migration/bun/poc/fixtures/deny-openat2.json
migration/bun/poc/gate/catalog.ts       # pins, P0 list, criteria, deferrals, suites
migration/bun/poc/gate/evidence.ts      # collect from JUnit, tree hash, binding check
migration/bun/poc/gate/evaluate.ts      # pure evaluation
migration/bun/poc/gate/record.ts        # CLI: evaluate and write records
migration/bun/poc/gate/verify-record.ts # CLI
migration/bun/poc/gate/run-in-container.ts # CLI inside the image
migration/bun/poc/gate/gate.spec.ts
migration/bun/poc/suites/harness.spec.ts
```

Later changes add `suites/<suite>.spec.ts` and their own subdirectories. Tests use `.spec.ts` so Deno never discovers them. Everything else outside these files is unchanged by this change.

### D2. Catalog (verbatim)

```ts
export const POC_PINS = {
  bunVersion: "1.4.2",
  bunRevisionPrefix: "744846f84",
  baseImageDigest: "sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73",
  opencodeVersion: "1.18.21",
  ompVersion: "18.6.1",
} as const;
export type Arch = "x86_64" | "aarch64";
export type SuiteName = "process" | "acp" | "ffi" | "ffi-enosys" | "egress" | "injection" | "injection-noconfig";
export type P0Id = "P0-1" | "P0-2" | "P0-3" | "P0-4" | "P0-5" | "P0-6" | "P0-7" | "P0-8" | "P0-9" | "P0-10";
export interface Criterion { id: string; p0: P0Id; suite: SuiteName; archs: readonly Arch[]; check: string }
export interface Deferral { p0: P0Id; scope: string; owner: string }
```

P0 identifiers follow the order of the list in design section 9: 1 child environments, 2 ACP transport, 3 process cleanup, 4 `openat2`/`statx`, 5 egress proxy, 6 injection suite, 7 sandbox detection, 8 restart persistence, 9 native dependencies, 10 CI and rollback. `id` matches `^[A-Z]+-\d{2}(-[A-Z]+)?$`.

Criteria. `check` holds the Check column text.

| ID | P0 | Suite | Archs | Check |
| --- | --- | --- | --- | --- |
| PROC-01 | P0-2 | process | x86_64 | With the consumer stalled for 1 s, a producer child stops advancing and parent RSS grows under 32 MiB |
| PROC-02 | P0-2 | process | x86_64 | A write to a child that does not read stays pending, then completes after the child starts reading |
| PROC-03 | P0-2 | process | x86_64 | 64 MiB through `cat` returns byte-identical by SHA-256 |
| PROC-04 | P0-2 | process | x86_64 | A child writing 8 MiB to stderr while writing stdout finishes with both streams fully read |
| PROC-05 | P0-2 | process | x86_64 | Closing stdin ends `cat`, stdout reaches done, and `exited` reports code 0 |
| PROC-06 | P0-1 | process | x86_64 | The child's real environment holds exactly the passed variables and no parent sentinel |
| PROC-07 | P0-3 | process | x86_64 | SIGTERM through `dumb-init` ends the child, `exited` resolves, and no descendant remains |
| PROC-08 | P0-3 | process | x86_64 | With a child ignoring SIGTERM, SIGKILL is sent after 2000 ms and the wrapper's exit is observed by 2500 ms |
| PROC-09 | P0-3 | process | x86_64 | After 20 spawn and teardown cycles the open descriptor count is within 2 of the start and no descendant remains |
| ACP-01-OC, ACP-01-OMP | P0-2 | acp | x86_64 | Handshake, session and prompt complete with stop reason `end_turn` and the scripted text |
| ACP-02-OC, ACP-02-OMP | P0-2 | acp | x86_64 | 16 MiB of agent output arrives byte-identical by SHA-256 |
| ACP-03-OC, ACP-03-OMP | P0-2 | acp | x86_64 | A 1 MiB prompt reaches the provider intact |
| ACP-04-OC, ACP-04-OMP | P0-2 | acp | x86_64 | With a 3 s consumer stall, 4 MiB of agent output arrives byte-identical by SHA-256 |
| ACP-05-OC, ACP-05-OMP | P0-2 | acp | x86_64 | `session/cancel` during streaming ends the prompt with stop reason `cancelled` within 5 s |
| ACP-06-OC, ACP-06-OMP | P0-2 | acp | x86_64 | With a stalled provider, a 3 s client timeout rejects the call and teardown completes |
| ACP-07-OC, ACP-07-OMP | P0-2 | acp | x86_64 | SIGKILL of the agent during streaming rejects the pending prompt within 3 s and `exited` resolves |
| ACP-08-OC, ACP-08-OMP | P0-2 | acp | x86_64 | After teardown stdout reaches done and the ACP connection closes within 5 s |
| ACP-09-OC, ACP-09-OMP | P0-1 | acp | x86_64 | The real agent environment holds the required variables and no parent sentinel |
| ACP-10-OC, ACP-10-OMP | P0-3 | acp | x86_64 | SIGTERM teardown of the real agent leaves no descendant |
| FFI-01 | P0-4 | ffi | x86_64, aarch64 | A symlink component yields `ELOOP` and the failure reason `unsafe_traversal` |
| FFI-02 | P0-4 | ffi | x86_64, aarch64 | A directory escape yields `EXDEV` and the failure reason `outside_roots` |
| FFI-03 | P0-4 | ffi | x86_64, aarch64 | A missing target yields `ENOENT` and the production failure reason for its phase |
| FFI-04 | P0-4 | ffi | x86_64, aarch64 | 10,000 alternating failures with event-loop yields produce no errno mismatch |
| FFI-05 | P0-4 | ffi | x86_64, aarch64 | `statx` type, inode and device agree with `node:fs` for a file and a directory |
| FFI-06 | P0-4 | ffi | x86_64, aarch64 | Read, exclusive create and overwrite round trip real files through `performLinuxSecureAccess` |
| FFI-07 | P0-4 | ffi | x86_64, aarch64 | An absent or unloadable libc fails closed with `secure_access_unavailable` |
| FFI-08 | P0-4 | ffi-enosys | x86_64, aarch64 | `ENOSYS` from `openat2` fails closed with `secure_access_unavailable` |
| FFI-09 | P0-4 | ffi | x86_64, aarch64 | 1,000 mixed operations leave the open descriptor count unchanged |
| EGR-01 | P0-5 | egress | x86_64 | A and AAAA answers are both consulted and any disallowed answer denies |
| EGR-02 | P0-5 | egress | x86_64 | Metadata addresses stay blocked, including for an allowlisted host |
| EGR-03 | P0-5 | egress | x86_64 | The upstream connection uses the validated IP with no second resolution |
| EGR-04 | P0-5 | egress | x86_64 | A CONNECT tunnel carries 32 MiB each way byte-identical by SHA-256 |
| EGR-05 | P0-5 | egress | x86_64 | A half-close is forwarded and the opposite direction keeps working until it ends |
| EGR-06 | P0-5 | egress | x86_64 | Plain HTTP is rewritten to origin form with `Connection: close`, and a pipelined second request is not answered |
| EGR-07 | P0-5 | egress | x86_64 | Allowlist exemption, neighbor rejection and malformed-entry rules hold |
| EGR-08 | P0-5 | egress | x86_64 | Refused, malformed and unreachable targets return 403, 400 and 502 |
| INJ-01 | P0-6 | injection | x86_64 | `.env` and `.env.local` in the working directory change nothing, in both invocation forms |
| INJ-02 | P0-6 | injection | x86_64 | `bunfig.toml` in the working directory changes nothing, in both invocation forms |
| INJ-03 | P0-6 | injection | x86_64 | `tsconfig.json`, `package.json` and `node_modules` in the working directory change nothing, in both invocation forms |
| INJ-04 | P0-6 | injection | x86_64 | The approval grammar denies a `BUN_OPTIONS` command prefix |
| INJ-05 | P0-6 | injection | x86_64 | The approval grammar accepts exactly the two invocation forms and denies every other flag |
| INJ-06 | P0-6 | injection | x86_64 | `/opt/air/skill-bunfig.toml` is empty, root-owned and read-only |
| INJ-07 | P0-6 | injection | x86_64 | A `.bunfig.toml` in `$HOME` or `$XDG_CONFIG_HOME` changes nothing, in both invocation forms |
| INJ-08 | P0-6 | injection-noconfig | x86_64 | With the config file missing, neither the skill nor the attacker preload runs, in both invocation forms |

A row with two IDs is two catalog entries that share the Check text.

Deferrals. These stay open after a Go.

| P0 | Scope | Owner |
| --- | --- | --- |
| P0-3 | Container stop, pool cleanup, restart | Step 5 and step 8 |
| P0-7 | All of sandbox detection and fail-closed behavior | Steps 5 to 7 |
| P0-8 | All of restart persistence | Step 8 |
| P0-9 | All of native dependencies and external tools | Steps 3 and 7 |
| P0-10 | All of CI, container deployment and the rollback drill | Steps 7 and 8 |

The `P0_BLOCKERS` constant holds the ten identifiers with one short label each.

Decision rationale: only FFI runs on both architectures because the design calls out architecture differences there (`O_DIRECTORY`, `O_NOFOLLOW`) and P0-4 names both. Native-dependency behavior on arm64 is P0-9 and is deferred.

### D3. Image and run script

`Containerfile`, built with the repository root as context:

```dockerfile
FROM docker.io/oven/bun@sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73
ARG OPENCODE_VERSION=1.18.21
ARG OPENCODE_SHA256_X64=d910c3ed7613bb5791a328904615d41cc25b7d3a6b470e3199ab0426a995b38a
ARG OPENCODE_SHA256_ARM64=d30d2cba74617f4e7b96e25563c9572ffe453f9eae70fc0df16286813537ee72
ARG OMP_VERSION=18.6.1
ARG OMP_SHA256_X64=c92a6846d02984e84f07c6362d18add3783f528f494ffcf1e0f26e594f327463
ARG OMP_SHA256_ARM64=cb7815330bb117877e4e133562ea82e3001ee470e47393552507b5a7f0407f4a
ENV POC_BASE_IMAGE_DIGEST=sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl dumb-init && \
    case "$(dpkg --print-architecture)" in \
      amd64) OC=x64; OC_SHA="${OPENCODE_SHA256_X64}"; OMP=x64; OMP_SHA="${OMP_SHA256_X64}" ;; \
      arm64) OC=arm64; OC_SHA="${OPENCODE_SHA256_ARM64}"; OMP=arm64; OMP_SHA="${OMP_SHA256_ARM64}" ;; \
      *) exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-${OC}.tar.gz" -o /tmp/opencode.tgz && \
    echo "${OC_SHA}  /tmp/opencode.tgz" | sha256sum -c - && \
    mkdir -p /tmp/oc && tar -xzf /tmp/opencode.tgz -C /tmp/oc && mv /tmp/oc/opencode /usr/local/bin/opencode && \
    curl -fsSL "https://github.com/can1357/oh-my-pi/releases/download/v${OMP_VERSION}/omp-linux-${OMP}" -o /usr/local/bin/omp && \
    echo "${OMP_SHA}  /usr/local/bin/omp" | sha256sum -c - && \
    chmod 755 /usr/local/bin/omp /usr/local/bin/opencode && \
    rm -rf /tmp/opencode.tgz /tmp/oc && \
    install -d -m 755 -o 0 -g 0 /opt/air && install -m 444 -o 0 -g 0 /dev/null /opt/air/skill-bunfig.toml
COPY src/acp/filesystem-access-linux.ts /repo/src/acp/filesystem-access-linux.ts
COPY src/acp/command-syntax.ts /repo/src/acp/command-syntax.ts
COPY src/utils/ssrf.ts /repo/src/utils/ssrf.ts
COPY migration/bun/poc/ /repo/migration/bun/poc/
WORKDIR /repo/migration/bun/poc
RUN rm -rf node_modules evidence .evidence-wip GO-NO-GO.md GO-NO-GO.json && bun install --frozen-lockfile
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
```

The three `src/` files are copied at matching relative paths so `import` statements from `migration/bun/poc/` reach real production code. Their type-only imports are erased by Bun, so no other source file is needed.

`run-suite.sh <suite> [--final]`:

```bash
#!/usr/bin/env bash
set -euo pipefail
suite="${1:?usage: run-suite.sh <suite> [--final]}"
mode="${2:-}"
repo_root="$(git rev-parse --show-toplevel)"
poc_dir="${repo_root}/migration/bun/poc"
arch="$(uname -m)"
out_root=".evidence-wip"
if [[ "${mode}" == "--final" ]]; then out_root="evidence"; fi
out_dir="${poc_dir}/${out_root}/${arch}"
mkdir -p "${out_dir}"
image="air-friends-bun-poc:local"
extra=()
case "${suite}" in
  ffi-enosys) extra+=(--security-opt "seccomp=${poc_dir}/fixtures/deny-openat2.json") ;;
  injection-noconfig) extra+=(--tmpfs "/opt/air:rw,mode=0755") ;;
  harness|process|acp|ffi|egress|injection) ;;
  *) echo "unknown suite: ${suite}" >&2; exit 2 ;;
esac
podman build --quiet -f "${poc_dir}/Containerfile" -t "${image}" "${repo_root}" >/dev/null
podman run --rm --network=none --cap-drop=ALL --security-opt=no-new-privileges \
  --userns=keep-id:uid=1000,gid=1000 --user 1000:0 \
  --env "POC_GIT_HEAD=$(git rev-parse HEAD)" \
  --env "POC_IMAGE_ID=$(podman image inspect --format '{{.Id}}' "${image}")" \
  --env "POC_SPAWN_BACKEND=${POC_SPAWN_BACKEND:-node}" \
  -v "${out_dir}:/evidence:Z" "${extra[@]}" "${image}" \
  bun run --no-env-file /repo/migration/bun/poc/gate/run-in-container.ts "${suite}"
```

The flags mirror production (`cap_drop: [ALL]`, `no-new-privileges`, UID 1000, GID 0, `dumb-init` as PID 1), and `--network=none` keeps every run on loopback. A throwaway check confirmed OpenCode completes an ACP prompt against a loopback provider with no external network.

Work-in-progress runs go to the git-ignored `.evidence-wip/`. Only `--final` writes the committed `evidence/` directory, because any later code change invalidates earlier evidence through the tree hash.

`fixtures/deny-openat2.json`:

```json
{ "defaultAction": "SCMP_ACT_ALLOW", "syscalls": [{ "names": ["openat2"], "action": "SCMP_ACT_ERRNO", "errnoRet": 38 }] }
```

### D4. Evidence

```ts
export interface EvidenceTest { name: string; status: "passed" | "failed" | "skipped" }
export interface SuiteEvidence {
  schemaVersion: 1;
  suite: string;
  arch: string;              // `uname -m` value
  kernel: string;
  bunVersion: string;        // Bun.version
  bunRevision: string;       // Bun.revision
  baseImageDigest: string;   // POC_BASE_IMAGE_DIGEST
  opencodeVersion: string;   // parsed from `opencode --version`
  ompVersion: string;        // parsed from `omp --version`, which prints `omp/<version>`
  pocTreeSha256: string;
  gitHead: string;           // report only
  imageId: string;           // report only
  capturedAt: string;
  observations: Record<string, unknown>;
  tests: EvidenceTest[];
}
```

`run-in-container.ts <suite>`:

1. Set `POC_OBSERVATIONS_FILE=/tmp/observations.jsonl`, then run `bun test --timeout=120000 --reporter=junit --reporter-outfile=/tmp/junit.xml ./suites/<suite>.spec.ts` with working directory `/repo/migration/bun/poc`. Print its output through.
2. No JUnit file: exit 2 and write nothing. Otherwise write `/evidence/<suite>.json` and exit 0, whatever `bun test` returned.

Suites call `observe(key, value)` from `gate/evidence.ts`, which appends one JSON line to `POC_OBSERVATIONS_FILE`. `observations` holds the last value per key. Observations inform the record and never affect the outcome.

`hashPocTree(dir)`: list files recursively, skip directories named `node_modules`, `evidence` and `.evidence-wip`, skip `GO-NO-GO.json` and any `*.md`. Sort relative paths by code unit. Hash the sequence of `<relative path>\0<file bytes>\0` with SHA-256. Hashing happens inside the image and again on the host, so the rule must not depend on git.

Tests carrying no catalog prefix are ignored by evaluation, so helpers and the `harness` suite are allowed. A misspelled prefix therefore makes its criterion `missing`, which fails safe.

### D5. Evaluation

```ts
export type CriterionStatus = "pass" | "fail" | "missing" | "stale";
export interface CriterionResult { id: string; p0: P0Id; arch: Arch; status: CriterionStatus; detail: string }
export interface GateInput {
  catalog: readonly Criterion[];
  deferrals: readonly Deferral[];
  evidence: readonly SuiteEvidence[];
  pocTreeSha256: string;
  changedPaths: readonly string[];
  baselineState: "valid" | "pending" | "invalid";
}
export interface GateResult { outcome: "Go" | "No-Go"; criteria: CriterionResult[]; blockers: string[] }
export const ALLOWED_CHANGED_PREFIXES = ["migration/bun/", "openspec/", "docs/superpowers/"] as const;
export function validateCatalog(catalog: readonly Criterion[], deferrals: readonly Deferral[]): string[];
export function evaluate(input: GateInput): GateResult;
```

`evaluate` is pure. It produces one `CriterionResult` per criterion per required architecture. Evidence with no match for a suite and arch gives `missing`. A blocker string is `<id> <arch>: <status>`, plus one each for isolation, baseline and catalog failures.

### D6. Record and verification CLIs

`record.ts` gathers inputs on the host: evidence from `evidence/*/*.json`; `hashPocTree`; changed paths as the union of `git diff --name-only $(git merge-base master HEAD) HEAD` and the paths in `git status --porcelain`; `validateBaselineDir` on `../baseline/records`. It writes `GO-NO-GO.json` and `GO-NO-GO.md`, and exits 0 for either outcome. Using the merge base means a security fix merged from `master` does not appear as an isolation violation.

```ts
export interface OutcomeRecord {
  schemaVersion: 1;
  outcome: "Go" | "No-Go";
  decidedAt: string;
  freezeSha: string;
  head: string;
  pins: typeof POC_PINS;
  pocTreeSha256: string;
  criteria: CriterionResult[];
  blockers: string[];
  deferrals: Deferral[];
  observations: Record<string, Record<string, unknown>>; // keyed by `<arch>/<suite>`
}
```

`GO-NO-GO.md` is generated, never hand-edited, with this order: title, the line `Outcome: Go` or `Outcome: No-Go`, date, freeze SHA, pins, blockers, a criterion table, an observations list, the deferral table under the heading `Open after this decision`, and the next step. The next step text for Go: "Plan design section 8 steps 3 to 8 using these findings. No P0 blocker is closed by this record." For No-Go: "Stop the migration. An owner decides whether a blocker is solvable; if not, master unfreezes."

`verify-record.ts` recomputes the evaluation exactly as `record.ts` does, ignoring generated-at and head fields, and compares `outcome` and each criterion status. It exits 0 on a match, 1 on a mismatch.

### D7. Failure policy for every later change

A failing check is a legitimate result, not a defect to hide. Workers must not weaken an assertion, lower a size or threshold, edit the catalog or skip a test to get a pass. First confirm the failure comes from the runtime and not from a harness bug; fix a harness bug and rerun. If the failure stands, keep the test, note the criterion ID in the task report and finish the change.

## Risks / Trade-offs

- [No native arm64 host] → The two FFI suites need a real arm64 kernel; `record-bun-go-no-go` makes this an operator step. QEMU user-mode emulation is not acceptable evidence because system calls pass through the emulator.
- [Criteria are fixed before results] → A wrong threshold shows up as No-Go. Changing the catalog is an OpenSpec change, visible in review, and it invalidates evidence through the tree hash.
- [`podman` only] → Matches the host. Docker is not supported by `run-suite.sh`.
