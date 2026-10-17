# Spec Delta

## ADDED Requirements

### Requirement: Third-party response accounting

Successful third-party SMTP submission SHALL count as a session response without changing the initiating user reply anchor.

#### Scenario: Third-party only

- **WHEN** send-email succeeds and agent completes without send-reply
- **THEN** no missing-response email is manufactured and all user anchor IDs are unchanged

### Requirement: Unknown suppresses retry

Uncertain email submission SHALL suppress automatic missing-response and crash-recovery delivery attempts while exposing review-required status.

#### Scenario: Unknown failed result

- **WHEN** send-email or send-file returns success false with unknown submission
- **THEN** response/quota rollback cannot authorize a duplicate send

### Requirement: Durable response recovery

Retry and recovery SHALL consult durable logical operation evidence across all email paths and execution modes.

#### Scenario: API reply lost

- **WHEN** SMTP accepted but the skill HTTP response is lost and pooled agent reconnects
- **THEN** recorded operation suppresses another SMTP transaction

## MODIFIED Requirements

### Requirement: Reply Rules

The system SHALL enforce per-session reply limits: `send-reply` SHALL be limited to one successful call per session (`MAX_REPLIES_PER_SESSION = 1`), and attempts at or beyond `MAX_REPLY_ATTEMPTS_BEFORE_TERMINATE = 4` SHALL terminate the agent (the send-reply doom-loop).

#### Scenario: Second send-reply rejected

- **GIVEN** a session where `send-reply` has already been called once
- **WHEN** `send-reply` is called again
- **THEN** the server SHALL return HTTP 429 with an error message

#### Scenario: Doom-loop terminates agent

- **GIVEN** a session where `send-reply` has been attempted 4 times
- **WHEN** the 4th attempt is detected
- **THEN** in per-spawn mode the system SHALL invoke `onTerminateRequest` to terminate the per-session agent subprocess
- **AND** in shared-process mode it SHALL cancel the current ACP session via `session/cancel` and SHALL NOT terminate the shared channel process

#### Scenario: edit-reply before send-reply fails

- **GIVEN** a session where no reply has been sent yet
- **WHEN** `edit-reply` is called
- **THEN** the handler SHALL return an error "No reply has been sent yet. Use send-reply first."

#### Scenario: send-file does not consume the reply quota

- **GIVEN** a session where `send-file` has been called successfully
- **WHEN** `send-reply` is called afterwards
- **THEN** the `send-reply` SHALL NOT be rejected by the one-call limit

#### Scenario: Second send-file rejected

- **GIVEN** a session where `send-file` has already succeeded once
- **WHEN** `send-file` is called again
- **THEN** the server SHALL return HTTP 429 with an error message

#### Scenario: send-file in a triggerless session rejected

- **GIVEN** a session registered without a trigger event (e.g. spontaneous or reminder delivery)
- **WHEN** `send-file` is called
- **THEN** the server SHALL return HTTP 403 with an instructive error
- **AND** no file-send state or quota slot SHALL be recorded

#### Scenario: send-file doom-loop terminates agent

- **GIVEN** a session where `send-file` has been attempted 4 times
- **WHEN** the 4th attempt is detected
- **THEN** the system SHALL invoke `onTerminateRequest` (per-spawn: process termination; shared: `session/cancel`)

#### Scenario: Identical repeated attempts still reach the doom-loop gate

- **GIVEN** a session where `send-file` has succeeded once
- **WHEN** the agent repeats the exact same rejected `send-file` request 3 more times within the dedup-cache window
- **THEN** each attempt SHALL be re-executed (not served from cache) and the 4th attempt SHALL trigger agent termination

#### Scenario: edit-reply requires a prior reply and has its own doom-loop

- **GIVEN** a session
- **WHEN** `edit-reply` is called
- **THEN** it SHALL require a prior successful `send-reply` (`replySent = true`)
- **AND** if `edit-reply` is called 3 or more times (`MAX_EDIT_CALLS_BEFORE_TERMINATE = 3`), the system SHALL terminate the agent (per-spawn: process termination; shared-process: `session/cancel`)

#### Scenario: send-file has its own one-call quota

- **GIVEN** a session
- **WHEN** `send-file` is called
- **THEN** it SHALL be limited to 1 successful call per session (`MAX_FILE_SENDS_PER_SESSION = 1`; a multi-file batch counts as one call)
- **AND** additional calls SHALL be rejected with HTTP 429, and if `send-file` is attempted 4 or more times (`MAX_FILE_SEND_ATTEMPTS_BEFORE_TERMINATE = 4`) the system SHALL terminate the agent via `onTerminateRequest` (doom-loop protection)

#### Scenario: send-file is a distinct communication channel

- **GIVEN** a successful `send-file` call
- **WHEN** the session response is evaluated
- **THEN** `send-file` SHALL NOT be tracked by the reply count/doom-loop counters, SHALL NOT set `replySent`, SHALL NOT update the session's `lastSentMessageId`, and SHALL NOT trigger conversation summary generation
- **AND** it SHALL be tracked via the session file-send state, counted as successful when at least one file was delivered

#### Scenario: send-file rejected in triggerless sessions

- **GIVEN** a triggerless session (spontaneous, self-research, memory-maintenance, reminders)
- **WHEN** `send-file` is called
- **THEN** the session SHALL be rejected with HTTP 403, because such sessions only track replies and an untracked file send would cause duplicate output or repeat delivery

#### Scenario: send-file results bypass the deduplication cache

- **GIVEN** a `send-file` skill invocation
- **WHEN** it completes
- **THEN** the result SHALL NOT be served from the request deduplication cache
- **AND** the quota/doom-loop gate SHALL run on every attempt, including identical repeated calls

#### Scenario: Minimum response requirement triggers retry

- **GIVEN** a session that completed with no reply, reaction, file send, submitted email or uncertain email
- **WHEN** the agent completes
- **THEN** at least one reply (`send-reply`), reaction (`react-message`), or file send (`send-file`) SHALL have been produced per session
- **AND** if none of the three occurs, the retry mechanism SHALL trigger

#### Scenario: Email submission override

- **WHEN** any email path has a submitted or unknown durable operation for the current logical work
- **THEN** the generic missing-response predicate and quota rollback SHALL NOT authorize a new mail submission
- **AND** submitted third-party mail SHALL satisfy response accounting without writing normal reply anchors, while unknown SHALL return review-required without claiming successful delivery

### Requirement: Retry on Missing Reply

The system SHALL automatically retry when an ACP Agent completes a prompt turn (`stopReason === "end_turn"`) without a recorded reply, reaction or file response, including partial file delivery regardless of the API success flag, unless durable email submission or uncertainty suppresses retry. The retry SHALL clear only safe pre-submission reply state, send a second prompt on the same ACP session requesting a response subject to delivery-outcome guidance, and if the retry also fails, return a failure response. A session that produced a reply, a reaction, or a file send, including partial file delivery, SHALL NOT be retried. The retry prompt SHALL be instructive and agent-portable in every spawn shape (per-spawn and pooled). It SHALL state the absence of a recorded supported response without treating missing state as proof of non-delivery. It SHALL list the likely payload-file failure causes, including rejected legacy `--message`/`--caption` flags, an unwritten payload, a payload outside the session staging directory, or a previous errored call whose output must be read. It SHALL give the correct two-step example naming the literal active Skill API session id and absolute staging directory, writing through the edit/write tool before invoking the payload-file flag. For non-email it SHALL include the full trusted `send-reply`, `react-message`, and `send-file` SKILL.md content; for email it SHALL include only supported reply/file and grant-appropriate email instructions without reaction guidance. File-tool and payload-flag instructions SHALL contain no unexpanded `$TMPDIR`/`$SESSION_ID` tokens. Retry timing, attempt limits and reply-quota authority SHALL remain unchanged. The prompt SHALL permit corrected sending only after confirmed pre-delivery failure and SHALL defer uncertain or partially delivered results to the owning delivery guidance.

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
- **AND** for non-email it SHALL include the full trusted `send-reply`, `react-message`, and `send-file` SKILL.md content; email SHALL include only supported `send-reply`/`send-file` guidance and grant-appropriate email instructions without reaction guidance

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

#### Scenario: Email submission override

- **WHEN** any email path has a submitted or unknown durable operation for the current logical work
- **THEN** the generic missing-response predicate and quota rollback SHALL NOT authorize a new mail submission
- **AND** submitted third-party mail SHALL satisfy response accounting without writing normal reply anchors, while unknown SHALL return review-required without claiming successful delivery

### Requirement: Send-File Response Tracking

The system SHALL track successful `send-file` calls as session responses: `SessionRegistry` SHALL maintain a per-session `fileSent` flag (initialized `false`) with `markFileSent(sessionId)` and `hasFileSent(sessionId)`, and the orchestrator SHALL treat the agent as responded when `replySent || reactionSent || fileSent || emailSubmitted` is true.

#### Scenario: File send counts as a response

- **GIVEN** a session where the agent called `send-file` successfully but neither `send-reply` nor `react-message`
- **WHEN** the agent's turn completes
- **THEN** `fileSent` SHALL be `true`
- **AND** the session SHALL be treated as successful without retrying

#### Scenario: File send records the delivered message ID

- **GIVEN** a session where `send-file` delivered a single message `file-1`
- **WHEN** the Skill API server processes the successful result
- **THEN** `lastFileMessageId` SHALL be set to `file-1`
- **AND** `lastSentMessageId` SHALL remain unset

#### Scenario: Partial file delivery counts as a response and records the last delivered ID

- **GIVEN** a Misskey chat session where 2 of 3 files were delivered (message IDs `file-1`, `file-2`) before a mid-batch failure
- **WHEN** the agent's turn completes
- **THEN** `fileSent` SHALL be `true`
- **AND** `lastFileMessageId` SHALL be `file-2` (the last delivered message)
- **AND** the missing-response retry SHALL NOT trigger

#### Scenario: Total failure records no file ID

- **GIVEN** a session where a `send-file` call fails with no delivered messages
- **WHEN** the Skill API server processes the failed result
- **THEN** `fileSent` SHALL NOT be marked
- **AND** `lastFileMessageId` SHALL NOT be set

#### Scenario: Delivery without a usable message ID records no anchor

- **GIVEN** a `send-file` result that reports delivered files but carries neither `messageId` nor a usable `messageIds` entry
- **WHEN** the Skill API server processes the result
- **THEN** `fileSent` SHALL be marked (files were delivered)
- **AND** `lastFileMessageId` SHALL NOT be set
- **AND** a warning SHALL be logged

#### Scenario: Partial file delivery counts as a response

- **GIVEN** a Misskey chat session where 1 of 2 files was delivered before a mid-batch failure
- **WHEN** the agent's turn completes
- **THEN** `fileSent` SHALL be `true`
- **AND** the missing-response retry SHALL NOT trigger

#### Scenario: File-send state is per-session

- **GIVEN** two consecutive sessions for the same workspace:channel, the first delivering a file
- **WHEN** the second session's agent completes without any response
- **THEN** the second session SHALL NOT inherit the first session's `fileSent` state
- **AND** the missing-response retry SHALL trigger for the second session

#### Scenario: File-send disabled yields false

- **GIVEN** the `send-file` skill is disabled in configuration
- **WHEN** the orchestrator evaluates the session response
- **THEN** `fileSent` SHALL be `false` (the Skill API server never marks it because the skill is not registered)

#### Scenario: Error dispatch skipped after file send

- **GIVEN** a session that ends with `success: false` but `fileSent: true`
- **WHEN** the reply dispatcher evaluates the response
- **THEN** no error message SHALL be dispatched to the platform

#### Scenario: fileSent marked only when at least one file is delivered

- **GIVEN** a `send-file` skill result
- **WHEN** the Skill API server processes it
- **THEN** the server SHALL call `markFileSent()` when at least one file was delivered to the platform (including partial Misskey chat delivery)
- **AND** it SHALL NOT be marked on total failure

#### Scenario: lastFileMessageId recorded on delivery

- **GIVEN** a `send-file` result with at least one delivered file
- **WHEN** the Skill API server processes it
- **THEN** it SHALL record the last delivered message ID as the session's `lastFileMessageId` via `setLastFileMessageId()`, resolving it from the result data as `messageId`, else the last entry of `messageIds`
- **AND** if the result carries no usable message ID at all, the server SHALL log a warning and record nothing (the reply anchor stays on the trigger; it SHALL NOT record a bogus ID)
- **AND** on total failure it SHALL NOT record any ID

#### Scenario: File ID roles stay strictly separate

- **GIVEN** a session's message-ID state
- **WHEN** a skill writes an ID
- **THEN** `lastFileMessageId` SHALL NEVER be written by `send-reply`, `edit-reply`, or any other skill, and `lastSentMessageId` SHALL NEVER be written by `send-file`

#### Scenario: Orchestrator treats missing session as fileSent false

- **GIVEN** the session orchestrator reads `hasFileSent(sessionId)`
- **WHEN** the session is missing or expired
- **THEN** it SHALL be treated as `fileSent: false`
- **AND** the orchestrator SHALL consider the agent responded only when `replySent || reactionSent || fileSent || emailSubmitted` is true

#### Scenario: File-send state is scoped to the session record

- **WHEN** the session orchestrator evaluates success
- **THEN** the file-sent state SHALL live on the session record, so it is inherently cleared when the session ends and can never leak across concurrent sessions on the same channel
- **AND** the `SessionResponse` SHALL include a `fileSent` boolean, set to `false` explicitly in every flow that does not track file sends
- **AND** error-message dispatch SHALL be skipped when `fileSent` is true

#### Scenario: Email submission override

- **WHEN** any email path has a submitted or unknown durable operation for the current logical work
- **THEN** the generic missing-response predicate and quota rollback SHALL NOT authorize a new mail submission
- **AND** submitted third-party mail SHALL satisfy response accounting without writing normal reply anchors, while unknown SHALL return review-required without claiming successful delivery
