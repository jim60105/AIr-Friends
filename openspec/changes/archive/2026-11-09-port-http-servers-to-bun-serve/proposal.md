# Proposal

## Why

The dashboard (`src/dashboard/server.ts`), the Skill API (`src/skill-api/server.ts`) and the health check server (`src/healthcheck.ts`) use `Deno.serve`. Source design section 4.8 moves them to `Bun.serve`, which has the same fetch handler model, while client-address handling, authentication and endpoints stay unchanged. The health check also probes the `deno` binary, which section 7 replaces with `bun`.

## What Changes

- Replace `Deno.serve`/`Deno.HttpServer`/`Deno.ServeHandlerInfo` with `Bun.serve` and a small `ClientInfo` built from `server.requestIP(req)` in all three servers; `shutdown()` becomes `await server.stop()`.
- The dashboard restart endpoint sends `SIGTERM` with `process.kill(process.pid, "SIGTERM")`. Whether that reaches the shutdown handlers is proved by `port-signals-and-entrypoint-to-bun`.
- The health check's binary probe uses `spawnSync` and checks `rg`, `bun` and `git`; its writability probe and script check move to `node:fs`.
- Convert `tests/dashboard/server.test.ts`, `tests/skill-api/server.test.ts`, `tests/healthcheck.test.ts` and `tests/integration/server-startup.integration.test.ts`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `logging-and-error-handling`: `Health Check Server` checks `bun` instead of `deno`.

## Impact

- Edited: the three servers and four test files above.
- **BREAKING** (operational): a deployment whose readiness depends on `binary:deno` now sees `binary:bun`. The Bun image ships `bun` (`package-bun-container-image`).
- P0 ownership: none directly; Skill API token validation (P0-8 across restart) relies on this server and is proved by `drill-bun-cutover-and-rollback`.
- No human review document.

## Batch:

depends-on: convert-skills-dashboard-and-skill-api-support-to-bun
depends-on: convert-core-state-and-schedulers-to-bun
depends-on: convert-core-sessions-and-workspaces-to-bun

Conflict note: only change that edits these three server files. `port-signals-and-entrypoint-to-bun` depends on it.
