# Design

## Context

See `proposal.md`. Observed facts:

- `src/dashboard/server.ts`: `Deno.serve({ port, hostname, onListen: (addr) => { this.actualPort = addr.port } }, (req, info) => this.handleRequest(req, info))`; `handleRequest(req, info?: Deno.ServeHandlerInfo)`, `resolveRateLimitKey(req, info?)` reads `info?.remoteAddr` and uses `"hostname" in remoteAddr`, then `canonicalizeHost`; `handleLogin(req, info?)`; `await this.server.shutdown()`; restart endpoint calls `Deno.kill(Deno.pid, "SIGTERM")` after 100 ms. Step 4 left all three server files to this change, so their filesystem calls are converted here with the codemod as well.
- `src/skill-api/server.ts`: `Deno.serve({ port, hostname, onListen })`, `(request) => this.handleRequest(request)`, `shutdown()`.
- `src/healthcheck.ts`: `Deno.serve({ port }, handler)`, `shutdown()`; binary loop over `["rg", "deno", "git"]` with `new Deno.Command(bin, { args: ["--version"], stdout: "null", stderr: "null" }).output()`, spawn throw → `not found in PATH`; `Deno.stat(scriptPath)`; writability via `Deno.writeTextFile`/`Deno.remove`.
- Tests start real servers on port 0 or fixed ports and call them with `fetch`. `tests/dashboard/server.test.ts` covers `/api/restart` responses without asserting the signal.
- Bun 1.4.2: `Bun.serve({ port, hostname, fetch(req, server) })` returns a `Server` with `port`, `hostname`, `requestIP(req)` (`{ address, family, port } | null`) and `stop(closeActiveConnections?: boolean): Promise<void>`.

## Goals / Non-Goals

**Goals:** the three servers on `Bun.serve` with identical routing, headers, status codes, rate-limit keys and shutdown semantics.

**Non-Goals:**

- No change to authentication, cookie, CSP, rate-limit or endpoint behavior.
- No signal-handler change (`port-signals-and-entrypoint-to-bun`).
- No TLS option.

## Decisions

### D1. Server shape

```ts
interface ClientInfo { remoteAddr?: { hostname: string; port: number } }
const toClientInfo = (req: Request, server: Server): ClientInfo => {
  const ip = server.requestIP(req);
  return ip ? { remoteAddr: { hostname: ip.address, port: ip.port } } : {};
};
this.server = Bun.serve({ port, hostname, fetch: (req, server) => this.handleRequest(req, toClientInfo(req, server)) });
this.actualPort = this.server.port;   // replaces onListen
```

Define `ClientInfo` and `toClientInfo` once in `src/dashboard/server.ts` (the Skill API and health servers do not read the client address). `handleRequest`, `resolveRateLimitKey` and `handleLogin` take `info?: ClientInfo`; the `"hostname" in remoteAddr` check stays valid. Log lines that used `onListen` log after `Bun.serve` returns, with the same message and fields. `stop()` methods call `await this.server.stop()` (graceful: in-flight requests finish, as `shutdown()` did).

### D2. Restart

`Deno.kill(Deno.pid, "SIGTERM")` → `process.kill(process.pid, "SIGTERM")`, same 100 ms timer.

### D3. Health check

Binary loop over `["rg", "bun", "git"]`: `const r = spawnSync(bin, ["--version"], { stdio: "ignore" })`; `r.error` → `not found in PATH`; `r.status !== 0` → `exited with non-zero status`; else ready. `Deno.stat`, `Deno.writeTextFile`, `Deno.remove` follow the codemod table.

### D4. Tests

Convert with the codemod and README. Test-side `Deno.serve` or `Deno.listen` become `Bun.serve` or `net.createServer`. If an IPv4 client is reported by `requestIP` as `::ffff:a.b.c.d`, `canonicalizeHost` must already map it to `a.b.c.d`; the rate-limit tests are the check and must pass unchanged.

## Risks / Trade-offs

- [`Bun.serve` default `idleTimeout` (10 s) closes the dashboard's long-poll or streaming responses] → Set `idleTimeout: 0` only if a converted test shows a premature close, and list it in the task report; Deno had no idle timeout.
- [`requestIP` returns null behind a Unix socket] → Not used; TCP only.
