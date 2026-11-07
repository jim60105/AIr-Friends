# Tasks

Prerequisite: `migration/bun/baseline/records-schema.ts` exists. Verify with `test -f migration/bun/baseline/records-schema.ts`.

Run `bun` commands with working directory `migration/bun/poc/` and with `--no-env-file` where the subcommand is `run`. Create only the files in design D1. Do not edit product files.

## 1. Workspace and image

- [ ] 1.1 Create `.gitignore`, then `package.json` with `"private": true` and `"type": "module"`, and run `bun add --exact @agentclientprotocol/sdk@0.14.1 zod@4.4.3 fast-xml-parser@5.12.0`. Commit `bun.lock`. Verify: `bun install --frozen-lockfile` exits 0 and `git status --porcelain migration/bun/poc` shows no `node_modules` entry.
- [ ] 1.2 Create `Containerfile`, `run-suite.sh` (mode 0755) and `fixtures/deny-openat2.json` verbatim from design D3. Add a temporary `gate/run-in-container.ts` only if needed for 1.3 and replace it in 2.4. Verify: `podman build -f migration/bun/poc/Containerfile -t air-friends-bun-poc:local .` from the repository root exits 0, and `podman run --rm air-friends-bun-poc:local sh -c 'opencode --version; omp --version; dumb-init --version; stat -c "%u %a %s" /opt/air/skill-bunfig.toml'` prints `1.18.21`, `omp/18.6.1`, a dumb-init version and `0 444 0`.

## 2. Gate

- [ ] 2.1 Create `gate/catalog.ts` with `POC_PINS`, `P0_BLOCKERS`, every criterion and every deferral verbatim from design D2. Expand two-ID rows to two entries. Verify: `bun test ./gate/gate.spec.ts` passes after task 2.3.
- [ ] 2.2 Create `gate/evidence.ts` with `collectTests(junitXml: string): EvidenceTest[]`, `hashPocTree(dir: string): string`, `checkBinding(e: SuiteEvidence, pocTreeSha256: string): string[]` and `observe(key: string, value: unknown): void`, per design D4. Parse with `fast-xml-parser` using `ignoreAttributes: false`, `attributeNamePrefix: ""`, `processEntities: true`, and `isArray` true for `testsuite` and `testcase`. Verify: covered by 2.5.
- [ ] 2.3 Create `gate/evaluate.ts` per design D5. Verify: covered by 2.5.
- [ ] 2.4 Create `gate/run-in-container.ts` per design D4 and `suites/harness.spec.ts` with these unprefixed tests: Bun version equals the pin; `/lib/<arch>-linux-gnu/libc.so.6` exists for the running architecture; `dumb-init` runs; UID is 1000 and GID is 0. Verify: `migration/bun/poc/run-suite.sh harness` exits 0 and `.evidence-wip/x86_64/harness.json` lists 4 passed tests.
- [ ] 2.5 Create `gate/gate.spec.ts` covering every scenario of the requirements "Criterion Catalog Coverage", "Criterion Result From Test Report", "Evidence Binding", "Outcome Evaluation", "Product Isolation Condition" and "Suite Failures Are Evidence", using synthetic catalogs, evidence and JUnit text; also assert `validateCatalog` returns no problems for the real catalog. For the run-exit scenarios, export `decideRun(junitExists: boolean): { write: boolean; exitCode: 0 | 2 }` from `gate/run-in-container.ts`, guard its CLI body with `import.meta.main`, and test that function. Verify: `bun test ./gate/gate.spec.ts` passes.
- [ ] 2.6 Create `gate/record.ts` and `gate/verify-record.ts` per design D6, with the pure parts exported as `renderMarkdown(r: OutcomeRecord): string` and `compareRecord(r: OutcomeRecord, g: GateResult): string[]`, and add tests for every scenario of "Outcome Record" and "Outcome Record Verification". Verify: `bun test ./gate/gate.spec.ts` passes.
- [ ] 2.7 Confirm isolation. Verify: `git status --porcelain` lists only `migration/bun/` and this change directory, and `deno test --no-run migration/` from the repository root reports "No test modules found". Do not commit `.evidence-wip/`, `GO-NO-GO.json` or `GO-NO-GO.md`.

## Workflow follow-up

- Design D7 binds every `prove-*` change.
