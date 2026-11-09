# Proposal

## Why

`src/utils/egress-proxy.ts` (the agent SSRF defense) is built on `Deno.listen`, `Deno.connect`, `Deno.Conn` and `Deno.resolveDns`, and `src/utils/gelf-transport.ts` on `Deno.listenDatagram` and `Deno.connect`. Source design section 4.6 moves both to `node:net`, `node:dns/promises` and `node:dgram`. The Go record proved a `node:net` port of the proxy (EGR-01 to EGR-08) in `migration/bun/poc/egress/`, and found that `startEgressProxy` becomes asynchronous because `net.Server` reports its port asynchronously. P0-5 requires the DNS, metadata, IP pinning, CONNECT and half-close regression tests to pass on the production code.

## What Changes

- Port `src/utils/egress-proxy.ts` from the PoC port: `node:net` sockets with `allowHalfOpen`, `drain`-based relaying, `Resolver` lookups, and an `EgressResolver` seam (`setEgressResolver`) for tests.
- `ensureEgressProxy` becomes `async`; `src/bootstrap.ts` awaits it. `getRunningEgressProxyUrl` stays synchronous.
- Port `src/utils/gelf-transport.ts` UDP to `node:dgram` and TCP to `node:net`.
- Move the PoC fake DNS server to `tests/helpers/fake-dns.ts`; convert `tests/utils/egress-proxy.test.ts` and `tests/utils/gelf-transport.test.ts` and add the rebinding, AAAA, half-close and 32 MiB slow-reader regression tests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: `Egress Proxy Transport Fidelity` states the short-write guarantee as backpressure without loss; adds `Egress Resolution Happens Once Per Connection`.

## Impact

- Edited: `src/utils/egress-proxy.ts`, `src/utils/gelf-transport.ts`, `src/bootstrap.ts` (one `await`), `tests/utils/egress-proxy.test.ts`, `tests/utils/gelf-transport.test.ts`. New: `tests/helpers/fake-dns.ts`.
- P0 ownership: **P0-5** (complete).
- No human review document.

## Batch:

depends-on: convert-utils-platforms-and-test-support-to-bun
depends-on: convert-core-sessions-and-workspaces-to-bun

Conflict note: edits `src/bootstrap.ts` (one line) after `convert-core-sessions-and-workspaces-to-bun`. Independent of the other step 5 changes.
