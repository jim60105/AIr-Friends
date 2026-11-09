# Proposal

## Why

Signal handling and the entry point still use `Deno.addSignalListener`, `Deno.exit`, `Deno.args`, `Deno.version` and `@std/flags` (`src/main.ts`, `src/shutdown.ts`, `src/core/error-handler.ts`). Source design section 4.8 requires the dashboard's self-`SIGTERM` to reach the migrated handlers. A probe during planning showed a Bun 1.4.2 difference that matters here: `globalThis.addEventListener("unhandledrejection", ...)` is not fired, and the process exits with code 1 on an unhandled rejection; `process.on("unhandledRejection")` and `process.on("uncaughtException")` are fired. Self-sent `SIGTERM` reaches every `process.on("SIGTERM")` handler.

## What Changes

- `src/shutdown.ts` and `src/core/error-handler.ts` register `SIGTERM`/`SIGINT` with `process.on` and exit with `process.exit`.
- `src/core/error-handler.ts` uses `process.on("unhandledRejection")` and `process.on("uncaughtException")` instead of the global `unhandledrejection` and `error` events, keeping log levels, `BaseError.toJSON()` and `onFatalError`.
- `src/main.ts` parses arguments with `parseArgs` from `node:util` (permissive, like `@std/flags`), logs `Bun version` with `Bun.version`, uses `process.exit`, and its help text says `bun run start`.
- Convert `tests/main.test.ts` and add `tests/core/shutdown-signals.test.ts` with child-process tests for the new requirements.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `logging-and-error-handling`: `Global Error Handler` describes process-level handling; adds `Shutdown Signals Reach Every Registered Handler`.
- `web-dashboard-restart`: adds `Restart Request Runs The Graceful Shutdown Flow`.

## Impact

- Edited: `src/main.ts`, `src/shutdown.ts`, `src/core/error-handler.ts`, `tests/main.test.ts`. New: `tests/core/shutdown-signals.test.ts`.
- After this change `src/` has no `Deno.` code use except in files owned by unapplied step 5 changes.
- P0 ownership: **P0-3** partial (SIGTERM handling inside the daemon process); container stop is `drill-bun-cutover-and-rollback`.
- No human review document.

## Batch:

depends-on: port-http-servers-to-bun-serve
depends-on: port-process-lifecycle-and-pool-to-bun

Conflict note: only change that edits these three files. Relies on the awaited pool stop from `port-process-lifecycle-and-pool-to-bun` for a clean shutdown.
