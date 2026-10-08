import { isDisallowedAddress } from "../../utils/ssrf.ts";
import type {
  EgressMode,
  TransportHopRequest,
  TransportRouteDecision,
} from "./compatibility-contracts.ts";

/**
 * Pure metadata address check (never exemptable under enforcing egress).
 * Inlined to avoid importing egress-proxy.ts which initializes logger/env at module load.
 */
export function isMetadataAddress(addr: string): boolean {
  const h = addr.toLowerCase();
  // Dotted IPv4, including IPv4-mapped IPv6 suffix forms (::ffff:169.254.169.254)
  const dotted = h.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) {
    const octets = dotted[1].split(".").map(Number);
    if (octets[0] === 169 && octets[1] === 254) return true;
  }
  return false;
}

/**
 * Validates transport routes using pure repository SSRF and metadata classifiers offline.
 * Rejects missing addresses, private destinations, metadata IPs under enforcing egress,
 * while honoring explicit operator allowlists and preserving unrestricted egress.
 */
export function validateTransportContract(
  egressMode: EgressMode,
  hop: TransportHopRequest,
  proxyConfigured: boolean,
  operatorAllowlist: readonly string[] = [],
): TransportRouteDecision {
  let parsed: URL;
  try {
    parsed = new URL(hop.url);
  } catch {
    return {
      permitted: false,
      proxyRouted: false,
      error: "invalid_url",
      reason: `Malformed URL: ${hop.url}`,
    };
  }

  // Scheme must be http or https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      permitted: false,
      proxyRouted: false,
      error: "unsupported_scheme",
      reason: `Unsupported URL protocol: '${parsed.protocol}'`,
    };
  }

  if (egressMode === "unrestricted") {
    return {
      permitted: true,
      proxyRouted: false,
      reason: `Unrestricted egress policy permits all destinations`,
    };
  }

  // Enforcing egress requires validating proxy
  if (!proxyConfigured) {
    return {
      permitted: false,
      proxyRouted: false,
      error: "unconfigured_proxy",
      reason: `Enforcing egress requires configured validating proxy`,
    };
  }

  const host = parsed.hostname;
  const isAllowlisted = operatorAllowlist.includes(host);

  // Determine address to check: either resolvedAddress or host literal
  const addressToCheck = hop.resolvedAddress ?? host;

  // Metadata check (169.254.x.x) - NEVER exemptable even with allowlist
  if (isMetadataAddress(addressToCheck)) {
    return {
      permitted: false,
      proxyRouted: true,
      error: "metadata_prohibited",
      reason:
        `Metadata target '${addressToCheck}' is strictly non-exemptable under enforcing egress`,
    };
  }

  // Address classification via ssrf.ts pure isDisallowedAddress
  const isDisallowed = isDisallowedAddress(addressToCheck);

  if (isDisallowed && !isAllowlisted) {
    return {
      permitted: false,
      proxyRouted: true,
      error: "ssrf_prohibited_private_target",
      reason: `Private address '${addressToCheck}' prohibited under enforcing egress`,
    };
  }

  return {
    permitted: true,
    proxyRouted: true,
    reason: `Hop '${hop.url}' permitted via validating proxy under enforcing egress`,
  };
}
