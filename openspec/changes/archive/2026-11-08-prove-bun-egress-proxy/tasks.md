# Tasks

Prerequisite: `migration/bun/poc/run-suite.sh` and `migration/bun/poc/gate/catalog.ts` exist. Verify with `test -x migration/bun/poc/run-suite.sh && test -f migration/bun/poc/gate/catalog.ts`.

Gate design D7 applies: a failing check is a result. Never weaken an assertion, threshold or size, and never edit the catalog. Do not edit product files, `Containerfile`, `run-suite.sh` or `gate/`. Do not commit `.evidence-wip/`.

## 1. Port

- [x] 1.1 Copy `src/utils/egress-proxy.ts` to `migration/bun/poc/egress/egress-proxy.ts` and apply exactly the table in design D1 and the stream handling in design D2. Leave every comment that is still true. Verify: `grep -n 'Deno\.' migration/bun/poc/egress/egress-proxy.ts` prints no code use (comments may mention it), and `podman build -f migration/bun/poc/Containerfile -t air-friends-bun-poc:local .` exits 0.
- [x] 1.2 Create `egress/fake-dns.ts` per design D3. Verify: covered by 2.2.

## 2. Suite

- [x] 2.1 Create `suites/egress.spec.ts` with tests titled `EGR-01:` to `EGR-08:` following design D4, covering every scenario in this change's spec and the source intent column. Verify: covered by 2.2.
- [x] 2.2 Run `migration/bun/poc/run-suite.sh egress`. Verify: exit 0 and `.evidence-wip/x86_64/egress.json` holds at least one test per ID. Report any failed ID.
- [x] 2.3 Confirm isolation. Verify: `git status --porcelain` lists only `migration/bun/poc/egress/`, `migration/bun/poc/suites/` and this change directory.
