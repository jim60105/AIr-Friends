# Tasks

Prerequisite: `convert-utils-platforms-and-test-support-to-bun` and `convert-core-sessions-and-workspaces-to-bun` are applied. Verify with `test -f tests/helpers/test-context.ts && ! grep -q 'Deno\.' tests/helpers/*.ts && grep -q 'ensureEgressProxy' src/bootstrap.ts`.

Never weaken an assertion, size or threshold copied from the PoC suite.

## 1. Proxy

- [ ] 1.1 Port `src/utils/egress-proxy.ts` per design D1 and add the `await` in `src/bootstrap.ts`. Verify: `grep -n 'Deno\.' src/utils/egress-proxy.ts` prints only comments, and `bun run check 2>&1 | grep -E 'egress-proxy|bootstrap'` prints nothing.
- [ ] 1.2 Create `tests/helpers/fake-dns.ts` and convert `tests/utils/egress-proxy.test.ts` per design D3, including the six regression tests. Verify: `bun test tests/utils/egress-proxy.test.ts tests/utils/ssrf.test.ts` passes and lists the six `egress proxy - regression -` names.

## 2. GELF

- [ ] 2.1 Port `src/utils/gelf-transport.ts` per design D2 and convert `tests/utils/gelf-transport.test.ts`. Verify: `grep -n 'Deno\.' src/utils/gelf-transport.ts` prints only comments and `bun test tests/utils/gelf-transport.test.ts` passes.

## 3. Verification

- [ ] 3.1 Parity without deferral. Verify: `bun test --timeout=120000 --reporter=junit --reporter-outfile=.parity/egress.xml tests/utils/egress-proxy.test.ts tests/utils/gelf-transport.test.ts tests/utils/ssrf.test.ts; (cd migration/bun/baseline && bun run --no-env-file parity.ts --junit .parity/egress.xml --scope tests/utils/egress-proxy.test.ts --scope tests/utils/gelf-transport.test.ts --scope tests/utils/ssrf.test.ts)` exits 0.
- [ ] 3.2 Verify: `bun run fmt:check` and `bun run lint` exit 0, and `git status --porcelain` lists only the files in `proposal.md` Impact and this change directory.
