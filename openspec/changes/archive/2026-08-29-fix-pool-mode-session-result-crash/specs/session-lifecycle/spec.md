# Delta: session-lifecycle

## ADDED Requirements

### Requirement: Session response finalization

Every `process*` method SHALL resolve with a `SessionResponse` object on ALL completion paths — success, no-reply, queue-deadline cancellation, lurk-trigger skip, and idle-timeout session loss — and SHALL NOT let post-session bookkeeping (the `finally` block that records session metrics) throw in place of that response. Post-session metrics SHALL be recorded with the `success` value of the response ACTUALLY returned; a bookkeeping failure SHALL be logged and swallowed, never propagated, and never replace a computed response.

#### Scenario: Pooled message session resolves cleanly
- **GIVEN** shared-process (pool) mode is active
- **WHEN** `processMessage()` completes a turn in which the agent sent a reply
- **THEN** it SHALL resolve with `{ success: true, replySent: true, ... }`
- **AND** the session metrics SHALL have been recorded with `success: true`
- **AND** no "Cannot read properties of undefined (reading 'success')" error SHALL surface to the platform event handler

#### Scenario: Early-return paths still record metrics accurately
- **GIVEN** a session run is cancelled by the queue deadline (or skips a stale lurk trigger, or loses its agent connection on idle-timeout reconnect)
- **WHEN** the corresponding early-return branch completes
- **THEN** the method SHALL resolve with that branch's exact `SessionResponse`
- **AND** session metrics SHALL be recorded once with the `success` value of THAT response

#### Scenario: Bookkeeping failure cannot replace the response
- **GIVEN** the metrics-recording step throws unexpectedly
- **WHEN** a `process*` method's `finally` runs
- **THEN** the error SHALL be logged
- **AND** the originally computed `SessionResponse` SHALL still be returned to the caller
