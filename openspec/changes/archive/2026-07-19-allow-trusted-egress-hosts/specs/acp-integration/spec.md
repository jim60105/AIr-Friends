## MODIFIED Requirements

### Requirement: SandboxManager Network Isolation

The `SandboxManager` SHALL mediate the agent subprocess's network egress so that the default posture never grants the agent unmediated access to host-private networks. It SHALL support two egress-control modes: (a) full network-namespace isolation via the userns-first `unshare --user --map-root --net`, and (b) a validating-proxy mode in which the agent's outbound requests are routed through a local proxy that applies SSRF validation (scheme allow-list; reject loopback, private RFC1918, link-local, unique-local, unspecified, and multicast addresses) so that `webfetch`, `websearch`, and `agent-browser` all inherit the validation. The validating-proxy mode is the default because full network-namespace isolation gives the agent an empty network namespace that also severs its loopback access to the Skill API; the proxy mode keeps the Skill API reachable (via `NO_PROXY`) while blocking internal targets. When neither a validating egress path nor an explicit operator opt-in to unrestricted egress is configured, the agent SHALL fail closed rather than be given open egress.

In validating-proxy mode, the operator MAY enumerate specific trusted destinations via `agent.sandbox.egressAllowHosts` (default empty). Each entry is a hostname or literal IP (no scheme, no port). The proxy SHALL exempt a destination from the disallowed-range rejection when its requested host matches an allowlist entry exactly (case-insensitive, after trimming and stripping IPv6 brackets), for both CONNECT tunneling and plain-HTTP forwarding; DNS resolution and connect-time address pinning SHALL still apply to allowlisted hostnames. The exemption SHALL NOT extend to the cloud-metadata address space: a resolved address of `169.254.169.254` or an IPv6 metadata equivalent (e.g. `fd00:ec2::254`) SHALL be rejected even when the requested host is allowlisted. Allowlisted hosts SHALL also be appended to the agent's `NO_PROXY`/`no_proxy` so env-honoring clients may connect to them directly. The allowlist SHALL be sourced exclusively from operator deployment configuration — the agent and chat users SHALL NOT be able to extend it at runtime. An empty allowlist SHALL produce behavior identical to the pre-allowlist posture.

#### Scenario: Network isolation uses the userns-first incantation
- **GIVEN** full isolation is selected and a functional probe (not merely a binary-exists check) confirms a network namespace can actually be established at runtime
- **WHEN** `buildSpawnOptions()` wraps the command
- **THEN** it SHALL prepend `unshare --user --map-root --net` (not a bare `unshare --net`, which fails in a non-root container) to the agent command

#### Scenario: Isolation availability is functionally probed, not assumed
- **GIVEN** the `unshare` binary exists but a network namespace cannot be created at runtime (e.g. unprivileged user namespaces disabled on the node)
- **WHEN** the system determines the egress posture
- **THEN** it SHALL detect this via a functional probe rather than a binary-existence check, and SHALL fail closed rather than fall back to unmediated open egress

#### Scenario: Validating-proxy egress preserves public research while blocking internal targets
- **GIVEN** a validating egress proxy is configured
- **WHEN** the agent issues a `webfetch`, `websearch`, or `agent-browser` request
- **THEN** the request SHALL be routed through the proxy, which SHALL allow public destinations and reject loopback/private/link-local/unique-local/metadata addresses before forwarding

#### Scenario: Internal target rejected across all agent network paths
- **GIVEN** the mediated egress path is active
- **WHEN** the agent attempts to fetch `http://169.254.169.254/…` or `http://127.0.0.1:8090/` via any tool (including `agent-browser` post-launch navigation)
- **THEN** the request SHALL be rejected and its body SHALL NOT be returned to the agent

#### Scenario: Allowlisted internal host is reachable through the proxy
- **GIVEN** `agent.sandbox.egressAllowHosts` contains `192.168.1.10` and `internal-proxy`
- **WHEN** the agent requests `http://192.168.1.10:7860/sdapi/v1/progress` (plain-HTTP forward) or issues a CONNECT to `internal-proxy:18080` through the validating proxy
- **THEN** the proxy SHALL NOT reject the destination for being in a private range, SHALL resolve and pin the connection address as usual, and SHALL forward the request

#### Scenario: Allowlist match is exact per host, not a range grant
- **GIVEN** `agent.sandbox.egressAllowHosts` contains `192.168.1.10`
- **WHEN** the agent attempts to reach `192.168.10.11` (or any other non-listed private address) through the proxy
- **THEN** the request SHALL be rejected with the standard disallowed-range refusal

#### Scenario: Metadata address stays blocked even for an allowlisted host
- **GIVEN** `agent.sandbox.egressAllowHosts` contains a hostname entry whose DNS resolution has been changed (compromise or misconfiguration) to `169.254.169.254`
- **WHEN** the agent requests that host through the validating proxy
- **THEN** the proxy SHALL reject the request — the allowlist exemption SHALL NOT lift the metadata-address block

#### Scenario: IPv6 literal allowlist entry matches bracketed request forms
- **GIVEN** `agent.sandbox.egressAllowHosts` contains an IPv6 literal entry (e.g. `fd12:3456::10`)
- **WHEN** the agent requests that address in bracketed authority form (`[fd12:3456::10]:8080`) through the proxy
- **THEN** the normalized comparison SHALL match the entry and the request SHALL be exempted from the disallowed-range rejection

#### Scenario: Malformed or empty allowlist entries never match and are surfaced
- **GIVEN** `agent.sandbox.egressAllowHosts` contains an entry with a scheme, path, or port (e.g. `http://192.168.1.10:7860`) or an empty string
- **WHEN** the allowlist is configured at bootstrap
- **THEN** the system SHALL warn that the entry can never match a destination host, and the entry SHALL NOT grant any exemption

#### Scenario: Allowlisted hosts appended to NO_PROXY
- **GIVEN** the validating-proxy posture is active and `agent.sandbox.egressAllowHosts` is non-empty
- **WHEN** the agent subprocess environment is built
- **THEN** `NO_PROXY`/`no_proxy` SHALL contain the loopback entries plus every allowlisted host, so env-honoring clients connect to allowlisted hosts directly while all other traffic still routes through the proxy

#### Scenario: Loopback allowlist entry warns at startup
- **GIVEN** `agent.sandbox.egressAllowHosts` contains a loopback or unspecified entry (e.g. `127.0.0.1`, `localhost`, `::1`)
- **WHEN** the allowlist is configured at bootstrap
- **THEN** the system SHALL emit a prominent warning that daemon-local services become reachable to the agent, and SHALL still honor the operator's explicit choice

#### Scenario: Default posture is not open egress
- **GIVEN** the default configuration (validating egress proxy enabled)
- **WHEN** the agent subprocess is spawned
- **THEN** the agent's egress SHALL be routed through the validating proxy (internal targets blocked, public allowed) rather than granted open egress

#### Scenario: No posture configured fails closed
- **GIVEN** no validating egress proxy, no full network isolation, and no explicit unrestricted-egress opt-in are configured
- **WHEN** the agent subprocess is spawned
- **THEN** `buildSpawnOptions()` SHALL throw (fail closed) rather than granting the agent unmediated open egress

#### Scenario: Graceful degradation without silent open egress
- **GIVEN** full isolation is required but the network-namespace mechanism is unavailable (e.g. unprivileged user namespaces disabled, or not on Linux)
- **WHEN** `buildSpawnOptions()` is called in a posture that expects mediation
- **THEN** it SHALL fail closed with an actionable error and SHALL NOT silently fall through to unmediated open egress; unrestricted egress SHALL require the explicit opt-in

### Requirement: Sandbox Configuration

Sandbox settings SHALL be configurable via `config.yaml` and environment variable overrides.

#### Scenario: Environment variable overrides
- **GIVEN** `AGENT_SANDBOX_FILTER_ENV`, `AGENT_SANDBOX_NETWORK_ISOLATION`, `AGENT_SANDBOX_ALLOWED_ENV_VARS`, or `AGENT_SANDBOX_ALLOWED_WRITE_EXTENSIONS` env vars
- **WHEN** configuration is loaded
- **THEN** they SHALL override the corresponding `agent.sandbox.*` config values

#### Scenario: Egress allowlist configurable via env override
- **GIVEN** the `AGENT_SANDBOX_EGRESS_ALLOW_HOSTS` env var set to a comma-separated list (e.g. `192.168.1.10,internal-proxy`)
- **WHEN** configuration is loaded
- **THEN** it SHALL override `agent.sandbox.egressAllowHosts` with the trimmed, non-empty entries

#### Scenario: Egress allowlist defaults to empty
- **GIVEN** neither `config.yaml` nor the environment configures `egressAllowHosts`
- **WHEN** configuration is loaded
- **THEN** `agent.sandbox.egressAllowHosts` SHALL default to an empty list and the egress posture SHALL be identical to the pre-allowlist behavior
