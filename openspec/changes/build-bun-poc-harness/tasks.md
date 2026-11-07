# Tasks

Prerequisite: `migration/bun/baseline/records-schema.ts` exists. Verify with `test -f migration/bun/baseline/records-schema.ts`.

Run `bun` commands with working directory `migration/bun/poc/` and with `--no-env-file` where the subcommand is `run`. Create only the files in design D1. Do not edit product files.

## 1. Workspace and image

- [ ] 1.1 Create `.gitignore`, then `package.json` with `"private": true` and `"type": "module"`, and run `bun add --exact @agentclientprotocol/sdk@0.14.1 zod@4.4.3 fast-xml-parser@5.12.0`. Commit `bun.lock`. Create `gate/pins.ts` verbatim from design D1. Verify: `bun install --frozen-lockfile` exits 0 and `git status --porcelain migration/bun/poc` shows no `node_modules` entry.
- [ ] 1.2 Create `Containerfile`, `run-suite.sh` (mode 0755) and `fixtures/deny-openat2.json` verbatim from design D2. Verify: `podman build -f migration/bun/poc/Containerfile -t air-friends-bun-poc:local .` from the repository root exits 0, and `podman run --rm air-friends-bun-poc:local sh -c 'opencode --version; omp --version; dumb-init --version; stat -c "%u %a %s" /opt/air/skill-bunfig.toml'` prints `1.18.21`, `omp/18.6.1`, a dumb-init version and `0 444 0`. If the version output format differs, note it for the parser in 2.1.

## 2. Evidence

- [ ] 2.1 Create `gate/evidence.ts` with the types of design D3 and `collectTests(junitXml: string): EvidenceTest[]`, `hashPocTree(dir: string): string`, `hashProductSources(repoRoot: string): string` and `observe(key: string, value: unknown): void`. Parse with `fast-xml-parser` using `ignoreAttributes: false`, `attributeNamePrefix: ""`, `processEntities: true`, and `isArray` true for `testsuite` and `testcase`. Verify: covered by 2.3.
- [ ] 2.2 Create `gate/run-in-container.ts` per design D3, exporting `decideRun(junitExists: boolean): { write: boolean; exitCode: 0 | 2 }` and guarding the CLI body with `import.meta.main`. Verify: covered by 2.3.
- [ ] 2.3 Create `gate/harness.spec.ts` covering every scenario in this change's spec with synthetic JUnit text and `mkdtemp` trees. Verify: `bun test ./gate/harness.spec.ts` passes.
- [ ] 2.4 Create `suites/harness.spec.ts` with these tests: Bun version equals the pin; `/lib/<arch>-linux-gnu/libc.so.6` exists for the running architecture; `dumb-init` runs; UID is 1000 and GID is 0. Verify: `migration/bun/poc/run-suite.sh harness` exits 0 and `.evidence-wip/x86_64/harness.json` lists 4 passed tests with non-empty `pocTreeSha256` and `productSourcesSha256`.
- [ ] 2.5 Confirm isolation. Verify: `git status --porcelain` lists only `migration/bun/` and this change directory, and `deno test --no-run migration/` from the repository root reports "No test modules found". Do not commit `.evidence-wip/`.
