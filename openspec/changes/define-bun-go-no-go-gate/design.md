# Design

## Context

See `proposal.md` for motivation. `build-bun-poc-harness` supplies the image, `run-suite.sh`, the `SuiteEvidence` type, the hash helpers and `POC_PINS`. Observed facts that shape the rules:

- In Bun 1.4.2 a failing `beforeAll` removes the dependent tests from the JUnit report and leaves only a failed `<testcase name="(unnamed)">`. A test with no `expect` call passes with `assertions="0"`. Both would pass a criterion if only prefixed test results were read.
- The suites run production copies of `filesystem-access-linux.ts`, `command-syntax.ts` and `ssrf.ts`. A security fix merged from `master` moves the merge base, so the isolation check alone would not notice that those files changed.
- `uname -m` reports `aarch64` under qemu-user while `uname -r` still reports the host kernel.

## Goals / Non-Goals

**Goals:** fix the criteria before any result exists; make Go impossible without bound evidence.

**Non-Goals:**

- No checks here; the `prove-*` changes implement them.
- No edit to product files, CI, `Containerfile` or `run-suite.sh`.
- A Go result closes no P0 blocker. The suites exercise proof-of-concept copies, and each P0 blocker is re-proved against the migrated product in the later plan.

## Decisions

### D1. Layout

```text
migration/bun/poc/gate/catalog.ts       # P0 list, criteria, deferrals, suites
migration/bun/poc/gate/evaluate.ts      # binding check and pure evaluation
migration/bun/poc/gate/record.ts        # CLI: evaluate and write records
migration/bun/poc/gate/verify-record.ts # CLI
migration/bun/poc/gate/gate.spec.ts
```

### D2. Catalog (verbatim)

```ts
export type Arch = "x86_64" | "aarch64";
export type SuiteName = "process" | "acp" | "acp-failure" | "ffi" | "ffi-enosys" | "egress" | "injection" | "injection-noconfig";
export type P0Id = "P0-1" | "P0-2" | "P0-3" | "P0-4" | "P0-5" | "P0-6" | "P0-7" | "P0-8" | "P0-9" | "P0-10";
export interface Criterion {
  id: string;
  p0: P0Id;
  suite: SuiteName;
  archs: readonly Arch[];
  check: string;
  minTests: number; // the fewest passing tests that prove this criterion
}
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
| PROC-08 | P0-3 | process | x86_64 | With a child ignoring SIGTERM, SIGKILL follows the 2000 ms grace timer and the wrapper's exit is observed by 2500 ms |
| PROC-09 | P0-3 | process | x86_64 | After 20 spawn and teardown cycles the open descriptor count is within 2 of the start and no descendant remains |
| ACP-01-OC, ACP-01-OMP | P0-2 | acp | x86_64 | Handshake, session and prompt complete with stop reason `end_turn` and the scripted text |
| ACP-02-OC, ACP-02-OMP | P0-2 | acp | x86_64 | 16 MiB of agent output arrives byte-identical by SHA-256 |
| ACP-03-OC, ACP-03-OMP | P0-2 | acp | x86_64 | A 1 MiB prompt reaches the provider intact |
| ACP-04-OC, ACP-04-OMP | P0-2 | acp-failure | x86_64 | With a 3 s consumer stall, 4 MiB of agent output arrives byte-identical by SHA-256 |
| ACP-05-OC, ACP-05-OMP | P0-2 | acp-failure | x86_64 | `session/cancel` during streaming ends the prompt with stop reason `cancelled` within 5 s |
| ACP-06-OC, ACP-06-OMP | P0-2 | acp-failure | x86_64 | With a stalled provider, a 3 s client timeout rejects the call and teardown completes |
| ACP-07-OC, ACP-07-OMP | P0-2 | acp-failure | x86_64 | SIGKILL of the agent during streaming rejects the pending prompt within 3 s and `exited` resolves |
| ACP-08-OC, ACP-08-OMP | P0-2 | acp-failure | x86_64 | After teardown stdout reaches done and the ACP connection closes within 5 s |
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
| EGR-05 | P0-5 | egress | x86_64 | A half-close is forwarded, the opposite direction keeps working until it ends, and a peer failure tears down both sides |
| EGR-06 | P0-5 | egress | x86_64 | Plain HTTP is rewritten to origin form with `Connection: close`, and a pipelined second request is not answered |
| EGR-07 | P0-5 | egress | x86_64 | Allowlist exemption, neighbor rejection and malformed-entry rules hold |
| EGR-08 | P0-5 | egress | x86_64 | Refused, malformed and unreachable targets return 403, 400 and 502 |
| INJ-01 | P0-6 | injection | x86_64 | `.env` and `.env.local` in the working directory change nothing, in both invocation forms |
| INJ-02 | P0-6 | injection | x86_64 | `bunfig.toml` in the working directory changes nothing, in both invocation forms |
| INJ-03 | P0-6 | injection | x86_64 | `tsconfig.json`, `package.json`, `node_modules` and a symlinked script spelling in the working directory change nothing, in both invocation forms |
| INJ-04 | P0-6 | injection | x86_64 | The approval grammar denies a `BUN_OPTIONS` command prefix |
| INJ-05 | P0-6 | injection | x86_64 | The approval grammar accepts exactly the two invocation forms and denies every other flag |
| INJ-06 | P0-6 | injection | x86_64 | `/opt/air/skill-bunfig.toml` is empty, root-owned and read-only |
| INJ-07 | P0-6 | injection | x86_64 | A `.bunfig.toml` in `$HOME` or `$XDG_CONFIG_HOME` changes nothing, in both invocation forms |
| INJ-08 | P0-6 | injection-noconfig | x86_64 | With the config file missing, neither the skill nor the attacker preload runs; if Bun itself does not stop, the launcher stops the direct form and the literal form is reported |

A row with two IDs is two catalog entries that share the Check text. `minTests` is 1 except FFI-06 (3) and EGR-05 (3).

Deferrals. These stay open after a Go.

| P0 | Scope | Owner |
| --- | --- | --- |
| P0-1 | Production variable set (skill token directory, provider keys); the suites prove only `PATH` and `HOME` as required variables | Step 5 |
| P0-3 | Container stop, pool cleanup, restart, and children that outlive a wrapper SIGKILL | Step 5 and step 8 |
| P0-7 | All of sandbox detection and fail-closed behavior | Steps 5 to 7 |
| P0-8 | All of restart persistence | Step 8 |
| P0-9 | All of native dependencies and external tools | Steps 3 and 7 |
| P0-10 | All of CI, container deployment and the rollback drill | Steps 7 and 8 |

The `P0_BLOCKERS` constant holds the ten identifiers with one short label each.

Decision rationale: only FFI runs on both architectures because the design calls out architecture differences there (`O_DIRECTORY`, `O_NOFOLLOW`) and P0-4 names both. Native-dependency behavior on arm64 is P0-9 and is deferred.

### D3. Evaluation

```ts
export type CriterionStatus = "pass" | "fail" | "missing" | "stale";
export interface CriterionResult { id: string; p0: P0Id; arch: Arch; status: CriterionStatus; detail: string }
export interface GateInput {
  catalog: readonly Criterion[];
  deferrals: readonly Deferral[];
  evidence: readonly SuiteEvidence[];
  pocTreeSha256: string;
  productSourcesSha256: string;
  changedPaths: readonly string[];
  baselineState: "valid" | "pending" | "invalid";
}
export interface GateResult { outcome: "Go" | "No-Go"; criteria: CriterionResult[]; blockers: string[] }
export const ALLOWED_CHANGED_PREFIXES = ["migration/bun/", "openspec/", "docs/superpowers/"] as const;
export function validateCatalog(catalog: readonly Criterion[], deferrals: readonly Deferral[]): string[];
export function checkBinding(e: SuiteEvidence, pocTreeSha256: string, productSourcesSha256: string): string[];
export function evaluate(input: GateInput): GateResult;
```

`evaluate` is pure. It produces one `CriterionResult` per criterion per required architecture, deciding in this order:

1. No evidence for the suite and arch: `missing`.
2. `checkBinding` returns problems: `stale`.
3. Any test in that evidence with status `failed`, whatever its title: `fail`. Tests with no catalog prefix are otherwise ignored, so helpers are allowed, but a failure anywhere in a suite fails all its criteria.
4. Any test with the `<id>:` prefix that is skipped, or passed with `assertions` of 0: `fail`.
5. Fewer prefixed tests than `minTests`: `missing`. A misspelled prefix therefore fails safe.
6. Otherwise `pass`.

`checkBinding` compares Bun version and revision prefix, base image digest, agent versions, `pocTreeSha256` and `productSourcesSha256`. For `aarch64` evidence it also rejects a `kernel` containing `x86_64` or `amd64`, which catches qemu-user on an ordinary host.

A blocker string is `<id> <arch>: <status>`, plus one each for isolation, baseline and catalog failures, and one when the `spawnBackend` values of the `process`, `acp` and `acp-failure` evidence on an architecture differ.

### D4. Record and verification CLIs

`record.ts` gathers inputs on the host: evidence from `evidence/*/*.json`; `hashPocTree`; `hashProductSources`; changed paths as the union of `git diff --name-only $(git merge-base master HEAD) HEAD` and the paths in `git status --porcelain`; `validateBaselineDir` on `../baseline/records`. It writes `GO-NO-GO.json` and `GO-NO-GO.md`, and exits 0 for either outcome. Using the merge base means a security fix merged from `master` does not appear as an isolation violation; `productSourcesSha256` catches its effect on the suites instead.

```ts
export interface OutcomeRecord {
  schemaVersion: 1;
  outcome: "Go" | "No-Go";
  decidedAt: string;
  freezeSha: string;
  head: string;
  pins: typeof POC_PINS;
  pocTreeSha256: string;
  productSourcesSha256: string;
  changedPaths: string[];
  baselineState: "valid" | "pending" | "invalid";
  criteria: CriterionResult[];
  blockers: string[];
  deferrals: Deferral[];
  observations: Record<string, Record<string, unknown>>; // keyed by `<arch>/<suite>`
}
```

`GO-NO-GO.md` is generated, never hand-edited, with this order: title, the line `Outcome: Go` or `Outcome: No-Go`, date, freeze SHA, pins, blockers, a criterion table, an observations list, the deferral table under the heading `Open after this decision`, and the next step. The next step text for Go: "Plan design section 8 steps 3 to 8 using these findings. No P0 blocker is closed by this record." For No-Go: "Stop the migration. An owner decides whether a blocker is solvable; if not, master unfreezes."

`verify-record.ts` re-reads `evidence/` and rebuilds `GateInput` from the record's own `pocTreeSha256`, `productSourcesSha256`, `changedPaths` and `baselineState`, then compares `outcome` and each criterion status. It exits 0 on a match, 1 on a mismatch, so it stays valid after later steps change the tree. With `--live` it also recomputes both hashes and the isolation condition from the checkout and fails on any difference; `record-bun-go-no-go` uses `--live` on the commit that holds the record.

### D5. Failure policy for every later change

A failing check is a legitimate result, not a defect to hide. Workers must not weaken an assertion, lower a size or threshold, edit the catalog or skip a test to get a pass. First confirm the failure comes from the runtime and not from a harness bug; fix a harness bug and rerun. If the failure stands, keep the test, note the criterion ID in the task report and finish the change. Every test makes at least one `expect` call, because a test with no assertions counts as failed.

## Risks / Trade-offs

- [No native arm64 host] → The two FFI suites need a real arm64 kernel; `record-bun-go-no-go` makes this an operator step. QEMU user-mode emulation is not acceptable evidence because system calls pass through the emulator. The kernel-string check catches the common case; a full-system arm64 VM would pass it and is acceptable, because its kernel really handles the system calls.
- [Criteria are fixed before results] → A wrong threshold shows up as No-Go. Changing the catalog is an OpenSpec change, visible in review, and it invalidates evidence through the tree hash.
