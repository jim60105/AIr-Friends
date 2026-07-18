## 1. Configuration Surface

- [x] 1.1 Add `egressAllowHosts: string[]` to `SandboxConfig` in `src/types/config.ts` with a doc comment covering the entry format (hostname or literal IP; no scheme/port), the exact-match semantics, and the security posture
- [x] 1.2 Add `egressAllowHosts: []` to `DEFAULT_SANDBOX` in `src/core/config-loader.ts` and validate that a configured value is an array of non-empty strings (fall back to `[]` otherwise)
- [x] 1.3 Map `AGENT_SANDBOX_EGRESS_ALLOW_HOSTS` → `agent.sandbox.egressAllowHosts` in `src/utils/env.ts` and add it to the comma-separated-array parsing branch of `applyEnvOverrides`

## 2. Egress Proxy Allowlist

- [x] 2.1 Add a module-level normalized allowlist to `src/utils/egress-proxy.ts` with an exported `configureEgressAllowHosts(hosts: string[])` setter (idempotent, replaces the set; normalizes trim/lowercase/IPv6-bracket-strip) that logs the normalized list, logs loopback/unspecified entries at error level (per design D3), and warns on entries containing a scheme, path, or port that can never match
- [x] 2.2 Exempt allowlisted hosts from the disallowed-range rejection in `resolveAndValidateEgress` while preserving DNS resolution and connect-time address pinning (covers both CONNECT and plain-HTTP paths); the exemption MUST NOT lift the metadata-address block — resolved addresses in the cloud-metadata space (`169.254.169.254`, IPv6 equivalents such as `fd00:ec2::254`) are rejected regardless of the allowlist
- [x] 2.3 Configure the allowlist during bootstrap in `src/bootstrap.ts` before `ensureEgressProxy`, sourcing it from `agent.sandbox.egressAllowHosts`

## 3. Agent Environment

- [x] 3.1 Append allowlisted hosts to `NO_PROXY`/`no_proxy` in `src/acp/agent-factory.ts` when the validating-proxy posture is active

## 4. Tests

- [x] 4.1 Unit tests in `tests/utils/egress-proxy.test.ts`: allowlisted private literal passes `resolveAndValidateEgress`/`isEgressTargetAllowed`; non-listed neighbor address is still rejected; an allowlisted host resolving to `169.254.169.254` (metadata) is still rejected; IPv6 literal entry matches bracketed request form; malformed entries (scheme/path/port, empty string) never match; normalization (case, whitespace, IPv6 brackets) matches; empty allowlist keeps all existing rejection tests green
- [x] 4.2 Proxy integration test: with `127.0.0.1` allowlisted, a CONNECT/plain-HTTP request to a local loopback upstream succeeds end-to-end through the proxy (this is the only way to exercise the full path against a real listener in tests)
- [x] 4.3 Agent-factory test: with a non-empty allowlist, spawned env `NO_PROXY` contains loopback entries plus every allowlisted host; with an empty allowlist, `NO_PROXY` is unchanged from today; verify `curl`'s `no_proxy` matching against a bare-hostname and a literal-IP entry (the motivating skill's client)
- [x] 4.4 Config tests: `AGENT_SANDBOX_EGRESS_ALLOW_HOSTS` comma-parsing (trim, drop empties) and the `[]` default

## 5. Documentation & Deployment Config

- [x] 5.1 Document `egressAllowHosts` in `config.example.yaml` and `AGENT_SANDBOX_EGRESS_ALLOW_HOSTS` in `helm/values.yaml` with a security note (operator-audited trust grants; prefer literal IPs or cluster-internal service names; a loopback entry exposes ALL loopback ports, not just the intended service)
- [x] 5.2 Add an "operator-trusted egress destinations" subsection to the F14 material in `docs/AGENT_PERMISSIONS.md` covering semantics, the non-exemptable metadata block, the NO_PROXY fast path (and its client-dependent matching), and the loopback all-ports warning
- [x] 5.3 Run `deno task test` (full suite) and `deno lint` / `deno fmt --check`; verify the built posture manually with a local proxy instance (allowlisted private target 200s, neighbor 403s)
