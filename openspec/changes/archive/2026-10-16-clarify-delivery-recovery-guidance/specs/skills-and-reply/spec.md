# Spec Delta

## MODIFIED Requirements

### Requirement: Retry on Missing Reply

The system SHALL automatically retry when an ACP Agent completes a prompt turn (`stopReason === "end_turn"`) without a recorded reply, reaction or file response, including partial file delivery regardless of the API success flag. The retry SHALL clear the reply state, send a second prompt on the same ACP session requesting a response subject to delivery-outcome guidance, and if the retry also fails, return a failure response. A session that produced a reply, a reaction, or a file send, including partial file delivery, SHALL NOT be retried. The retry prompt SHALL be instructive and agent-portable in every spawn shape (per-spawn and pooled). It SHALL state that the turn ended without a recorded reply, reaction, or file send, without treating missing recorded state as proof of non-delivery. It SHALL list the likely payload-file failure causes, including rejected legacy `--message`/`--caption` flags, an unwritten payload, a payload outside the session staging directory, or a previous errored call whose output must be read. It SHALL give the correct two-step example naming the literal active Skill API session id and absolute staging directory, writing through the edit/write tool before invoking the payload-file flag. It SHALL include the full trusted `send-reply`, `react-message`, and `send-file` SKILL.md content. File-tool and payload-flag instructions SHALL contain no unexpanded `$TMPDIR`/`$SESSION_ID` tokens. Retry timing, attempt limits and reply-quota authority SHALL remain unchanged. The prompt SHALL permit corrected sending only after confirmed pre-delivery failure and SHALL defer uncertain or partially delivered results to the owning delivery guidance.

#### Scenario: Successful retry produces reply
- **GIVEN** an agent completes without sending a reply, reaction, or file
- **WHEN** the retry mechanism triggers
- **THEN** the system SHALL send a retry prompt on the same session
- **AND** if the agent successfully calls `send-reply` during retry, the session SHALL succeed

#### Scenario: Failed retry returns error
- **GIVEN** an agent completes without a reply and the retry also fails
- **WHEN** the retry prompt completes without a recorded reply, reaction or file response, including partial file delivery regardless of the API success flag
- **THEN** the system SHALL return a failure response indicating the agent did not produce a recorded response

#### Scenario: Retry prompt explains the cause and the correct pattern
- **GIVEN** an agent that ended its turn without a reply after a rejected `--message` invocation
- **WHEN** the retry prompt is sent
- **THEN** the prompt SHALL explain that the turn ended without a recorded reply and that `--message` is unsupported
- **AND** it SHALL instruct writing the payload to the session's absolute staging directory and passing it via `--message-file`
- **AND** it SHALL name the literal session id and absolute staging directory without unexpanded `$TMPDIR`/`$SESSION_ID` instruction tokens
- **AND** it SHALL include the full trusted `send-reply`, `react-message`, and `send-file` SKILL.md content

#### Scenario: Per-spawn retry carries the same literal guidance as pooled
- **GIVEN** a per-spawn session whose process environment exports a session `SESSION_ID`
- **WHEN** its missing-reply retry prompt is built
- **THEN** the retry text SHALL name the literal session id and absolute staging directory rather than shell tokens
- **AND** the prompt SHALL remain actionable if the agent ignores the environment entirely

#### Scenario: File-only session is not retried
- **GIVEN** an agent completes after successful `send-file` without a reply or reaction
- **WHEN** the missing-response check runs
- **THEN** the retry mechanism SHALL NOT trigger
- **AND** the session SHALL be successful with `fileSent: true`

#### Scenario: Retry prompt lists payload-file failure causes
- **GIVEN** an agent ends its turn without a recorded reply, reaction, or file send
- **WHEN** the retry prompt is sent
- **THEN** it SHALL state the absence of a recorded response
- **AND** it SHALL list rejected legacy `--message`/`--caption` flags, an unwritten payload, a payload outside the named absolute session staging directory, and previous skill-call errors whose output must be read
- **AND** it SHALL NOT equate an arbitrary script error with confirmed non-delivery

#### Scenario: Retry prompt gives the correct two-step example
- **GIVEN** an agent whose reply or file send failed before delivery under the payload-file contract
- **WHEN** the retry prompt is sent
- **THEN** it SHALL show writing the payload under the rendered absolute staging directory and invoking the script with the absolute payload-file path

#### Scenario: Ambiguous previous send remains ambiguous during retry
- **GIVEN** the registry has no recorded response after a transport failure that may have followed platform delivery
- **WHEN** the existing missing-response retry is offered
- **THEN** its instructions SHALL require available authoritative evidence to be inspected before considering another send
- **AND** unresolved ambiguity SHALL NOT authorize resending
- **AND** the corrective-turn limit SHALL remain one

## ADDED Requirements

### Requirement: Delivery Recovery Instructions Depend on Outcome

The send-reply skill SHALL own delivery-recovery guidance. Confirmed success SHALL prohibit resending and require exit except for a known-error correction in the active session. Confirmed pre-delivery failure SHALL permit correction within existing quotas. Uncertain delivery SHALL require available authoritative evidence to be inspected; unresolved uncertainty SHALL prohibit resend. Reply templates SHALL reference this policy without duplication.

#### Scenario: Local payload failure is recoverable
- **GIVEN** `SKILL_LEGACY_FLAG`, `SKILL_MISSING_PAYLOAD`, `SKILL_PAYLOAD_OUT_OF_BOUNDS` or `SKILL_PAYLOAD_NOT_FOUND` rejects a send before the Skill API is called
- **WHEN** the agent reads the documented remedy
- **THEN** the instructions SHALL permit correcting the payload or invocation and trying again within existing limits
- **AND** they SHALL NOT claim that an unused delivery quota was consumed

#### Scenario: Successful reply ends the turn
- **GIVEN** the reply skill returns confirmed success
- **AND** no concrete error is already known
- **WHEN** the agent follows the delivery instructions
- **THEN** it SHALL exit without further checking or another send

#### Scenario: Known error permits a scoped correction before exit
- **GIVEN** a concrete error in the delivered text is already known when success is acknowledged and the current session is still active
- **WHEN** the agent follows the correction exception
- **THEN** instructions SHALL permit the necessary correction-payload write and scoped `edit-reply` using the session's current text-reply ID within the existing edit quota
- **AND** they SHALL require exit after that correction attempt without a follow-up `send-reply`, proactive readback or unrelated work
- **AND** they SHALL NOT promise another correction turn or editing after the session ends

#### Scenario: A transport error is not a pre-delivery rejection
- **GIVEN** a timeout, cancellation, connection loss or generic platform error after dispatch may have occurred
- **WHEN** recovery instructions are consulted
- **THEN** they SHALL treat the outcome as uncertain unless available evidence establishes otherwise
- **AND** they SHALL NOT claim that a rolled-back server flag proves non-delivery

### Requirement: Delivery Inspection Uses Existing Evidence Within Its Limits

Recovery instructions SHALL use existing skill results and `get-message` only within their available message-ID contract. They SHALL NOT promise a delivery-status endpoint, hidden registry access or idempotency. An absent ID or failed lookup SHALL NOT prove non-delivery, and a file-message lookup SHALL NOT confirm a text reply.

#### Scenario: Known message can be inspected
- **GIVEN** a usable message ID or a recorded session last-text or last-file ID exists
- **WHEN** an uncertain result requires inspection
- **THEN** instructions SHALL permit `get-message` using an explicit ID or its existing text-then-file fallback
- **AND** the agent SHALL distinguish the fetched message's role before concluding what was delivered

#### Scenario: No authoritative negative result is available
- **GIVEN** an ambiguous send has no usable recorded message ID, or lookup fails
- **WHEN** the agent follows recovery instructions
- **THEN** it SHALL retain the uncertain outcome and refrain from automatic resend
- **AND** it SHALL NOT invent a status API, scan privileged state or treat quota rollback as proof

### Requirement: Partial File Delivery Guidance Preserves the Consumed Slot

The send-file skill SHALL own its partial-delivery instructions. A failed result carrying positive `filesCount` or delivered message IDs SHALL be treated as delivered output for resend decisions. Instructions SHALL prohibit resending the batch or its remainder in the same session, preserve the consumed file-send slot, and preserve the separate text-reply quota and threading contract.

#### Scenario: Misskey chat fails after its first file
- **GIVEN** a batch result reports an error and one delivered message ID with `filesCount: 1`
- **WHEN** the agent follows the file skill instructions
- **THEN** it SHALL NOT resend any part of the batch
- **AND** the result SHALL still count as a session response, suppressing the missing-response retry
- **AND** a still-pending text reply SHALL remain permitted within its own quota, threaded to the last delivered file message

#### Scenario: Total preflight failure is distinct
- **GIVEN** validation or payload rejection establishes failure before any platform send
- **WHEN** the documented error is corrected
- **THEN** instructions SHALL permit a new file invocation within the existing unused slot
- **AND** a generic post-dispatch error without delivered IDs SHALL remain uncertain
