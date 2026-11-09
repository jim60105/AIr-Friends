// src/utils/egress-proxy.ts
//
// Validating forward proxy for agent egress (F14 D1).
//
// The agent's `webfetch`/`websearch` (OpenCode's own fetch client) and `agent-browser`
// (Chromium) use their own network stacks that never call `safeFetch`, so an untrusted
// chat user can make the bot fetch `http://169.254.169.254/…` (cloud metadata) or
// `http://127.0.0.1:8090/` (loopback service) and get the body relayed back. Routing the
// agent's egress through this proxy applies the SAME SSRF rule set as `ssrf.ts` at the
// actual egress point, so every request — including Chromium's post-launch navigations —
// is validated regardless of which tool issued it.
//
// The proxy validates the destination host (DNS-resolved, all A/AAAA records) against the
// disallowed-range set before connecting, for both plain-HTTP (absolute-form request line)
// and HTTPS (CONNECT tunneling). Loopback/private/link-local/ULA/metadata/multicast targets
// are refused with a 403 and no connection is made.

import { createLogger } from "@utils/logger.ts";
import { isDisallowedAddress } from "@utils/ssrf.ts";
import { Resolver } from "node:dns/promises";
import * as net from "node:net";

const logger = createLogger("EgressProxy");

const encoder = new TextEncoder();

/**
 * Operator-trusted egress destinations (normalized), exempt from the disallowed-range
 * rejection. Module-level like the shared proxy itself: configured once at bootstrap via
 * {@link configureEgressAllowHosts}, sourced exclusively from deployment config — never
 * extendable by the agent or chat users at runtime.
 */
let egressAllowHosts = new Set<string>();

/** Normalize a host for allowlist comparison: trim, lowercase, strip IPv6 brackets. */
function normalizeAllowHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  return h;
}

/** True for entries that grant loopback/unspecified reachability (all-ports blast radius). */
function isLoopbackOrUnspecifiedEntry(h: string): boolean {
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0") return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  // Compare IPv6 in expanded form so uncompressed loopback/unspecified spellings
  // (e.g. 0:0:0:0:0:0:0:1) trigger the warning too, not just ::1 / ::.
  const expanded = expandIPv6(h);
  if (expanded === "0000:0000:0000:0000:0000:0000:0000:0001") return true; // ::1
  if (expanded === "0000:0000:0000:0000:0000:0000:0000:0000") return true; // ::
  return false;
}

/**
 * Replace the operator-trusted egress allowlist (idempotent). Entries are normalized
 * (trim, lowercase, IPv6 brackets stripped) and matched EXACTLY against requested
 * destination hosts. Entries carrying a scheme, path, or port can never match a bare
 * destination host, so they are warned about and dropped. Loopback/unspecified entries are
 * honored but logged at error level: without port scoping they expose EVERY loopback port
 * (dashboard, Skill API, any future loopback-bound service), not just the intended one.
 */
export function configureEgressAllowHosts(hosts: string[]): void {
  const next = new Set<string>();
  for (const raw of hosts) {
    const h = normalizeAllowHost(raw);
    if (h === "") {
      logger.warn("Ignoring empty egress allowlist entry");
      continue;
    }
    // ":" is only legal inside IPv6 literals (which contain "::" or 2+ colons); a single
    // colon means a host:port entry, which can never match a bare destination host.
    const looksIPv6 = h.includes("::") || h.split(":").length > 2;
    if (h.includes("/") || h.includes("\\") || (!looksIPv6 && h.includes(":"))) {
      logger.warn(
        "Ignoring egress allowlist entry {entry}: entries must be a bare hostname or IP " +
          "(no scheme, port, or path) or they can never match a destination host",
        { entry: raw },
      );
      continue;
    }
    // Colon-bearing entries that are not parseable IPv6 (dotted-mapped forms like
    // ::ffff:1.2.3.4 excepted) are garbage that can never match — flag them too.
    const isDottedMapped = h.includes(":") && /(\d{1,3}\.){3}\d{1,3}$/.test(h);
    if (looksIPv6 && !isDottedMapped && expandIPv6(h) === null) {
      logger.warn(
        "Ignoring egress allowlist entry {entry}: not a valid IPv6 literal",
        { entry: raw },
      );
      continue;
    }
    if (isLoopbackOrUnspecifiedEntry(h)) {
      logger.error(
        "Egress allowlist entry {entry} grants the agent access to ALL loopback ports " +
          "(dashboard, Skill API, every loopback-bound service), not just one service. " +
          "Honoring the operator's explicit choice.",
        { entry: h },
      );
    }
    next.add(h);
  }
  egressAllowHosts = next;
  if (next.size > 0) {
    logger.info("Egress allowlist configured: {hosts}", { hosts: [...next].join(", ") });
  }
}

/**
 * Cloud-metadata addresses are NON-EXEMPTABLE: an allowlisted hostname's resolution is not
 * operator-controlled over time (that instability is why a name gets allowlisted instead of
 * an IP), so a compromised or misconfigured DNS answer must never turn a trust grant into a
 * credential-theft path. No legitimate allowlist use case needs these addresses.
 */
const METADATA_IPV4 = new Set([
  "169.254.169.254", // AWS/GCP/Azure/OpenStack IMDS
  "169.254.170.2", // AWS ECS task metadata
  "100.100.100.200", // Alibaba Cloud metadata
  "192.0.0.192", // Oracle Cloud legacy metadata
]);

/** Expand an IPv6 literal to its full 8-group lowercase form (null if not parseable). */
function expandIPv6(addr: string): string | null {
  const pct = addr.indexOf("%");
  const clean = (pct === -1 ? addr : addr.slice(0, pct)).toLowerCase();
  if (clean.includes(".")) return null; // dotted-quad embedded forms handled separately
  const halves = clean.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array(fill).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, "0")).join(":");
}

const METADATA_IPV6_EXPANDED = new Set(
  ["fd00:ec2::254"].map((a) => expandIPv6(a) as string),
);

/** True when a resolved address is in the cloud-metadata space (never exemptable). */
export function isMetadataAddress(addr: string): boolean {
  const h = addr.toLowerCase();
  // Dotted IPv4, including IPv4-mapped IPv6 suffix forms (::ffff:169.254.169.254)
  const dotted = h.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted && METADATA_IPV4.has(dotted[1])) return true;
  // Hex-form IPv4-mapped (::ffff:a9fe:a9fe = 169.254.169.254)
  const mappedHex = h.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    if (METADATA_IPV4.has(v4)) return true;
  }
  const expanded = expandIPv6(h);
  if (expanded !== null && METADATA_IPV6_EXPANDED.has(expanded)) return true;
  return false;
}

/** The two record families the proxy resolves; the suite swaps in a fake DNS server. */
export interface EgressResolver {
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
}

let activeResolver: EgressResolver = new Resolver();

/** Replace the resolver used for host lookups (`undefined` restores the default). */
export function setEgressResolver(resolver: EgressResolver | undefined): void {
  activeResolver = resolver ?? new Resolver();
}

/** Resolve a host to its addresses (literal IPs pass through) for range validation. */
async function resolveAddresses(host: string): Promise<string[]> {
  // Literal IPv4/IPv6 pass through unchanged.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return [host];
  const out: string[] = [];
  try {
    out.push(...(await activeResolver.resolve4(host)));
  } catch {
    // no A records
  }
  try {
    out.push(...(await activeResolver.resolve6(host)));
  } catch {
    // no AAAA records
  }
  return out;
}

/**
 * Resolve a host, validate every resolved address, and return a single validated address to
 * PIN the connection to. Returning the pinned address (rather than re-resolving at connect
 * time) closes the DNS-rebinding gap: `net.connect`/`fetch` must never perform a second,
 * independent resolution that an attacker's short-TTL record could answer with an internal IP.
 * Fails closed — an unresolvable host, or any resolved address in a disallowed range, yields
 * `{ allowed: false }`.
 *
 * Hosts on the operator-trusted allowlist ({@link configureEgressAllowHosts}) are exempt
 * from the disallowed-range rejection — resolution and connect-time pinning still apply —
 * but the cloud-metadata block is evaluated INDEPENDENTLY of the allowlist and can never
 * be lifted by it.
 */
export async function resolveAndValidateEgress(
  host: string,
): Promise<{ allowed: boolean; address?: string }> {
  const clean = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const allowlisted = egressAllowHosts.has(normalizeAllowHost(host));
  const addresses = await resolveAddresses(clean);
  if (addresses.length === 0) return { allowed: false };
  if (addresses.some((addr) => isMetadataAddress(addr))) {
    if (allowlisted) {
      logger.error(
        "Allowlisted egress host {host} resolved to a cloud-metadata address; blocking " +
          "(the allowlist exemption never extends to the metadata space)",
        { host: clean },
      );
    }
    return { allowed: false };
  }
  if (!allowlisted && addresses.some((addr) => isDisallowedAddress(addr))) {
    return { allowed: false };
  }
  return { allowed: true, address: addresses[0] };
}

/**
 * Return true when the destination host is safe to reach. Thin boolean wrapper over
 * {@link resolveAndValidateEgress} (kept for callers/tests that only need the verdict).
 */
export async function isEgressTargetAllowed(host: string): Promise<boolean> {
  return (await resolveAndValidateEgress(host)).allowed;
}

/** Split a `host:port` authority into host + port, defaulting the port. */
function parseAuthority(authority: string, defaultPort: number): { host: string; port: number } {
  // IPv6 literal: [::1]:443
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    const host = authority.slice(1, end);
    const rest = authority.slice(end + 1);
    const port = rest.startsWith(":") ? Number(rest.slice(1)) : defaultPort;
    return { host, port: Number.isFinite(port) ? port : defaultPort };
  }
  const idx = authority.lastIndexOf(":");
  if (idx === -1) return { host: authority, port: defaultPort };
  const host = authority.slice(0, idx);
  const port = Number(authority.slice(idx + 1));
  return { host, port: Number.isFinite(port) ? port : defaultPort };
}

/**
 * Copy bytes from one side of a tunnel to the other. On EOF, PROPAGATE the half-close
 * (`to.end()`, i.e. forward the FIN) to the destination — without this, a client whose
 * upstream closed an idle keep-alive connection never learns the tunnel is dead: its
 * connection pool reuses the zombie tunnel and the next request either hangs forever or
 * dies with "socket connection was closed" (observed with OpenCode's pooled LLM streams).
 * On error (reset), tear down BOTH connections so the opposite pipe unblocks immediately.
 *
 * `net.Socket.write` never reports a short write: it buffers, and `false` means the peer's
 * window is full. Pausing `from` until `to` drains is what keeps a large transfer bounded
 * instead of buffering the whole payload in the proxy.
 */
function tunnelPipe(from: net.Socket, to: net.Socket): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let ended = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const fail = () => {
      from.destroy();
      to.destroy();
      done();
    };
    // A peer may already be gone before the tunnel is installed (client abort during
    // validation): without this, no future `end`/`close` event would ever settle the pipe.
    if (from.destroyed || to.destroyed) {
      from.destroy();
      to.destroy();
      done();
      return;
    }
    // The source may already have received FIN while validation was pending. With the
    // socket paused, `end` is still queued, but `readableEnded` marks the already-consumed
    // case; route both through the same flush-aware half-close.
    if (from.readableEnded) {
      ended = true;
      to.end(() => done());
    }
    from.on("data", (chunk: Buffer) => {
      if (!to.write(chunk)) {
        from.pause();
        to.once("drain", () => from.resume());
      }
    });
    from.once("end", () => {
      // Half-close the destination, but settle only once its buffered bytes have flushed:
      // resolving first lets `tunnelConnections` destroy the sockets with data still queued.
      ended = true;
      if (to.destroyed) done();
      else to.end(() => done());
    });
    from.once("error", fail);
    to.once("error", fail);
    from.once("close", () => {
      if (!ended) done();
    });
    to.once("close", done);
    // `readHead` leaves the socket paused; the data listener alone must start the flow.
    from.resume();
  });
}

/**
 * Bidirectionally tunnel two established connections until both directions have drained
 * (or either side errors), then close both. Exported for direct testing of the
 * FIN-propagation behavior (the proxy's target validation forbids loopback upstreams, so
 * the tunnel semantics cannot be exercised through the full proxy path in tests).
 */
export async function tunnelConnections(client: net.Socket, upstream: net.Socket): Promise<void> {
  await Promise.all([tunnelPipe(client, upstream), tunnelPipe(upstream, client)]);
  // `end` flushes whatever is still buffered before the handle is dropped.
  upstream.end();
  client.end();
  upstream.destroy();
  client.destroy();
}

/**
 * Write every byte of `data` to `socket`, waiting for `drain` while it buffers.
 * `net.Socket.write` accepts the whole buffer, so only the backpressure wait remains.
 */
async function writeFull(socket: net.Socket, data: Uint8Array): Promise<void> {
  if (socket.destroyed) throw new Error("socket destroyed");
  if (socket.write(data)) return;
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const onDrain = () => {
    cleanup();
    resolve();
  };
  const onError = (err: Error) => {
    cleanup();
    reject(err);
  };
  const onClose = () => {
    cleanup();
    resolve();
  };
  function cleanup() {
    socket.off("drain", onDrain);
    socket.off("error", onError);
    socket.off("close", onClose);
  }
  socket.once("drain", onDrain);
  socket.once("error", onError);
  socket.once("close", onClose);
  await promise;
}

async function writeAll(socket: net.Socket, text: string): Promise<void> {
  await writeFull(socket, encoder.encode(text));
}

/** Upper bound on the request head: enough for any real header block. */
const HEAD_LIMIT = 64 * 1024;

/** Wait until the paused socket has data, or has ended. */
function waitForReadable(socket: net.Socket): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const done = () => {
    socket.off("readable", done);
    socket.off("end", done);
    socket.off("close", done);
    resolve();
  };
  socket.once("readable", done);
  socket.once("end", done);
  socket.once("close", done);
  if (socket.readableLength > 0 || socket.readableEnded || socket.destroyed) done();
  return promise;
}

/** The request head plus any body bytes the OS delivered in the same reads. */
interface RequestHead {
  head: string;
  body: Uint8Array;
}

/**
 * Read the first request line + headers block from a proxied connection. The socket stays
 * paused and is pulled with `read()`, so bytes that arrive after the head stay in
 * `body` instead of escaping to a `data` listener. The head is decoded as latin1 (the
 * header encoding) so every byte round-trips unchanged, and the body is kept as raw bytes:
 * decoding it as text would corrupt binary uploads that arrive coalesced with the head.
 */
async function readHead(socket: net.Socket): Promise<RequestHead> {
  const chunks: Buffer[] = [];
  let length = 0;
  let boundary = -1;
  socket.pause();
  while (boundary === -1) {
    const chunk = socket.read() as Buffer | null;
    if (chunk === null) {
      if (socket.readableEnded || socket.destroyed) break;
      await waitForReadable(socket);
      continue;
    }
    chunks.push(chunk);
    length += chunk.length;
    boundary = Buffer.concat(chunks, length).indexOf("\r\n\r\n");
    if (length > HEAD_LIMIT) break;
  }
  const all = Buffer.concat(chunks, length);
  const end = boundary === -1 ? all.length : boundary + 4;
  return { head: all.subarray(0, end).toString("latin1"), body: all.subarray(end) };
}

/** Write a terminal response, then fully dispose of the client socket. */
async function respondAndClose(conn: net.Socket, text: string): Promise<void> {
  try {
    await writeAll(conn, text);
  } catch {
    // The client is already gone; there is nothing left to deliver.
  }
  conn.end(() => conn.destroy());
}

export interface EgressProxyHandle {
  readonly port: number;
  close(): void;
}

/** Connect to `host:port` with the half-close semantics the tunnel relies on. */
function connectUpstream(host: string, port: number): Promise<net.Socket> {
  const { promise, resolve, reject } = Promise.withResolvers<net.Socket>();
  const socket = net.connect({ host, port, allowHalfOpen: true });
  const onConnect = () => {
    cleanup();
    resolve(socket);
  };
  const onError = (err: Error) => {
    cleanup();
    socket.destroy();
    reject(err);
  };
  function cleanup() {
    socket.off("connect", onConnect);
    socket.off("error", onError);
  }
  socket.once("connect", onConnect);
  socket.once("error", onError);
  return promise;
}

/** Process-wide singleton so all agent sessions share one validating proxy. */
let sharedProxy: EgressProxyHandle | undefined;
/** In-flight start, so concurrent callers share one listener instead of racing. */
let sharedProxyPromise: Promise<EgressProxyHandle> | undefined;

/**
 * Start (once) and return the shared validating egress proxy. `net.Server` reports its
 * bound port asynchronously, so starting is a promise; the in-flight promise is cached so
 * two concurrent calls share one listener.
 */
export async function ensureEgressProxy(port: number): Promise<EgressProxyHandle> {
  if (sharedProxy) return sharedProxy;
  if (!sharedProxyPromise) {
    const started = startEgressProxy(port);
    const promise: Promise<EgressProxyHandle> = started.then((proxy) => {
      // A concurrent `stopEgressProxy` clears the slot before this resolves; never publish
      // a listener the stop already promised to shut down.
      if (sharedProxyPromise === promise) sharedProxy = proxy;
      return proxy;
    }).catch((err: unknown) => {
      if (sharedProxyPromise === promise) sharedProxyPromise = undefined;
      throw err;
    });
    sharedProxyPromise = promise;
  }
  return await sharedProxyPromise;
}

/**
 * Return the URL of the running shared egress proxy, or `undefined` if it has not been
 * started. Lets the agent factory set `HTTP_PROXY` WITHOUT itself starting a listener — the
 * proxy is started once during bootstrap, so building an agent config has no network side
 * effect (important for tests).
 */
export function getRunningEgressProxyUrl(): string | undefined {
  return sharedProxy ? `http://127.0.0.1:${sharedProxy.port}` : undefined;
}

/** Stop the shared egress proxy (used on shutdown / in tests). */
export async function stopEgressProxy(): Promise<void> {
  const pending = sharedProxyPromise;
  const running = sharedProxy;
  sharedProxyPromise = undefined;
  sharedProxy = undefined;
  if (running) {
    running.close();
  }
  if (pending) {
    try {
      const proxy = await pending;
      if (proxy !== running) proxy.close();
    } catch {
      // a failed start leaves nothing to close
    }
  }
}

/**
 * Start the validating forward proxy on `127.0.0.1:<port>` (port 0 = ephemeral).
 * Returns a handle exposing the bound port and a `close()`. Unlike `Deno.listen`,
 * `net.Server` reports its bound port asynchronously, so starting is a promise.
 */
export function startEgressProxy(port: number): Promise<EgressProxyHandle> {
  const { promise, resolve, reject } = Promise.withResolvers<EgressProxyHandle>();
  let settled = false;
  const server = net.createServer({ allowHalfOpen: true }, (conn) => {
    // `node:net` reports peer resets as `error` events, and an unheard one ends the
    // process. Deno's listener loop only ever saw them as a rejected read; keeping a
    // baseline listener preserves that "one bad client cannot take the proxy down"
    // behavior for the whole pre-tunnel lifetime (`readHead`, validation, connect).
    conn.on("error", () => {});
    handleConnection(conn).catch(() => {
      conn.destroy();
    });
  });
  server.on("error", (err: Error) => {
    if (settled) {
      logger.error("Egress proxy error: {error}", { error: err.message });
      return;
    }
    settled = true;
    reject(err);
  });
  server.once("listening", () => {
    settled = true;
    const boundPort = (server.address() as net.AddressInfo).port;
    logger.info("Validating egress proxy listening on 127.0.0.1:{port}", { port: boundPort });
    resolve({
      port: boundPort,
      close: () => {
        server.close();
      },
    });
  });
  server.listen(port, "127.0.0.1");
  return promise;
}

async function handleConnection(conn: net.Socket): Promise<void> {
  const { head, body } = await readHead(conn);
  const requestLine = head.split("\r\n")[0] ?? "";
  const [method, target] = requestLine.split(" ");

  if (!method || !target) {
    await respondAndClose(conn, "HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }

  if (method.toUpperCase() === "CONNECT") {
    // HTTPS tunneling: target is `host:port`. Validate + PIN: connect to the validated IP so
    // a second resolution cannot rebind the tunnel to an internal address. Connecting by IP is
    // transparent to the tunnel — the client performs TLS end-to-end through it (SNI unaffected).
    const { host, port } = parseAuthority(target, 443);
    const verdict = await resolveAndValidateEgress(host);
    if (!verdict.allowed || !verdict.address) {
      logger.warn("Blocked CONNECT to disallowed egress target: {host}", { host });
      await respondAndClose(conn, "HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    let upstream: net.Socket;
    try {
      upstream = await connectUpstream(verdict.address, port);
    } catch {
      await respondAndClose(conn, "HTTP/1.1 502 Bad Gateway\r\n\r\n");
      return;
    }
    try {
      await writeAll(conn, "HTTP/1.1 200 Connection Established\r\n\r\n");
      // Early bytes the client pipelined with the CONNECT head belong to the tunnel.
      if (body.length > 0) await writeFull(upstream, body);
      await tunnelConnections(conn, upstream);
    } catch {
      upstream.destroy();
      conn.destroy();
    }
    return;
  }

  // Plain HTTP: absolute-form request line, e.g. `GET http://host/path HTTP/1.1`.
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    await respondAndClose(conn, "HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "http") {
    // Only plain HTTP arrives in absolute-form here; HTTPS uses CONNECT above.
    await respondAndClose(conn, "HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  const verdict = await resolveAndValidateEgress(url.hostname);
  if (!verdict.allowed || !verdict.address) {
    logger.warn("Blocked HTTP request to disallowed egress target: {host}", {
      host: url.hostname,
    });
    await respondAndClose(conn, "HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }

  // Forward by connecting to the PINNED validated IP and speaking HTTP directly (rewriting the
  // absolute-form request line to origin-form and preserving the original Host header). This
  // pins the connection to the validated address — unlike `fetch`, which would re-resolve the
  // hostname and could be DNS-rebound to an internal IP between validation and connection.
  const port = url.port ? Number(url.port) : 80;
  let upstream: net.Socket;
  try {
    upstream = await connectUpstream(verdict.address, port);
  } catch {
    await respondAndClose(conn, "HTTP/1.1 502 Bad Gateway\r\n\r\n");
    return;
  }
  const originPath = (url.pathname || "/") + url.search;
  const rewrittenHead = rewriteForwardHead(head, method, originPath);
  try {
    // Headers are latin1; encoding as UTF-8 would rewrite bytes >= 0x80.
    await writeFull(upstream, Buffer.from(rewrittenHead, "latin1"));
    // Body bytes read with the head are forwarded verbatim, never re-decoded.
    if (body.length > 0) await writeFull(upstream, body);
    await tunnelConnections(conn, upstream);
  } catch {
    upstream.destroy();
    conn.destroy();
  }
}

/**
 * Rewrite a proxied plain-HTTP request head for forwarding to the origin: the absolute-form
 * request line becomes origin-form, and the connection is forced to `Connection: close`
 * (dropping any `Connection`/`Proxy-Connection` the client sent). Forcing close is
 * load-bearing for security, not just hygiene: after this first request the proxy blindly
 * tunnels bytes, so a keep-alive client could smuggle a SECOND request to the same upstream
 * without validation. With close semantics the upstream ends the connection after one
 * response and the teardown propagates to the client. Any body bytes that were read along
 * with the head are preserved. Exported for direct unit testing.
 */
export function rewriteForwardHead(head: string, method: string, originPath: string): string {
  const headerEnd = head.indexOf("\r\n\r\n");
  const headerBlock = headerEnd === -1 ? head : head.slice(0, headerEnd);
  const rest = headerEnd === -1 ? "\r\n\r\n" : head.slice(headerEnd);
  const lines = headerBlock.split("\r\n");
  const headers = lines
    .slice(1)
    .filter((line) => !/^(connection|proxy-connection):/i.test(line));
  headers.push("Connection: close");
  return [`${method} ${originPath} HTTP/1.1`, ...headers].join("\r\n") + rest;
}
