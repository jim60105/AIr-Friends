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

const logger = createLogger("EgressProxy");

const encoder = new TextEncoder();

// Minimal structural read type (Deno.Reader was removed). `Deno.Conn` satisfies it.
interface ByteReader {
  read(p: Uint8Array): Promise<number | null>;
}

/** Resolve a host to its addresses (literal IPs pass through) for range validation. */
async function resolveAddresses(host: string): Promise<string[]> {
  // Literal IPv4/IPv6 pass through unchanged.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return [host];
  const out: string[] = [];
  try {
    out.push(...(await Deno.resolveDns(host, "A")));
  } catch {
    // no A records
  }
  try {
    out.push(...(await Deno.resolveDns(host, "AAAA")));
  } catch {
    // no AAAA records
  }
  return out;
}

/**
 * Resolve a host, validate every resolved address, and return a single validated address to
 * PIN the connection to. Returning the pinned address (rather than re-resolving at connect
 * time) closes the DNS-rebinding gap: `Deno.connect`/`fetch` must never perform a second,
 * independent resolution that an attacker's short-TTL record could answer with an internal IP.
 * Fails closed — an unresolvable host, or any resolved address in a disallowed range, yields
 * `{ allowed: false }`.
 */
export async function resolveAndValidateEgress(
  host: string,
): Promise<{ allowed: boolean; address?: string }> {
  const clean = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const addresses = await resolveAddresses(clean);
  if (addresses.length === 0) return { allowed: false };
  if (addresses.some((addr) => isDisallowedAddress(addr))) return { allowed: false };
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
 * (`closeWrite`, i.e. forward the FIN) to the destination — without this, a client whose
 * upstream closed an idle keep-alive connection never learns the tunnel is dead: its
 * connection pool reuses the zombie tunnel and the next request either hangs forever or
 * dies with "socket connection was closed" (observed with OpenCode's pooled LLM streams).
 * On error (reset), tear down BOTH connections so the opposite pipe unblocks immediately.
 */
async function tunnelPipe(from: Deno.Conn, to: Deno.Conn): Promise<void> {
  const buf = new Uint8Array(16 * 1024);
  try {
    while (true) {
      const n = await from.read(buf);
      if (n === null) break;
      // `Deno.Conn.write` may perform a SHORT write and return fewer bytes than requested
      // (TCP backpressure on a large transfer). Loop until every byte is flushed — dropping
      // the remainder here silently corrupts a tunneled TLS stream ("bad record mac") and
      // manifests as intermittent "socket connection was closed" once request bodies grow
      // (e.g. after a skill inflates the LLM context).
      let off = 0;
      while (off < n) {
        off += await to.write(buf.subarray(off, n));
      }
    }
    await to.closeWrite();
  } catch {
    try {
      from.close();
    } catch {
      // already closed
    }
    try {
      to.close();
    } catch {
      // already closed
    }
  }
}

/**
 * Bidirectionally tunnel two established connections until both directions have drained
 * (or either side errors), then close both. Exported for direct testing of the
 * FIN-propagation behavior (the proxy's target validation forbids loopback upstreams, so
 * the tunnel semantics cannot be exercised through the full proxy path in tests).
 */
export async function tunnelConnections(client: Deno.Conn, upstream: Deno.Conn): Promise<void> {
  await Promise.all([tunnelPipe(client, upstream), tunnelPipe(upstream, client)]);
  try {
    upstream.close();
  } catch {
    // already closed
  }
  try {
    client.close();
  } catch {
    // already closed
  }
}

/** Write every byte of `data` to `conn`, looping over short writes. */
async function writeFull(
  conn: { write(p: Uint8Array): Promise<number> },
  data: Uint8Array,
): Promise<void> {
  let off = 0;
  while (off < data.length) {
    off += await conn.write(data.subarray(off));
  }
}

async function writeAll(
  conn: { write(p: Uint8Array): Promise<number> },
  text: string,
): Promise<void> {
  await writeFull(conn, encoder.encode(text));
}

/** Read the first request line + headers block from a proxied connection. */
async function readHead(conn: ByteReader): Promise<string> {
  const buf = new Uint8Array(64 * 1024);
  let acc = "";
  while (!acc.includes("\r\n\r\n")) {
    const chunk = new Uint8Array(4096);
    const n = await conn.read(chunk);
    if (n === null) break;
    acc += new TextDecoder().decode(chunk.subarray(0, n));
    if (acc.length > buf.length) break;
  }
  return acc;
}

export interface EgressProxyHandle {
  readonly port: number;
  close(): void;
}

/** Process-wide singleton so all agent sessions share one validating proxy. */
let sharedProxy: EgressProxyHandle | undefined;

/** Start (once) and return the shared validating egress proxy. */
export function ensureEgressProxy(port: number): EgressProxyHandle {
  if (!sharedProxy) {
    sharedProxy = startEgressProxy(port);
  }
  return sharedProxy;
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
export function stopEgressProxy(): void {
  sharedProxy?.close();
  sharedProxy = undefined;
}

/**
 * Start the validating forward proxy on `127.0.0.1:<port>` (port 0 = ephemeral).
 * Returns a handle exposing the bound port and a `close()`.
 */
export function startEgressProxy(port: number): EgressProxyHandle {
  const listener = Deno.listen({ hostname: "127.0.0.1", port });
  const boundPort = (listener.addr as Deno.NetAddr).port;
  logger.info("Validating egress proxy listening on 127.0.0.1:{port}", { port: boundPort });

  (async () => {
    for await (const conn of listener) {
      handleConnection(conn).catch(() => {
        try {
          conn.close();
        } catch {
          // already closed
        }
      });
    }
  })();

  return {
    port: boundPort,
    close: () => {
      try {
        listener.close();
      } catch {
        // already closed
      }
    },
  };
}

async function handleConnection(conn: Deno.Conn): Promise<void> {
  const head = await readHead(conn);
  const requestLine = head.split("\r\n")[0] ?? "";
  const [method, target] = requestLine.split(" ");

  if (!method || !target) {
    await writeAll(conn, "HTTP/1.1 400 Bad Request\r\n\r\n");
    conn.close();
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
      await writeAll(conn, "HTTP/1.1 403 Forbidden\r\n\r\n");
      conn.close();
      return;
    }
    let upstream: Deno.Conn;
    try {
      upstream = await Deno.connect({ hostname: verdict.address, port });
    } catch {
      await writeAll(conn, "HTTP/1.1 502 Bad Gateway\r\n\r\n");
      conn.close();
      return;
    }
    await writeAll(conn, "HTTP/1.1 200 Connection Established\r\n\r\n");
    await tunnelConnections(conn, upstream);
    return;
  }

  // Plain HTTP: absolute-form request line, e.g. `GET http://host/path HTTP/1.1`.
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    await writeAll(conn, "HTTP/1.1 400 Bad Request\r\n\r\n");
    conn.close();
    return;
  }
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "http") {
    // Only plain HTTP arrives in absolute-form here; HTTPS uses CONNECT above.
    await writeAll(conn, "HTTP/1.1 403 Forbidden\r\n\r\n");
    conn.close();
    return;
  }
  const verdict = await resolveAndValidateEgress(url.hostname);
  if (!verdict.allowed || !verdict.address) {
    logger.warn("Blocked HTTP request to disallowed egress target: {host}", {
      host: url.hostname,
    });
    await writeAll(conn, "HTTP/1.1 403 Forbidden\r\n\r\n");
    conn.close();
    return;
  }

  // Forward by connecting to the PINNED validated IP and speaking HTTP directly (rewriting the
  // absolute-form request line to origin-form and preserving the original Host header). This
  // pins the connection to the validated address — unlike `fetch`, which would re-resolve the
  // hostname and could be DNS-rebound to an internal IP between validation and connection.
  const port = url.port ? Number(url.port) : 80;
  let upstream: Deno.Conn;
  try {
    upstream = await Deno.connect({ hostname: verdict.address, port });
  } catch {
    await writeAll(conn, "HTTP/1.1 502 Bad Gateway\r\n\r\n");
    conn.close();
    return;
  }
  const originPath = (url.pathname || "/") + url.search;
  const rewrittenHead = rewriteForwardHead(head, method, originPath);
  try {
    await writeFull(upstream, encoder.encode(rewrittenHead));
  } catch {
    try {
      upstream.close();
    } catch {
      // already closed
    }
    conn.close();
    return;
  }
  await tunnelConnections(conn, upstream);
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
