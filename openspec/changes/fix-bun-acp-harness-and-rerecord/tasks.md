# Tasks

Do not weaken any size or time bound. Do not edit the catalog. Do not hand-edit evidence or record files.

## 1. Harness fix

- [x] 1.1 Make `printableText()` non-periodic per design D1. Verify: `run-suite.sh acp` passes 10 of 10.
- [x] 1.2 Implement the client-side timeout in ACP-06 per design D2. Verify: `run-suite.sh acp-failure` passes 10 of 10.

## 2. Final x86_64 runs

- [ ] 2.1 Commit all pending work and record `git rev-parse HEAD`. Verify: `git status --porcelain` is empty.
- [ ] 2.2 Run every x86_64 suite with `--final` in `record-bun-go-no-go` design D1 order. Verify: there are eight evidence files, all with the same `pocTreeSha256` and with `gitHead` equal to the commit from 2.1.

## 3. Arm64 runs through CI

- [ ] 3.1 Scan the commits since `master` for secrets, then push `feat/migrate-to-bun` and tag `bun-poc-final-<short sha>`. Verify: a `bun-poc-arm64.yml` run exists for that commit.
- [ ] 3.2 Download `bun-poc-aarch64-evidence` into `migration/bun/poc/evidence/aarch64/`. Verify: `arch` is `aarch64` and the hash and head match task 2.

## 4. Decision

- [ ] 4.1 Run `bun run --no-env-file gate/record.ts`. Verify: there is exactly one `Outcome:` line.
- [ ] 4.2 Commit the evidence and the record, then run `gate/verify-record.ts --live`. Verify: exit 0.
- [ ] 4.3 Run the Deno check from `record-bun-go-no-go` design D3.
