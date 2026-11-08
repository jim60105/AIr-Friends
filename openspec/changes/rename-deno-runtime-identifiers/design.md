# Design

## Context

See `proposal.md`. Observed identifier sites at the freeze (grep for `/home/deno`, `DENO_DIR`, `DENO_ENV`, `DENO_NO_UPDATE`, `deno task`, `deno run`, `deno-dir`, `deno.json`, `deno.lock`):

- `src/utils/env.ts` `getEnvironment()`: `DENO_ENV ?? ENV ?? "development"`.
- `src/acp/sandbox-manager.ts`: allowlist entries `DENO_DIR`, `DENO_NO_UPDATE_CHECK` under a `// Deno related` comment.
- `src/acp/filesystem-confinement.ts`: `DEFAULT_CONFINEMENT_READONLY_PATHS` includes `/deno-dir`, `/app/deno.json`, `/app/deno.lock`, `/home/deno/.config`, `/home/deno/.agents`; `DEFAULT_CONFINEMENT_WRITABLE_RUNTIME_PATHS` is `/home/deno/.cache`, `/home/deno/.agent-browser`.
- `src/acp/client.ts:1309` `HOME ?? "/home/deno"`; `src/core/git-credential-setup.ts:85` same fallback; `src/acp/agent-factory.ts:732` Playwright default `/home/deno/.cache/ms-playwright`; remedy strings with `deno task bundle:omp-extension` (lines 329, 2240); `src/utils/omp-native-cache.ts` remedy strings with `deno task prepare:omp-natives` (lines 109, 379).
- `agent-config/opencode.json` `external_directory` `"/home/deno/.agents/skills/**": "allow"`.
- `helm/values.yaml`: `AGENT_SKILLS_DIR: '/home/deno/.agents/skills'` (line 103), `DENO_ENV: 'development'` (128), a commented `DENO_ENV` example (404). `.env.example`: `/home/deno/.agents/skills` comment (73), `DENO_ENV=development` (113). `config.example.yaml` line 100 comment.
- `DENO_DIR` in `agent-factory.ts` was already removed by `adopt-bun-agent-process-boundary`; Deno grammar strings by `enforce-bun-skill-approval-grammar`.

## Goals / Non-Goals

**Goals:** no Deno runtime identifier left in `src/`, `skills/`, `scripts/`, `agent-config/`, `helm/` or the examples.

**Non-Goals:**

- No `Containerfile`, `compose.yml`, CI or docs change (`package-bun-container-image`, `migrate-ci-and-docs-to-bun`).
- No Helm template structure change (out of scope, design section 1); only `values.yaml` values.
- No change to `/app/data` or `/app/prompts` paths.

## Decisions

### D1. Replacements

| From | To |
| --- | --- |
| `/home/deno` (any suffix) | `/home/air` (same suffix) |
| `DENO_ENV ?? ENV ?? "development"` | `ENV ?? "development"` |
| `DENO_DIR`, `DENO_NO_UPDATE_CHECK` allowlist entries and the `// Deno related` comment | removed |
| read-only `/deno-dir`, `/app/deno.json`, `/app/deno.lock` | removed; add `/opt/air/skill-bunfig.toml` |
| `deno task <name>` in strings and comments | `bun run <name>` |
| Helm `DENO_ENV: 'development'`, `.env.example` `DENO_ENV=development` | `ENV: 'development'`, `ENV=development` |

Comments describing Deno behavior that no longer exists are rewritten to describe the current behavior or deleted.

### D2. Tests

Update assertions to the new values, keeping test names. Where a test name contains a replaced identifier (check with `grep -n 'deno' <file>` on `test(` lines), keep the name and change only the body; if the name itself is false afterwards, rename it and add a `renamed` entry to `parity-exceptions.json`. Add one test per `Confinement Exposes The Bun Skill Runtime Read-Only` scenario to `tests/acp/filesystem-confinement.test.ts`, and one `config-loader` test asserting `DENO_ENV=production` with no `ENV` yields `development`.

## Risks / Trade-offs

- [A deployment still sets `DENO_ENV=production` and silently runs as `development`] → Marked **BREAKING** here and in the changelog (`cut-over-to-bun-release`); the rollout checklist in `drill-bun-cutover-and-rollback` checks the ArgoCD parameters.
