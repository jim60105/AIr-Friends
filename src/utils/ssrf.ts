// src/utils/ssrf.ts
//
// SSRF (Server-Side Request Forgery) guards for server-side fetches of
// attacker-influenced URLs (e.g. federated Misskey DriveFile attachment URLs).
//
// The authoritative enforcement point is the fetch SINK: `safeFetch` validates the
// URL, then performs the request with MANUAL redirect handling, re-validating each
// redirect hop before following it (up to a bounded number of hops).

/** Maximum number of redirect hops to follow before aborting (F6). */
export const MAX_REDIRECT_HOPS = 5;

/** Error thrown when a URL fails SSRF validation. */
export class SsrfValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfValidationError";
  }
}

/**
 * Parse an IPv4 dotted-quad string into its four octets, or return null if not IPv4.
 */
function parseIPv4(host: string): [number, number, number, number] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const octets = m.slice(1).map((s) => Number(s));
  if (octets.some((o) => o < 0 || o > 255)) return null;
  return octets as [number, number, number, number];
}

/**
 * Determine whether an IPv4 address is in a disallowed range: loopback, private
 * (RFC1918), link-local (169.254/16), unspecified (0.0.0.0), multicast (224/4),
 * or reserved/broadcast (>= 240/4, 255.255.255.255).
 */
function isDisallowedIPv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 (includes unspecified)
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 10) return true; // private 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16.0.0/12
  if (a === 192 && b === 168) return true; // private 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // multicast 224/4 + reserved 240/4 + broadcast
  return false;
}

/**
 * Normalize and classify an IPv6 address string, returning true if disallowed:
 * loopback (::1), unspecified (::), link-local (fe80::/10), unique-local (fc00::/7),
 * multicast (ff00::/8), and IPv4-mapped addresses whose embedded IPv4 is disallowed.
 */
function isDisallowedIPv6(host: string): boolean {
  const h = host.toLowerCase();

  // IPv4-mapped / -embedded (dotted form): ::ffff:127.0.0.1 or ::127.0.0.1
  const mappedDotted = h.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedDotted) {
    const v4 = parseIPv4(mappedDotted[1]);
    if (v4 && isDisallowedIPv4(v4)) return true;
    // A public IPv4-mapped address is allowed; fall through to other checks.
  }

  // IPv4-mapped (hex form, as normalized by URL parser): ::ffff:7f00:1
  const mappedHex = h.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    const v4: [number, number, number, number] = [
      (hi >> 8) & 0xff,
      hi & 0xff,
      (lo >> 8) & 0xff,
      lo & 0xff,
    ];
    if (isDisallowedIPv4(v4)) return true;
  }

  if (h === "::1") return true; // loopback
  if (h === "::" || h === "::0") return true; // unspecified
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) {
    return true; // link-local fe80::/10
  }
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique-local fc00::/7
  if (h.startsWith("ff")) return true; // multicast ff00::/8
  return false;
}

/**
 * Strip zone id and brackets from a hostname to get a comparable host string.
 */
function normalizeHost(hostname: string): string {
  let h = hostname.trim();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  const pct = h.indexOf("%"); // IPv6 zone id
  if (pct !== -1) h = h.substring(0, pct);
  return h;
}

/**
 * Resolve a hostname to its IP addresses. Literal IPs are returned as-is. When
 * `Deno.resolveDns` is available and the host is not a literal IP, all A/AAAA
 * records are resolved. On resolution failure, an SsrfValidationError is thrown
 * (fail closed).
 */
async function resolveHostAddresses(host: string): Promise<string[]> {
  // Literal IPv4
  if (parseIPv4(host)) return [host];
  // Literal IPv6 (contains a colon)
  if (host.includes(":")) return [host];

  const addresses: string[] = [];
  try {
    const a = await Deno.resolveDns(host, "A");
    addresses.push(...a);
  } catch {
    // no A records / lookup failed for this type
  }
  try {
    const aaaa = await Deno.resolveDns(host, "AAAA");
    addresses.push(...aaaa);
  } catch {
    // no AAAA records / lookup failed for this type
  }

  if (addresses.length === 0) {
    throw new SsrfValidationError(`DNS resolution failed or returned no records for host: ${host}`);
  }
  return addresses;
}

/**
 * Return true if an already-resolved IP literal is in a disallowed range.
 */
export function isDisallowedAddress(addr: string): boolean {
  const host = normalizeHost(addr);
  const v4 = parseIPv4(host);
  if (v4) return isDisallowedIPv4(v4);
  if (host.includes(":")) return isDisallowedIPv6(host);
  // Not a literal IP — cannot classify here.
  return false;
}

/**
 * Validate a URL for SSRF safety (F6):
 *  1. scheme must be http or https;
 *  2. the host must resolve (all A/AAAA records) to non-loopback / non-private /
 *     non-link-local / non-ULA / non-unspecified / non-multicast addresses.
 *
 * Throws {@link SsrfValidationError} on any violation. Returns the parsed URL on success.
 */
export async function validateFetchUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfValidationError(`Invalid URL: ${url}`);
  }

  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    throw new SsrfValidationError(`Disallowed URL scheme: ${scheme}`);
  }

  const host = normalizeHost(parsed.hostname);
  if (host.length === 0) {
    throw new SsrfValidationError("URL has no host");
  }

  const addresses = await resolveHostAddresses(host);
  for (const addr of addresses) {
    if (isDisallowedAddress(addr)) {
      throw new SsrfValidationError(
        `URL host ${host} resolves to a disallowed address: ${addr}`,
      );
    }
  }

  return parsed;
}

/**
 * Pin a validated URL to a specific resolved address (F14 D3).
 *
 * Given the addresses the URL's host was validated against, return the request URL that
 * connects to the validated address rather than letting `fetch` re-resolve the hostname (a
 * second, attacker-controlled resolution could otherwise swap in an internal IP between
 * validation and connection). For plain-HTTP hostnames the authority is rewritten to the
 * pinned IP and the original `Host` is preserved. Literal-IP hosts need no pinning; HTTPS
 * hostnames are left unchanged because Deno `fetch` cannot connect-by-IP while preserving
 * TLS SNI/certificate validation (documented Open Question) — for those the caller still
 * gets the all-addresses range check, just not connect-time pinning.
 */
export function pinValidatedUrl(
  url: string,
  addresses: string[],
): { requestUrl: string; hostHeader?: string } {
  const parsed = new URL(url);
  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  const host = normalizeHost(parsed.hostname);
  const isLiteralIp = parseIPv4(host) !== null || host.includes(":");
  if (scheme !== "http" || isLiteralIp || addresses.length === 0) {
    return { requestUrl: parsed.toString() };
  }
  const pinned = addresses[0];
  const pinnedUrl = new URL(parsed.toString());
  pinnedUrl.hostname = pinned.includes(":") ? `[${pinned}]` : pinned;
  return { requestUrl: pinnedUrl.toString(), hostHeader: parsed.host };
}

/**
 * Validate a URL for SSRF safety and return the request to connect to (pinned per D3).
 * Throws {@link SsrfValidationError} on scheme/host/range violations.
 */
async function validateAndPin(
  url: string,
  resolveFn: (host: string) => Promise<string[]>,
): Promise<{ requestUrl: string; hostHeader?: string }> {
  const parsed = new URL(url);
  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    throw new SsrfValidationError(`Disallowed URL scheme: ${scheme}`);
  }
  const host = normalizeHost(parsed.hostname);
  if (host.length === 0) throw new SsrfValidationError("URL has no host");
  const addresses = await resolveFn(host);
  if (addresses.length === 0) {
    throw new SsrfValidationError(`DNS resolution failed or returned no records for host: ${host}`);
  }
  for (const addr of addresses) {
    if (isDisallowedAddress(addr)) {
      throw new SsrfValidationError(`URL host ${host} resolves to a disallowed address: ${addr}`);
    }
  }
  return pinValidatedUrl(url, addresses);
}

/** Options for {@link safeFetch}. */
export interface SafeFetchOptions {
  /**
   * URL validator invoked before the initial request AND before following each redirect.
   * When provided, it REPLACES the built-in validate-and-pin path (used by tests that
   * exercise redirect/hop-limit logic against a loopback server); no IP pinning is applied.
   */
  validate?: (url: string) => Promise<unknown>;
  /** Resolver override for tests. Defaults to the real DNS resolver. */
  resolve?: (host: string) => Promise<string[]>;
  /** `fetch` override for tests. Defaults to the global `fetch`. */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

/**
 * Perform a server-side fetch with SSRF protection (F6).
 *
 * Validates the initial URL, then follows redirects MANUALLY, re-validating each
 * redirect target before following it, up to {@link MAX_REDIRECT_HOPS}. Any hop that
 * fails validation aborts the request with an {@link SsrfValidationError}.
 *
 * @param url the initial URL to fetch
 * @param init standard fetch init; `redirect` is forced to `"manual"`
 * @param opts optional overrides (e.g. a custom validator for tests)
 */
export async function safeFetch(
  url: string,
  init?: RequestInit,
  opts?: SafeFetchOptions,
): Promise<Response> {
  const resolveFn = opts?.resolve ?? resolveHostAddresses;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    // Validate BEFORE each request (initial + every redirect target), then connect to the
    // validated (pinned) address so a re-resolution cannot swap in an internal IP (D3).
    let requestUrl = currentUrl;
    let requestInit: RequestInit = { ...init, redirect: "manual" };
    if (opts?.validate) {
      // Test path: custom validator replaces validate-and-pin; no pinning applied.
      await opts.validate(currentUrl);
    } else {
      const pinned = await validateAndPin(currentUrl, resolveFn);
      requestUrl = pinned.requestUrl;
      if (pinned.hostHeader) {
        const headers = new Headers(init?.headers);
        headers.set("host", pinned.hostHeader);
        requestInit = { ...requestInit, headers };
      }
    }

    const response = await fetchImpl(requestUrl, requestInit);

    // Non-redirect response: return it.
    const status = response.status;
    const isRedirect = status === 301 || status === 302 || status === 303 ||
      status === 307 || status === 308;
    if (!isRedirect) {
      return response;
    }

    const location = response.headers.get("location");
    // Drain the redirect response body to avoid leaking the connection.
    await response.body?.cancel();

    if (!location) {
      throw new SsrfValidationError("Redirect response without Location header");
    }

    // Resolve relative redirect targets against the current URL.
    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new SsrfValidationError(
    `Exceeded maximum of ${MAX_REDIRECT_HOPS} redirect hops`,
  );
}
