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
