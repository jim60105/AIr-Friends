# Spec Delta

## MODIFIED Requirements

### Requirement: Egress Proxy Transport Fidelity

The validating egress proxy (`src/utils/egress-proxy.ts`) SHALL relay bytes between the agent and the upstream origin without altering or losing them, and SHALL propagate connection lifecycle events in both directions, so the mediation layer does not itself become a source of corrupted streams or zombie connections.

#### Scenario: Short writes are fully flushed
- **GIVEN** a tunneled transfer large enough that the peer socket's write buffer fills (TCP backpressure)
- **WHEN** the proxy relays a chunk to the peer, or writes a control response / rewritten request head
- **THEN** it SHALL stop reading from the source until the peer drains, and the payload SHALL arrive byte-exact (a dropped remainder would corrupt the tunneled TLS stream)

#### Scenario: Upstream close is propagated to the client
- **GIVEN** an established CONNECT tunnel whose upstream closes an idle keep-alive connection
- **WHEN** the proxy observes EOF on that direction
- **THEN** it SHALL forward the half-close to the client immediately rather than waiting for the opposite direction to drain, so the client's connection pool observes the closure instead of reusing a dead tunnel

#### Scenario: Transport error tears down both directions
- **GIVEN** an established tunnel
- **WHEN** either direction errors (e.g. connection reset)
- **THEN** the proxy SHALL close both connections so the opposite direction unblocks rather than hanging until the session idle timeout

#### Scenario: Forwarded plain-HTTP requests are forced to close semantics
- **GIVEN** a plain-HTTP request the client sent with `Connection: keep-alive` (or `Proxy-Connection`)
- **WHEN** the proxy rewrites the absolute-form request line to origin-form for forwarding
- **THEN** it SHALL drop the client's `Connection`/`Proxy-Connection` headers and emit `Connection: close`, and SHALL preserve any body bytes already read with the head
- **AND** the upstream SHALL therefore end the connection after one response, preventing a keep-alive client from smuggling a second, unvalidated request through the raw tunnel to the same upstream

## ADDED Requirements

### Requirement: Egress Resolution Happens Once Per Connection

The egress proxy SHALL resolve a hostname once per client request, validate every A and AAAA answer, and connect to the validated address without resolving again.

#### Scenario: Rebinding answer is not followed
- **GIVEN** an allowlisted hostname whose DNS server answers `127.0.0.1` to the first A query and `127.0.0.2` afterward, with listeners on both addresses and the same port
- **WHEN** a client issues `CONNECT` for that hostname
- **THEN** the `127.0.0.1` listener SHALL receive the connection, the `127.0.0.2` listener SHALL receive none, and exactly one A query SHALL have been made

#### Scenario: Disallowed AAAA behind a public A
- **GIVEN** a hostname with a public A record and a loopback AAAA record
- **WHEN** a client issues `CONNECT` for it
- **THEN** the proxy SHALL reply 403
