# Tasks

Prerequisite: `migration/bun/poc/gate/evidence.ts`, `migration/bun/poc/gate/pins.ts` and `migration/bun/baseline/records-schema.ts` exist. Verify with `test -f migration/bun/poc/gate/evidence.ts && test -f migration/bun/poc/gate/pins.ts && test -f migration/bun/baseline/records-schema.ts`.

Run `bun` commands with working directory `migration/bun/poc/` and with `--no-env-file` where the subcommand is `run`. Create only the files in design D1. Do not edit product files, `Containerfile`, `run-suite.sh`, `gate/pins.ts` or `gate/evidence.ts`.

## 1. Catalog and evaluation

- [x] 1.1 Create `gate/catalog.ts` with `P0_BLOCKERS`, every criterion and every deferral verbatim from design D2. Expand two-ID rows to two entries and set `minTests` as stated there. Verify: covered by 1.3.
- [x] 1.2 Create `gate/evaluate.ts` with `validateCatalog`, `checkBinding` and `evaluate` per design D3, deciding statuses in the stated order. Verify: covered by 1.3.
- [x] 1.3 Create `gate/gate.spec.ts` covering every scenario of the requirements "Criterion Catalog Coverage", "Criterion Result From Test Report", "Evidence Binding", "Outcome Evaluation" and "Product Isolation Condition", using synthetic catalogs and evidence; also assert `validateCatalog` returns no problems for the real catalog. Verify: `bun test ./gate/gate.spec.ts` passes.

## 2. Records

- [x] 2.1 Create `gate/record.ts` and `gate/verify-record.ts` per design D4, with the pure parts exported as `renderMarkdown(r: OutcomeRecord): string`, `compareRecord(r: OutcomeRecord, g: GateResult): string[]` and `compareLive(r: OutcomeRecord, live: { pocTreeSha256: string; productSourcesSha256: string; violations: string[] }): string[]`, guard both CLI bodies with `import.meta.main`, and add tests for every scenario of "Outcome Record" and "Outcome Record Verification". Verify: `bun test ./gate/gate.spec.ts` passes.
- [x] 2.2 Confirm isolation. Verify: `git status --porcelain` lists only `migration/bun/poc/gate/` and this change directory, and `deno test --no-run migration/` from the repository root reports "No test modules found". Do not commit `.evidence-wip/`, `GO-NO-GO.json` or `GO-NO-GO.md`.

## Workflow follow-up

- Design D5 binds every `prove-*` change.
