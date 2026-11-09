# Design

## Context

See `proposal.md`. Observed facts:

- `src/utils/egress-proxy.ts` (514 lines): `resolveAddresses` uses `Deno.resolveDns(host, "A")` and `"AAAA"` in two `try`/`catch` blocks; `tunnelPipe(from: Deno.Conn, to: Deno.Conn)` loops over short writes and calls `closeWrite()` on EOF; `tunnelConnections(client, upstream)` runs both directions; `startEgressProxy(port)` uses `Deno.listen({ hostname: "127.0.0.1", port })` and is synchronous; `handleConnection(conn)` reads the head, validates, `Deno.connect`s to `verdict.address`, writes responses with `writeFull`, rewrites plain HTTP with `rewriteForwardHead`. Module state: `sharedProxy`, `ensureEgressProxy(port)` (sync), `getRunningEgressProxyUrl()`, `stopEgressProxy()`.
- Callers: `src/bootstrap.ts:167` `const proxy = ensureEgressProxy(sandbox.egressProxyPort ?? 0);` inside the async bootstrap; `src/acp/agent-factory.ts:224` and `:398` call `getRunningEgressProxyUrl()`.
- PoC port `migration/bun/poc/egress/egress-proxy.ts` (573 lines) applied a fixed table to a copy of the production file: `net.Socket` for `Deno.Conn`, `net.createServer({ allowHalfOpen: true }, onConnection)`, `net.connect({ host, port, allowHalfOpen: true })` awaiting `connect`/`error`, `activeResolver.resolve4`/`resolve6` with `setEgressResolver`, a paused-socket `readHead`, and a `drain`-based `tunnelPipe` that calls `to.end()` on `end` and destroys both on `error`. It deleted `sharedProxy` and the ensure/get/stop functions; production keeps them.
- `migration/bun/poc/egress/fake-dns.ts`: `startFakeDns(answer)` returns `{ port, queries(), resolver(), stop() }` over a `node:dgram` socket.
- `src/utils/gelf-transport.ts` (424 lines): `udpConn: Deno.DatagramConn` from `Deno.listenDatagram({ transport: "udp", hostname: "0.0.0.0", port: 0 })` and `send` to the parsed endpoint; `tcpConnection: Deno.TcpConn` from `Deno.connect({ hostname, port })` with null-byte-delimited frames.
- `tests/utils/egress-proxy.test.ts` has 17 tests, using `Deno.connect`/`Deno.listen` as clients and upstreams.

## Goals / Non-Goals

**Goals:** production proxy and GELF on Node APIs with every existing test intent, plus the PoC's regression cases.

**Non-Goals:**

- No change to allowlist semantics, metadata detection, `rewriteForwardHead`, `parseAuthority`, response codes or `src/utils/ssrf.ts`.
- No TLS interception or new configuration.
- No GELF format change (chunking, compression, null delimiter).

## Decisions

### D1. Proxy port

Start from the PoC file and restore what it removed: the `createLogger` logger, the `@utils/ssrf.ts` import alias, `sharedProxy`, `ensureEgressProxy`, `getRunningEgressProxyUrl` and `stopEgressProxy`. Signatures:

```ts
export function startEgressProxy(port: number): Promise<EgressProxyHandle>;
export async function ensureEgressProxy(port: number): Promise<EgressProxyHandle>; // idempotent
export function getRunningEgressProxyUrl(): string | undefined;                     // unchanged
export async function stopEgressProxy(): Promise<void>;
export interface EgressResolver { resolve4(host: string): Promise<string[]>; resolve6(host: string): Promise<string[]> }
export function setEgressResolver(resolver: EgressResolver | undefined): void;      // undefined restores the default
```

`ensureEgressProxy` stores the in-flight promise so two concurrent calls share one listener. `src/bootstrap.ts` becomes `const proxy = await ensureEgressProxy(...)`. Keep every comment that is still true; update comments that describe `Deno.Conn` short writes to describe `drain` backpressure.

### D2. GELF

- UDP: `dgram.createSocket("udp4")` created lazily; `send(buffer, port, hostname, callback)` awaited per chunk; `close()` on shutdown. No explicit `bind` (the first `send` binds an ephemeral port, as `port: 0` did).
- TCP: `net.connect({ host, port })` awaiting `connect` or `error`; `write(frame, callback)` awaited; on `error` or `close` reset `tcpConnection` to null so the next send reconnects, as the current reconnect logic does. Keep the existing types as `dgram.Socket` and `net.Socket`.

### D3. Tests

- Copy `fake-dns.ts` to `tests/helpers/fake-dns.ts` (imports from `../../src/utils/egress-proxy.ts` for the `EgressResolver` type).
- Convert the 17 existing tests (codemod, then raw clients and upstreams with `net.connect`/`net.createServer`). Names unchanged.
- Add, with titles prefixed `egress proxy - regression -`: rebinding (spec scenario), AAAA behind public A (spec scenario), client half-close with reply still delivered, upstream close seen by the client within 1 second, peer destroyed mid-transfer closes the other side within 2 seconds, and 32 MiB both directions with a 200 ms paused reader and SHA-256 equality. Port each from the matching `EGR-*` test in `migration/bun/poc/suites/egress.spec.ts`, replacing PoC imports with production ones.
- `afterEach`: `setEgressResolver(undefined)`, reset the allowlist, `await stopEgressProxy()`.

## Risks / Trade-offs

- [Making `ensureEgressProxy` async delays bootstrap until the listener is bound] → That is the correct order: agents must not launch before the proxy URL exists.
- [`dgram` send to an unresolvable host emits an asynchronous error] → Await the send callback and route the error into the existing error path.
