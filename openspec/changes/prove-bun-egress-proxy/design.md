# Design

## Context

See `proposal.md` for motivation. Observed code facts in `src/utils/egress-proxy.ts`:

- Lines before `resolveAddresses` hold the allowlist and metadata logic with no Deno use. Only `createLogger` and `isDisallowedAddress` are imported.
- `src/utils/ssrf.ts` imports only `node:dns/promises` and uses no `Deno` API, so it loads under Bun unchanged.
- `startEgressProxy` is synchronous because `Deno.listen` is. `net.Server.listen` reports its port asynchronously.
- `tunnelPipe` loops over short writes and calls `closeWrite()` on EOF. `handleConnection` keeps any bytes read with the head and rewrites plain HTTP with `rewriteForwardHead`.
- A throwaway probe showed `new Resolver()` with `setServers(["127.0.0.1:<port>"])` reaching a `node:dgram` fake DNS server under Bun. A query with no AAAA answer rejected with `ENOTFOUND`, which the existing `try`/`catch` shape handles.

## Goals / Non-Goals

**Goals:** port the proxy per design section 4.6 and prove criteria EGR-01 to EGR-08.

**Non-Goals:**

- No edit to `src/utils/egress-proxy.ts`, `src/utils/ssrf.ts` or any product file.
- No GELF port; `gelf-transport.ts` has no P0 blocker and belongs to step 5.
- No rewrite of `rewriteForwardHead`, `parseAuthority`, `isMetadataAddress` or the allowlist logic. Copy them.
- No TLS interception, new filtering rule or configuration.
- No change to `gate/`, `Containerfile` or `run-suite.sh`.

## Decisions

### D1. Port shape

`migration/bun/poc/egress/egress-proxy.ts` starts as a copy of `src/utils/egress-proxy.ts`. Apply only these changes:

| Production | Port |
| --- | --- |
| `createLogger` from `@utils/logger.ts` | Local `const logger = { info() {}, warn() {}, error() {} }` |
| `isDisallowedAddress` from `@utils/ssrf.ts` | Import from `../../../../src/utils/ssrf.ts` |
| `Deno.resolveDns(host, "A")`, `"AAAA"` | `activeResolver.resolve4(host)`, `.resolve6(host)` in the same two `try`/`catch` blocks |
| `Deno.Conn` | `net.Socket` |
| `Deno.listen` | `net.createServer({ allowHalfOpen: true }, onConnection)` |
| `Deno.connect` | `net.connect({ host, port, allowHalfOpen: true })`, awaiting `connect` or `error` |
| `startEgressProxy(port): EgressProxyHandle` | `startEgressProxy(port): Promise<EgressProxyHandle>` |
| `sharedProxy`, `ensureEgressProxy`, `getRunningEgressProxyUrl`, `stopEgressProxy` | Delete; the suite calls `startEgressProxy` directly |

New exports:

```ts
export interface EgressResolver {
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
}
export function setEgressResolver(resolver: EgressResolver): void;
```

`activeResolver` defaults to `new Resolver()` from `node:dns/promises`. The async `startEgressProxy` is a finding for the later plan, since `ensureEgressProxy` is synchronous and its bootstrap callers depend on that; state this in the task report.

### D2. Stream handling

`readHead(socket)`: keep the socket paused and pull with `socket.read()` in a loop that waits for `readable`, decoding with one `TextDecoder`, until `\r\n\r\n` appears, the 64 KiB limit passes or the stream ends.

Bytes that arrive after the head in the same read stay in `head`, as they do today. For `CONNECT`, any such bytes are dropped, as they are today, because production writes nothing from `head` upstream.

`tunnelPipe(from, to)`, replacing the short-write loop with `drain` handling:

```ts
function tunnelPipe(from: net.Socket, to: net.Socket): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    const fail = () => { from.destroy(); to.destroy(); done(); };
    from.on("data", (chunk) => {
      if (!to.write(chunk)) {
        from.pause();
        to.once("drain", () => from.resume());
      }
    });
    from.once("end", () => { to.end(); done(); });
    from.once("error", fail);
    to.once("error", fail);
    from.once("close", done);
    to.once("close", done);
  });
}
```

`tunnelConnections` keeps its shape: `Promise.all` of both directions, then destroy both. Call `from.resume()` after attaching listeners if the socket was paused by `readHead`. `to.end()` is the half-close that replaces `closeWrite()`. Both sockets need `allowHalfOpen: true`, or Node's default closes the write side as soon as the read side ends.

Alternative rejected: `from.pipe(to)`. Its error path does not tear down the opposite socket, which the production comment calls out.

### D3. Fake DNS

`migration/bun/poc/egress/fake-dns.ts`:

```ts
export type DnsAnswer = (name: string, type: "A" | "AAAA", queryIndex: number) => string[];
export interface FakeDns {
  port: number;
  queries(): { name: string; type: "A" | "AAAA" }[];
  resolver(): EgressResolver; // new Resolver with setServers(["127.0.0.1:<port>"])
  stop(): void;
}
export function startFakeDns(answer: DnsAnswer): Promise<FakeDns>;
```

A `node:dgram` `udp4` socket bound to `127.0.0.1:0`. For each query: read the name labels from offset 12, read QTYPE (1 is A, 28 is AAAA), echo the 12-byte header with flags `0x81 0x80`, set ANCOUNT, copy the question, and append answers as `c0 0c`, type, class 1, TTL 0, RDLENGTH and RDATA. Convert AAAA text to 16 bytes with a small parser that expands `::`. `queryIndex` counts queries per name and type.

### D4. Suite method

`migration/bun/poc/suites/egress.spec.ts`. Reset the allowlist and resolver in `afterEach`. Upstreams listen on loopback, which is only reachable through an allowlisted host; IP literals in the allowlist keep this deterministic. Titles start with the criterion ID and a colon.

| ID | Method | Source intent |
| --- | --- | --- |
| EGR-01 | Fake DNS with the three scenario answers, using public addresses `8.8.8.8` and `2001:4860:4860::8888`. Also the literal table from the two `isEgressTargetAllowed` tests. | `isEgressTargetAllowed - rejects loopback...`, `- allows public IP literals`, `resolveAndValidateEgress - returns a pinned address...` |
| EGR-02 | Allowlisted host answering `169.254.169.254`; the `isMetadataAddress` literal table. | `egressAllowHosts - metadata addresses stay blocked...`, `isMetadataAddress - covers...`, `egress proxy - refuses plain-HTTP request to a metadata endpoint with 403` |
| EGR-03 | `net.Server` on `127.0.0.1:P` and `127.0.0.2:P` with the same port. Allowlist `rebind.test`. Answer by `queryIndex`. | New: requires the seam |
| EGR-04 | Allowlist `127.0.0.1`; upstream `net.Server` with `allowHalfOpen`; both sides write 32 MiB of seeded chunks and hash what they read; the client pauses 200 ms after the first chunk. | `tunnelConnections - relays a large payload...`, `egress proxy - CONNECT to an allowlisted loopback upstream...` |
| EGR-05 | Three tests per the scenarios. For the peer failure, `destroy()` the upstream socket during a large transfer and assert that the client socket closes and `tunnelConnections` resolves within 2 s. | `tunnelConnections - upstream close propagates EOF...` |
| EGR-06 | Raw `net.Server` upstream on loopback that records received bytes, replies with one canned `HTTP/1.1 200 OK` response with `Connection: close`, and ends. Raw `net.connect` client. For pipelining, write two complete `GET` heads in one `write`, count `HTTP/1.1 ` status lines until the socket closes, and assert the forwarded first head has `Connection: close`. A raw upstream keeps the test independent of any HTTP server's pipelining. | `rewriteForwardHead - ...` (both), `egress proxy - plain-HTTP forward...` |
| EGR-07 | Per the scenarios, with an empty-allowlist case. | `egressAllowHosts - allowlisted private literal...`, `- IPv6 literal entry...`, `- malformed entries...`, `- empty allowlist...` |
| EGR-08 | Raw client sending each request. For 502, allowlist `127.0.0.1` and use a port taken from a closed `net.Server`. | `egress proxy - refuses CONNECT to a loopback target with 403` |

## Risks / Trade-offs

- [Bun's `net.Socket` diverges on `allowHalfOpen`] → EGR-05 is the check. Node semantics are assumed by the port; a failure is No-Go evidence unless a harness bug.
- [`ipv6` is unavailable under `--network=none`] → No test connects over IPv6. AAAA data comes from fake DNS and is only validated.
- [`127.0.0.2` is unavailable] → Linux routes all of `127.0.0.0/8` on `lo`, and a listener binds it with no extra setup.
