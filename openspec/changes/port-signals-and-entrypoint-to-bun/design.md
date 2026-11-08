# Design

## Context

See `proposal.md`. Observed facts:

- `src/shutdown.ts`: `registerSignalHandlers()` adds one handler to `SIGTERM` and `SIGINT` with `Deno.addSignalListener`; `performShutdown()` calls `Deno.exit(0)` when there is no context, stops the dashboard, platforms, agent core and health server, then `Deno.exit(0)` or `Deno.exit(1)`.
- `src/core/error-handler.ts`: `setupGlobalErrorHandler(options)` adds `globalThis` listeners for `unhandledrejection` (calls `event.preventDefault()`, logs `Unhandled promise rejection` at ERROR, `BaseError.toJSON()` when applicable) and `error` (logs `Uncaught error` at FATAL with `filename`, `lineno`, `colno`, `stack`; calls `onFatalError`), and when `enableGracefulShutdown` adds `SIGTERM`/`SIGINT` listeners that set `isShuttingDown` and dispatch `new CustomEvent("shutdown")` on `globalThis`. No production module calls `setupGlobalErrorHandler` today; tests do.
- `src/main.ts`: `parse(Deno.args, { string: ["config"], boolean: ["help", "yolo", "dry-run"], alias: { c: "config", h: "help" } })`; `Deno.exit(0)` after help; logs `Deno version` with `Deno.version.deno`; `Deno.exit(1)` on fatal startup error; help text shows `deno run -A src/main.ts`.
- `tests/main.test.ts` replaces `Deno.exit` with a stub five times.
- Planning probes on Bun 1.4.2: `globalThis.dispatchEvent(new CustomEvent("shutdown"))` with a `globalThis.addEventListener("shutdown")` listener works; `unhandledrejection` global listener is not called; `process.on("unhandledRejection")`, `process.on("uncaughtException")` and two `process.on("SIGTERM")` handlers all fire, including for `process.kill(process.pid, "SIGTERM")`.

## Goals / Non-Goals

**Goals:** signal, exit and error hooks on Bun with unchanged shutdown order and log messages.

**Non-Goals:**

- No change to the shutdown order or the components stopped.
- No production call to `setupGlobalErrorHandler` is added.
- No CLI option change.

## Decisions

### D1. Signals and exit

`Deno.addSignalListener(sig, h)` → `process.on(sig, h)`; `Deno.exit(n)` → `process.exit(n)`. The global `"shutdown"` `CustomEvent` dispatch stays.

### D2. Error hooks

```ts
process.on("unhandledRejection", (reason) => { /* same logging as before, with error = reason */ });
process.on("uncaughtException", (error) => {
  logger.fatal("Uncaught error", { message: error?.message, stack: error?.stack });
  options.onFatalError?.(error);
});
```

The `filename`, `lineno` and `colno` fields are dropped because Node's hook provides no event object; the stack carries them. Registering these listeners also keeps the process alive, matching what `preventDefault()` did.

### D3. Arguments

```ts
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { config: { type: "string", short: "c" }, help: { type: "boolean", short: "h" }, yolo: { type: "boolean" }, "dry-run": { type: "boolean" } },
  strict: false,
  allowPositionals: true,
});
```

`strict: false` keeps `@std/flags`' acceptance of unknown flags. The returned object keeps the same four fields and defaults. Help text: `bun run start [-- options]` and `bun run start -- --config ./my-config.yaml --yolo`. The version log line becomes `logger.info("Bun version", { version: Bun.version })`.

### D4. Tests

- `tests/main.test.ts`: replace `Deno.exit` stubs with `process.exit` stubs (assign and restore `process.exit`), keeping test names.
- `tests/core/shutdown-signals.test.ts`: each test writes a child script to a temp dir that imports the real module, registers the handlers with a recording context (an object whose `dashboardServer.stop`, `platformRegistry`, `agentCore` and `healthCheckServer` members print markers to stdout), then sends itself the signal; the test spawns it with `spawnSync(process.execPath, ["run", "--no-env-file", script])` and asserts the markers and exit code. The restart scenario starts a real `DashboardServer` on port 0 in the child, posts a confirmed restart with a valid session cookie from the dashboard auth module, and asserts the `dashboardServer.stop` marker precedes exit 0. A `setupGlobalErrorHandler` unhandled-rejection test asserts the child logs `Unhandled promise rejection` and keeps running until it exits on its own.

## Risks / Trade-offs

- [`process.exit` inside a signal handler cuts pending log writes] → Same as `Deno.exit`; the logger is synchronous to stdout.
- [Constructing a real `DashboardServer` in the child needs many dependencies] → Reuse the dependency builder from `tests/dashboard/server.test.ts` by importing it; if it is not exported, copy the minimal builder into the test and note it.
