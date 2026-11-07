# Spec Delta

## Purpose

Defines what a `node:net` and `node:dns/promises` egress proxy must prove under Bun, preserving the SSRF guarantees of the current proxy, before the Bun migration may proceed.

## ADDED Requirements

### Requirement: Full Address Validation

The proxy SHALL resolve both A and AAAA records and SHALL deny a host when any answer in either family is disallowed.

#### Scenario: Disallowed AAAA behind a public A
- **GIVEN** a host with a public A record and a loopback AAAA record
- **WHEN** the host is validated
- **THEN** it SHALL be denied

#### Scenario: Disallowed A behind a public AAAA
- **GIVEN** a host with a private A record and a public AAAA record
- **WHEN** the host is validated
- **THEN** it SHALL be denied

#### Scenario: Both families queried
- **GIVEN** a host with public records in both families
- **WHEN** the host is validated
- **THEN** it SHALL be allowed and the DNS server SHALL have received one A and one AAAA query

### Requirement: Metadata Addresses Stay Blocked

Cloud-metadata addresses SHALL be denied in every spelling, whether or not the host is allowlisted.

#### Scenario: Allowlisted host resolves to metadata
- **GIVEN** an allowlisted host whose A record is `169.254.169.254`
- **WHEN** the host is validated
- **THEN** it SHALL be denied

#### Scenario: Mapped literal
- **GIVEN** the IPv4-mapped IPv6 form of the metadata address
- **WHEN** it is checked
- **THEN** it SHALL be identified as a metadata address

### Requirement: Connection Pinned To Validated Address

The proxy SHALL connect to the address it validated and SHALL perform no second resolution.

#### Scenario: Rebinding answer
- **GIVEN** a DNS server answering `127.0.0.1` first and `127.0.0.2` afterward for an allowlisted host
- **WHEN** a client issues `CONNECT` for that host
- **THEN** the listener on `127.0.0.1` SHALL get the connection, the listener on `127.0.0.2` SHALL get none, and exactly one A query SHALL have been made

### Requirement: Tunnel Integrity

A `CONNECT` tunnel SHALL carry large transfers unchanged in both directions when a side reads slowly.

#### Scenario: Large transfer with a slow reader
- **GIVEN** an established tunnel and a client that pauses reading for 200 ms during the transfer
- **WHEN** 32 MiB is sent in each direction
- **THEN** the SHA-256 on each receiving side SHALL equal the sent SHA-256

### Requirement: Half-Close Propagation

The proxy SHALL forward a half-close to the other side and keep the opposite direction open until it ends.

#### Scenario: Client half-close
- **GIVEN** an established tunnel
- **WHEN** the client ends its side and the upstream then writes a reply
- **THEN** the upstream SHALL see end of stream and the client SHALL still receive the reply

#### Scenario: Upstream close
- **GIVEN** an established tunnel
- **WHEN** the upstream closes
- **THEN** the client SHALL see end of stream within 1 second

#### Scenario: Peer failure mid-transfer
- **GIVEN** an established tunnel carrying a large transfer
- **WHEN** one side is destroyed
- **THEN** the other side SHALL close and the tunnel SHALL finish within 2 seconds

### Requirement: Plain HTTP Forwarding

The proxy SHALL rewrite a plain HTTP request to origin form with `Connection: close`, dropping client `Connection` and `Proxy-Connection` headers, so one connection serves one validated request.

#### Scenario: Rewritten request
- **GIVEN** an absolute-form `GET` for an allowlisted host with `Proxy-Connection: keep-alive`
- **WHEN** it is forwarded
- **THEN** the upstream SHALL receive the origin-form request line, `Connection: close` and no `Proxy-Connection` header

#### Scenario: Pipelined second request
- **GIVEN** a client that sends two requests in one write
- **WHEN** the proxy forwards them
- **THEN** the client SHALL receive exactly one response

### Requirement: Allowlist Semantics

The allowlist SHALL exempt exact hosts from the disallowed-range rejection only, and malformed entries SHALL match nothing.

#### Scenario: Exact entry and neighbor
- **GIVEN** an allowlist holding one private literal
- **WHEN** that literal and a neighboring address are checked
- **THEN** the literal SHALL be allowed and the neighbor SHALL be denied

#### Scenario: Bracketed IPv6
- **GIVEN** an allowlist holding an IPv6 literal
- **WHEN** the bracketed form is checked
- **THEN** it SHALL match

#### Scenario: Malformed entries
- **GIVEN** entries with a scheme, a port or a path
- **WHEN** a matching host is checked
- **THEN** it SHALL be denied

### Requirement: Refusal Responses

The proxy SHALL answer refused targets with 403, malformed requests with 400 and unreachable upstreams with 502, and close the connection.

#### Scenario: Refused CONNECT
- **GIVEN** a `CONNECT` to a loopback target that is not allowlisted
- **WHEN** the proxy handles it
- **THEN** it SHALL reply 403

#### Scenario: Unsupported scheme
- **GIVEN** an absolute-form request with an `ftp` URL
- **WHEN** the proxy handles it
- **THEN** it SHALL reply 403

#### Scenario: Malformed request
- **GIVEN** a request line with no target
- **WHEN** the proxy handles it
- **THEN** it SHALL reply 400

#### Scenario: Unreachable upstream
- **GIVEN** a `CONNECT` to an allowlisted closed port
- **WHEN** the proxy handles it
- **THEN** it SHALL reply 502
