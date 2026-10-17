# Spec Delta

## MODIFIED Requirements

### Requirement: Retry on Missing Reply

The system SHALL automatically retry when an ACP Agent completes a prompt turn (`stopReason === "end_turn"`) without a recorded reply, reaction or file response. The retry SHALL clear only safe pre-submission reply state and send a second prompt on the same ACP session; if that retry also fails, the system SHALL return a failure response.

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

### Requirement: Instructive Skill Error Messages

Skill script contract failures SHALL produce structured, instructive errors that teach the correct usage so the agent can self-correct mid-turn, each carrying a stable `code` and a guidance message, without calling the Skill API.

#### Scenario: Legacy flag error teaches the payload-file flow
- **GIVEN** an agent invokes `send-reply` with `--message "定價 $0.435"` or `--message=定價`
- **WHEN** the script rejects the invocation
- **THEN** the error SHALL have code `SKILL_LEGACY_FLAG`, SHALL state that command-line message content is no longer supported because shell expansion corrupts or leaks it, and SHALL include the correct two-step example: write the text to the session staging directory shown in the system prompt (e.g. `{staging}/reply.md`) with the edit/write tool, then invoke with `--message-file` pointing at that file
- **AND** the script SHALL NOT call the Skill API

#### Scenario: Missing payload flag error names the required flag
- **GIVEN** an invocation of a required-payload skill (e.g. `send-reply`) with neither the legacy flag nor a payload-file flag
- **WHEN** the script rejects the invocation
- **THEN** the error SHALL have code `SKILL_MISSING_PAYLOAD`, SHALL name the required flag (`--message-file`), and SHALL include the two-step flow with a concrete example

#### Scenario: Out-of-bounds payload error explains the staging location
- **GIVEN** an agent passes a payload path outside the session staging directory (e.g. `memory.private.jsonl`, `~/.git-credentials`, a sibling session's directory, or a symlink escaping the staging directory)
- **WHEN** the script rejects the payload
- **THEN** the error SHALL have code `SKILL_PAYLOAD_OUT_OF_BOUNDS`, SHALL name the resolved staging base the script enforced, explain that the payload must be written under that directory (the session's own staging directory) and why (the script refuses to send the content of arbitrary files), and SHALL show the correct form
- **AND** the guidance SHALL direct the agent to the staging directory rendered in its system prompt rather than assuming a `$TMPDIR`/`$SESSION_ID` shell environment

#### Scenario: Missing payload file error instructs staging first
- **GIVEN** an agent passes a payload-file flag pointing at a file that does not exist or cannot be read
- **WHEN** the script rejects the payload
- **THEN** the error SHALL have code `SKILL_PAYLOAD_NOT_FOUND`, SHALL instruct writing the file first with the edit/write tool under the prompt-rendered staging directory, and SHALL show both steps with a concrete example

#### Scenario: Singular send-file flag error teaches repeatable flag
- **GIVEN** an agent invokes `send-file` with `--file-path report.pdf` or `--file-path=report.pdf`
- **WHEN** the script rejects the invocation
- **THEN** the error SHALL have code `SKILL_SINGLE_FILE_FLAG`, SHALL state that `--file-path` was replaced by the repeatable `--file-paths` flag, and SHALL include a copy-pasteable example passing two or more files

#### Scenario: Guidance states what was wrong, why it matters, and the correct pattern
- **GIVEN** a skill script contract failure
- **WHEN** the guidance message is produced
- **THEN** it SHALL state (a) what was wrong, (b) why it matters, and (c) the exact correct pattern with a copy-pasteable example invocation specific to the failing skill
- **AND** the `error` field SHALL be self-contained prose containing the fix and a full example command

#### Scenario: SKILL_SESSION_UNRESOLVED error for an unresolvable shared-mode pointer
- **GIVEN** shared-process mode with a missing, unreadable, or malformed current-session pointer
- **WHEN** the owning session cannot be resolved
- **THEN** the error SHALL have code `SKILL_SESSION_UNRESOLVED`
- **AND** the guidance SHALL name the expected pointer path and the "invoke skills during a live turn" remedy

### Requirement: Payload-File Argument Passing

Skill scripts that carry free-text content SHALL accept that content exclusively through a payload-file flag whose value is the path of a file staged in the session-scoped staging directory, resolved against the script's working directory with boundary-safe containment inside the session staging directory.

#### Scenario: Valid session-scoped payload accepted
- **GIVEN** a session with id `sess_own` whose staging directory is `/abs/workspaces/discord/123/tmp/sess_own` as rendered in its prompt
- **WHEN** `send-reply` is invoked with `--session-id "sess_own"` and `--message-file "/abs/workspaces/discord/123/tmp/sess_own/reply.md"`
- **THEN** the script SHALL resolve the path into its own staging directory, read the file content verbatim (including any `$` characters, newlines, and empty strings), and call the Skill API with that content as the `message` parameter

#### Scenario: Legacy token path still resolves for existing callers
- **GIVEN** a per-spawn session whose shell expanded `--message-file "$TMPDIR/$SESSION_ID/reply.md"` to `{workspace}/tmp/sess_own/reply.md` before the script ran
- **WHEN** `send-reply` is invoked with that expanded path
- **THEN** the script SHALL resolve and read it exactly as before this change
- **AND** a payload helper invoked with a raw (unexpanded) `$TMPDIR`/`$SESSION_ID` token path SHALL retain its current documented resolution behavior

#### Scenario: Shared-mode staging comes only from the pointer
- **GIVEN** shared-process mode and a current-session pointer naming `{staging}={workspace}/tmp` and sessionId `sess_B`
- **WHEN** a script is invoked with `--session-id "sess_A"` (any value) and a payload under `{workspace}/tmp/sess_B/`
- **THEN** the staging base SHALL be `{workspace}/tmp/sess_B` — the pointer's session, not the CLI argument's

#### Scenario: Shared-mode missing pointer fails before touching files
- **GIVEN** shared-process mode with NO readable current-session pointer
- **WHEN** a script is invoked with any `--session-id` value and any payload-file path under another session's staging directory
- **THEN** the script SHALL exit non-zero with code `SKILL_SESSION_UNRESOLVED`
- **AND** it SHALL NOT read, send, or delete the referenced payload file

#### Scenario: Workspace-root file cannot be used as payload
- **GIVEN** an agent workspace whose staging directory is `{workspace}/tmp/sess_own` and whose root contains `memory.private.jsonl`
- **WHEN** a script is invoked with `--message-file memory.private.jsonl` or `--message-file {workspace}/memory.private.jsonl`
- **THEN** the script SHALL reject the payload because the resolved path is outside the session staging directory
- **AND** the script SHALL exit non-zero without calling the Skill API

#### Scenario: Home-anchored or absolute payload rejected
- **GIVEN** an agent with runtime home directory `$HOME`
- **WHEN** a script is invoked with `--message-file ~/.git-credentials`, `--message-file $HOME/.env`, or `--message-file /etc/passwd`
- **THEN** the script SHALL reject the payload because the resolved path is outside the session staging directory
- **AND** the script SHALL exit non-zero without calling the Skill API

#### Scenario: Another session's staging directory rejected
- **GIVEN** a session with id `sess_own` and a sibling session `sess_other` sharing the workspace TMPDIR `{workspace}/tmp`
- **WHEN** a script invoked with `--session-id "sess_own"` receives `--message-file {workspace}/tmp/sess_other/reply.md`
- **THEN** the script SHALL reject the payload because it resolves outside `{workspace}/tmp/sess_own`

#### Scenario: Boundary-safe staging containment
- **GIVEN** a session with id `sess_own` and sibling directories `{workspace}/tmp/sess_own-2` and `{workspace}/tmp/sess_own2`
- **WHEN** a script is invoked with `--message-file {workspace}/tmp/sess_own-2/reply.md` or `--message-file {workspace}/tmp/sess_own2/reply.md`
- **THEN** the script SHALL reject the payload because the resolved path is not inside `{workspace}/tmp/sess_own`

#### Scenario: Symlink escape rejected
- **GIVEN** a session staging directory `{workspace}/tmp/sess_own` containing a symlink `leak.md` pointing at `/etc/passwd` (or at a path outside the staging directory)
- **WHEN** a script is invoked with `--message-file {workspace}/tmp/sess_own/leak.md`
- **THEN** the script SHALL resolve the real path, reject the payload because the real path escapes the staging directory, and SHALL NOT call the Skill API

#### Scenario: Missing payload file rejected
- **GIVEN** no payload file exists at the given path
- **WHEN** a script is invoked with `--message-file {workspace}/tmp/sess_own/nonexistent.md`
- **THEN** the script SHALL exit non-zero with a structured error and SHALL NOT call the Skill API

#### Scenario: Missing required payload flag rejected
- **GIVEN** a script invocation that provides neither the legacy flag nor the payload-file flag
- **WHEN** the script parses its arguments
- **THEN** the script SHALL exit non-zero with an error naming the required payload-file flag

#### Scenario: Optional payload omitted
- **GIVEN** a `send-file` invocation without a caption or a `fetch-context` invocation of type `recent_messages` without a query
- **WHEN** the script parses its arguments
- **THEN** the script SHALL proceed without a payload file, passing no caption/query parameter to the Skill API

#### Scenario: Payload-file flag mapping per skill
- **WHEN** a skill that carries free-text content is invoked
- **THEN** `send-reply`/`edit-reply`/`set-reminder` SHALL use `--message-file`, `send-file` SHALL use `--caption-file`, `memory-save` SHALL use `--content-file`, and `memory-search`/`fetch-context` SHALL use `--query-file`

#### Scenario: REQUIRED and OPTIONAL payload arguments
- **GIVEN** a free-text argument of a skill
- **WHEN** it is declared in the skill contract
- **THEN** a REQUIRED free-text argument SHALL have exactly one payload-file flag
- **AND** an OPTIONAL free-text argument (e.g. `send-file` caption, `fetch-context` query) MAY omit its payload-file flag, and when present SHALL accept exactly one

#### Scenario: Payload staged and written verbatim
- **GIVEN** a payload file staged in the session-scoped TMPDIR
- **WHEN** the agent writes it
- **THEN** it SHALL be written through the ACP filesystem interface (edit/write tool or `writeTextFile`) using the absolute staging directory literal rendered into the agent's prompt, in per-spawn and shared-process mode alike
- **AND** its bytes SHALL be preserved verbatim with no shell interpretation

#### Scenario: Session staging directory pre-created at setup
- **GIVEN** a session is registered
- **WHEN** the shell session is set up
- **THEN** the system SHALL pre-create the session staging directory `{workspace}/tmp/{sessionId}`, because neither the agent's edit/write tool nor `writeTextFile` creates parent directories
- **AND** the directory SHALL be removed with the rest of `{workspace}/tmp` when the last session for the workspace ends

#### Scenario: Only the pointer staging directory is used in shared mode
- **GIVEN** shared-process mode
- **WHEN** a script resolves the staging directory
- **THEN** it SHALL resolve it ONLY from the current-session pointer (`{staging}/{sessionId}` from `active.json`), with no CLI-argument fallback
- **AND** a missing, unreadable, or malformed pointer SHALL make the script fail with the stable `SKILL_SESSION_UNRESOLVED` error BEFORE reading or deleting any payload file

#### Scenario: Strict pointer schema
- **GIVEN** a current-session pointer
- **WHEN** it is validated
- **THEN** `sessionId` and `staging` SHALL both be non-empty strings, and in shared mode `staging` SHALL be an absolute path (the pool writes absolute staging roots)
- **AND** numbers, objects, empty strings, and relative staging SHALL all be malformed and fail identically
- **AND** in per-spawn mode the staging directory SHALL be `{cwd}/tmp/{sessionId}` from the script's own `--session-id` argument (sessions without an id fall back to `{workspace}/tmp`)

#### Scenario: Real-path containment re-checked
- **GIVEN** a payload file that exists
- **WHEN** the script processes it
- **THEN** it SHALL resolve the file's real path (`Deno.realPath`) and SHALL re-check the real path for containment
- **AND** a symlink that escapes the staging directory (e.g. pointing at `/etc/passwd` or into another session's directory) SHALL be rejected

#### Scenario: On success the payload is deleted
- **GIVEN** a successful payload-file invocation
- **WHEN** the script has passed the file content to the Skill API as the corresponding JSON parameter (server-side behavior unchanged)
- **THEN** the script SHALL best-effort delete the payload file afterwards

### Requirement: Agent-Portable Staging And Session Identity

Every prompt surface that instructs skill usage SHALL supply the literal active Skill API session id, trusted absolute skill-script root, and the absolute session staging directory (`{session workspace}/tmp/{literalSkillSessionId}`, the canonical payload staging location independent of any process-level `TMPDIR`); every payload-staging instruction from those prompts and skill instruction files SHALL direct the agent to those literal paths, never to `$TMPDIR`/`$SESSION_ID` shell tokens.

#### Scenario: Rendered prompts name literal id and absolute staging dir
- **GIVEN** a session with Skill API id `sess_42` whose staging directory is `/abs/workspaces/discord/123/tmp/sess_42`
- **WHEN** any payload-staging prompt (system prompt, retry prompt, summary prompt) is rendered for that session
- **THEN** the rendered text SHALL contain the literal `sess_42` and the absolute directory `/abs/workspaces/discord/123/tmp/sess_42`
- **AND** the payload-file/structured-file-tool instructions in the rendered text SHALL contain NO `$TMPDIR` or `$SESSION_ID` token

#### Scenario: Pooled session gets the same literal contract as per-spawn
- **GIVEN** a shared-process (pooled, `SKILL_SHARED_PROCESS=1`) deployment whose process environment has NO `SESSION_ID` variable and a channel-scoped process `TMPDIR`
- **WHEN** a session's prompt and (if needed) its retry prompt are rendered and delivered
- **THEN** the prompts SHALL name that session's own literal Skill API id and its own absolute staging directory
- **AND** the agent's staged payload → script invocation SHALL resolve to the owning session's staging directory without any process-frozen identity

#### Scenario: End-to-end mocked delivery in both spawn shapes
- **GIVEN** a mocked platform and the REAL Skill API handler and reply-handler logic
- **WHEN** a per-spawn session and a pooled session each stage a payload at the prompt-rendered absolute path and invoke `send-reply` through the real script payload contract
- **THEN** exactly the intended reply SHALL be recorded for each session with NO duplicate retry or fallback delivery
- **AND** the staging path consumed by the handler SHALL be the same absolute directory the prompt named

#### Scenario: Prompt surfaces that instruct skill usage
- **GIVEN** prompt surfaces that instruct skill usage: normal message, spontaneous post, channel lurk, self-research, conversation summary, memory maintenance (workspace and channel), scheduled reminder, and the missing-reply retry prompt
- **WHEN** any of them is rendered for a session
- **THEN** it SHALL supply the literal active Skill API session id and the absolute session staging directory (`{session workspace}/tmp/{literalSkillSessionId}`)

#### Scenario: Skill instruction files direct to the same literal paths
- **GIVEN** skill instruction files (`skills/*/SKILL.md`) and skill script error/example text that give payload-staging instructions for structured file tools and payload-file flags
- **WHEN** the agent follows those instructions to stage a payload
- **THEN** the instructions SHALL direct the agent to the literal session staging directory and session id, never to `$TMPDIR`/`$SESSION_ID` shell tokens
- **AND** the payload-staging instructions covered by this requirement SHALL never name shell tokens as the target of a structured file tool or payload-file flag

#### Scenario: Same contract in pooled and per-spawn for every agent type
- **GIVEN** per-spawn and shared-process (pooled) operation and any agent type
- **WHEN** a payload is staged and a skill is invoked
- **THEN** the contract SHALL hold identically in per-spawn and shared-process (pooled) operation and for every agent type
- **AND** a skill consumer SHALL NEVER depend on a frozen process-level `SESSION_ID` environment variable

#### Scenario: Only the identity/path form changes, not staging semantics
- **GIVEN** the session staging directory, its provisioning, and all containment/authorization semantics
- **WHEN** prompts and skill instructions change the identity/path FORM they use
- **THEN** the staging directory itself, its provisioning, and all containment/authorization semantics SHALL be unchanged
- **AND** this requirement SHALL change only the identity/path FORM of the instructions the agent receives

#### Scenario: Isolated HOME does not change the script root
- **GIVEN** an OMP child with an isolated HOME and a validated deployment-owned skills root
- **WHEN** any skill-instructing prompt or retry is rendered and its recipe is followed
- **THEN** the script SHALL execute at the rendered absolute root, not under child HOME
- **AND** its existing staged payload and active-session authentication SHALL remain unchanged

#### Scenario: Every secondary prompt supplies the root
- **WHEN** normal, spontaneous, lurk, research, summary, workspace/channel maintenance, reminder, and retry instructions are rendered
- **THEN** each SHALL name its trusted absolute script root consistently with its session-id/staging instructions
- **AND** static skill instructions SHALL direct the agent to that rendered root without a child-HOME fallback

## ADDED Requirements

### Requirement: Recorded-Response And Durable-Submission Retry Suppression

A session that produced a reply, a reaction, or a file send SHALL NOT be retried, and partial file delivery SHALL count as a produced response regardless of the API success flag. A submitted or unknown durable email operation SHALL suppress a new mail submission and quota rollback, with submitted third-party mail satisfying accounting and unknown returning review-required without claiming delivery.

#### Scenario: Session with a recorded response is not retried

- **GIVEN** an agent completes after a successful `send-reply`, a `react-message` reaction, or a `send-file` file send
- **WHEN** the missing-response check runs
- **THEN** the retry mechanism SHALL NOT trigger

#### Scenario: Partial file delivery suppresses retry regardless of the API success flag

- **GIVEN** a `send-file` invocation that delivered some files before a mid-batch failure and reported the call as unsuccessful
- **WHEN** the missing-response check runs
- **THEN** the partial file delivery SHALL count as a produced file response
- **AND** the retry mechanism SHALL NOT trigger

#### Scenario: Durable email submission or uncertainty suppresses a new mail submission

- **GIVEN** any email path with a submitted or unknown durable operation for the current logical work
- **WHEN** the generic missing-response predicate and quota rollback are evaluated
- **THEN** they SHALL NOT authorize a new mail submission
- **AND** submitted third-party mail SHALL satisfy response accounting without writing normal reply anchors
- **AND** unknown SHALL return review-required without claiming successful delivery

### Requirement: Retry Prompt Content Contract

The retry prompt SHALL be instructive and agent-portable in every spawn shape (per-spawn and pooled): it SHALL state the absence of a recorded supported response, list the likely payload-file failure causes, and give the correct two-step example without treating missing state as proof of non-delivery.

#### Scenario: Retry prompt is instructive and agent-portable in every spawn shape

- **GIVEN** a per-spawn session and a pooled session that each ended a prompt turn without a recorded response
- **WHEN** each missing-reply retry prompt is built
- **THEN** both SHALL be instructive and SHALL carry the same literal guidance
- **AND** the prompt SHALL remain actionable even if the agent ignores its process environment entirely

#### Scenario: Retry prompt states the absence of a recorded response without claiming non-delivery

- **GIVEN** an agent that ends its turn without a recorded reply, reaction, or file send
- **WHEN** the retry prompt is sent
- **THEN** it SHALL state the absence of a recorded supported response
- **AND** it SHALL NOT treat missing state as proof of non-delivery

#### Scenario: Retry prompt lists the payload-file failure causes

- **GIVEN** an agent that ended its turn without a reply after a rejected `--message` invocation
- **WHEN** the retry prompt is sent
- **THEN** it SHALL list the rejected legacy `--message`/`--caption` flags, an unwritten payload, a payload outside the named absolute session staging directory, and a previous errored skill call whose output must be read
- **AND** it SHALL NOT equate an arbitrary script error with confirmed non-delivery

#### Scenario: Retry prompt gives the correct two-step example

- **GIVEN** an agent whose reply or file send failed before delivery under the payload-file contract
- **WHEN** the retry prompt is sent
- **THEN** it SHALL name the literal active Skill API session id and the absolute staging directory
- **AND** it SHALL show the correct two-step example: writing the payload under that rendered absolute staging directory with the edit/write tool and then invoking the skill with the payload-file flag naming the payload's absolute path

#### Scenario: Retry prompt includes the trusted skill instructions for the session kind

- **GIVEN** a non-email session and an email session
- **WHEN** their retry prompts are built
- **THEN** the non-email prompt SHALL include the full trusted `send-reply`, `react-message`, and `send-file` SKILL.md content
- **AND** the email prompt SHALL include only supported `send-reply`/`send-file` and grant-appropriate email instructions, with no reaction guidance

#### Scenario: Retry prompt instructions carry no unexpanded shell tokens

- **GIVEN** the rendered retry prompt in either spawn shape
- **WHEN** its payload-file and file-tool instructions are inspected
- **THEN** they SHALL contain no unexpanded `$TMPDIR`/`$SESSION_ID` instruction tokens

#### Scenario: Corrected sending only after confirmed pre-delivery failure

- **GIVEN** the retry prompt and a previous send whose outcome is uncertain or only partially delivered
- **WHEN** the prompt addresses another send
- **THEN** it SHALL permit corrected sending only after a confirmed pre-delivery failure
- **AND** it SHALL defer uncertain or partially delivered results to the owning delivery guidance

### Requirement: Retry Timing, Attempt Limits And Quota Authority Unchanged

Retry timing, attempt limits and reply-quota authority SHALL remain unchanged by the retry prompt content contract and the recorded-response suppression rules.

#### Scenario: Retry timing, attempt limits and quota authority stay as they are

- **GIVEN** the missing-reply retry in any spawn shape
- **WHEN** the retry prompt is built, offered, or suppressed
- **THEN** the retry timing, the attempt limits and the reply-quota authority SHALL remain exactly as they were before this change
- **AND** the corrective-turn limit SHALL remain one

### Requirement: Script Contract Errors Are Typed stderr JSON

The shared payload helper SHALL raise typed errors carrying a stable `code` and a guidance message, and the scripts SHALL emit them as JSON on `stderr`, extending the existing `exitWithError` contract with a `code` field, and SHALL NOT call the Skill API.

#### Scenario: Typed stderr JSON error is raised without a Skill API call

- **GIVEN** a skill script contract failure detected by the shared payload helper
- **WHEN** the script reports the failure
- **THEN** the raised error SHALL carry a stable `code` and a guidance message
- **AND** the script SHALL emit it as JSON on `stderr`, extending the existing `exitWithError` contract with a `code` field
- **AND** the script SHALL NOT call the Skill API

### Requirement: Guidance Content Contract

The guidance message SHALL state what was wrong, why it matters, and the exact correct pattern with a copy-pasteable example invocation specific to the failing skill, anchored on the staging directory and session id RENDERED IN THE AGENT'S SYSTEM PROMPT as absolute literal paths rather than `$TMPDIR`/`$SESSION_ID` shell tokens; the `error` field SHALL be self-contained prose containing the fix and a full example command.

#### Scenario: Guidance text carries cause, stakes and correct pattern

- **GIVEN** a skill script contract failure
- **WHEN** the guidance message is produced
- **THEN** it SHALL state what was wrong, why it matters, and the exact correct pattern with a copy-pasteable example invocation specific to the failing skill
- **AND** the `error` field SHALL be self-contained prose containing the fix and a full example command

#### Scenario: Guidance is anchored on the prompt-rendered literal paths

- **GIVEN** an agent whose system prompt renders the staging directory and session id as absolute literal paths
- **WHEN** a contract-failure guidance message is produced
- **THEN** it SHALL anchor the instruction on those rendered absolute literal paths rather than on `$TMPDIR`/`$SESSION_ID` shell tokens

### Requirement: Error Code Catalog And Their Guidance

Contract failures SHALL use a fixed catalog of stable error codes, each carrying guidance that teaches the correct usage for the failing skill: `SKILL_LEGACY_FLAG`, `SKILL_MISSING_PAYLOAD`, `SKILL_PAYLOAD_OUT_OF_BOUNDS`, `SKILL_PAYLOAD_NOT_FOUND`, `SKILL_SINGLE_FILE_FLAG`, and `SKILL_SESSION_UNRESOLVED`.

#### Scenario: Legacy free-text flag guidance

- **GIVEN** a skill script invoked with a legacy free-text flag in either `--flag value` or `--flag=value` form
- **WHEN** the script rejects the invocation
- **THEN** the error SHALL have code `SKILL_LEGACY_FLAG`
- **AND** its guidance SHALL state that the flag was removed for security, SHALL forbid message content on the command line, and SHALL show the two-step payload-file flow

#### Scenario: Missing payload flag guidance

- **GIVEN** a required payload-file flag absent from an invocation
- **WHEN** the script rejects the invocation
- **THEN** the error SHALL have code `SKILL_MISSING_PAYLOAD`
- **AND** its guidance SHALL name the required flag and show the two-step payload-file flow

#### Scenario: Out-of-bounds payload guidance

- **GIVEN** a payload path that resolves outside the session staging directory, including a symlink escape
- **WHEN** the script rejects the payload
- **THEN** the error SHALL have code `SKILL_PAYLOAD_OUT_OF_BOUNDS`
- **AND** its guidance SHALL name the resolved staging base the script enforced, explain why the payload must live under that directory, and show the correct form

#### Scenario: Missing payload file guidance

- **GIVEN** a payload file that is absent or unreadable
- **WHEN** the script rejects the payload
- **THEN** the error SHALL have code `SKILL_PAYLOAD_NOT_FOUND`
- **AND** its guidance SHALL instruct writing the file first with the edit/write tool under the rendered staging directory and then invoking the script

#### Scenario: Singular send-file flag guidance

- **GIVEN** the `send-file` script invoked with the removed singular `--file-path` flag in either `--file-path value` or `--file-path=value` form
- **WHEN** the script rejects the invocation
- **THEN** the error SHALL have code `SKILL_SINGLE_FILE_FLAG`
- **AND** its guidance SHALL state that `--file-path` was replaced by the repeatable `--file-paths` flag, explain that the skill supports multiple files per invocation, and show a copy-pasteable example passing two or more `--file-paths` arguments

#### Scenario: Unresolvable shared-mode session guidance

- **GIVEN** shared-process mode with a missing, unreadable, or malformed current-session pointer
- **WHEN** the owning session cannot be resolved
- **THEN** the error SHALL have code `SKILL_SESSION_UNRESOLVED`
- **AND** its guidance SHALL name the expected pointer path and the "invoke skills during a live turn" remedy

### Requirement: Payload-File Flag Mapping Per Skill

Each skill that carries free-text content SHALL expose a fixed payload-file flag: `send-reply`/`edit-reply`/`set-reminder` use `--message-file`, `send-file` uses `--caption-file`, `memory-save` uses `--content-file`, and `memory-search`/`fetch-context` use `--query-file`; a REQUIRED free-text argument SHALL have exactly one payload-file flag, while an OPTIONAL one MAY omit it and when present SHALL accept exactly one.

#### Scenario: Each free-text skill uses its documented payload-file flag

- **WHEN** a skill that carries free-text content is invoked
- **THEN** `send-reply`/`edit-reply`/`set-reminder` SHALL use `--message-file`, `send-file` SHALL use `--caption-file`, `memory-save` SHALL use `--content-file`, and `memory-search`/`fetch-context` SHALL use `--query-file`

#### Scenario: REQUIRED and OPTIONAL free-text arguments

- **GIVEN** a free-text argument declared in a skill contract
- **WHEN** its payload-file contract is defined
- **THEN** a REQUIRED free-text argument SHALL have exactly one payload-file flag
- **AND** an OPTIONAL free-text argument (e.g. `send-file` caption, `fetch-context` query) MAY omit its payload-file flag, and when present SHALL accept exactly one

### Requirement: Payload Staged Through The ACP Filesystem Interface And Consumed Verbatim

The payload file SHALL be written by the agent through the ACP filesystem interface (edit/write tool or `writeTextFile`) using the ABSOLUTE staging directory literal rendered into its prompt (identical in per-spawn and shared-process mode), so its bytes are preserved verbatim with no shell interpretation.

#### Scenario: Payload staged through the ACP filesystem interface

- **GIVEN** a payload file staged in the session-scoped staging directory
- **WHEN** the agent writes it
- **THEN** it SHALL be written through the ACP filesystem interface (edit/write tool or `writeTextFile`) using the absolute staging directory literal rendered into the agent's prompt, in per-spawn and shared-process mode alike
- **AND** its bytes SHALL be preserved verbatim with no shell interpretation

#### Scenario: Payload content is consumed by the Skill API and the file is deleted

- **GIVEN** a successful payload-file invocation
- **WHEN** the script has passed the file content to the Skill API as the corresponding JSON parameter (server-side behavior unchanged)
- **THEN** the script SHALL best-effort delete the payload file afterwards

### Requirement: Staging Directory Pre-Created At Session Setup And Reclaimed

The system SHALL pre-create the session staging directory `{workspace}/tmp/{sessionId}` at session setup, because neither the agent's edit/write tool nor `writeTextFile` creates parent directories, and SHALL remove it with the rest of `{workspace}/tmp` when the last session for the workspace ends.

#### Scenario: Staging directory pre-created at setup and reclaimed at session end

- **GIVEN** a session being registered and its shell session being set up
- **WHEN** the session staging directory `{workspace}/tmp/{sessionId}` is prepared
- **THEN** the system SHALL pre-create it, because neither the agent's edit/write tool nor `writeTextFile` creates parent directories
- **AND** the directory SHALL be removed with the rest of `{workspace}/tmp` when the last session for the workspace ends

### Requirement: Shared-Mode Staging Resolution Uses Only The Current-Session Pointer

In shared-process mode the staging directory SHALL be resolved ONLY from the current-session pointer (`{staging}/{sessionId}` from `active.json`), with no CLI-argument fallback; a missing, unreadable, or malformed pointer SHALL fail with `SKILL_SESSION_UNRESOLVED` BEFORE reading or deleting any payload file.

#### Scenario: Shared-mode staging ignores the CLI session argument

- **GIVEN** shared-process mode and a current-session pointer naming `{staging}={workspace}/tmp` and sessionId `sess_B`
- **WHEN** a script is invoked with `--session-id "sess_A"` (any value) and a payload under `{workspace}/tmp/sess_B/`
- **THEN** the staging base SHALL be `{workspace}/tmp/sess_B` — the pointer's session, not the CLI argument's

#### Scenario: Unresolvable pointer fails before any payload file is touched

- **GIVEN** shared-process mode with a missing, unreadable, or malformed current-session pointer
- **WHEN** a script is invoked with any `--session-id` value and a payload-file path under another session's staging directory
- **THEN** the script SHALL exit non-zero with code `SKILL_SESSION_UNRESOLVED` BEFORE reading, sending, or deleting the referenced payload file

#### Scenario: Pointer schema is strict about sessionId and staging

- **GIVEN** a current-session pointer
- **WHEN** it is validated
- **THEN** `sessionId` and `staging` SHALL both be non-empty strings, and in shared mode `staging` SHALL be an absolute path (the pool writes absolute staging roots)
- **AND** numbers, objects, empty strings, and relative staging SHALL all be malformed and fail identically

#### Scenario: Per-spawn staging comes from the script's own session argument

- **GIVEN** per-spawn mode
- **WHEN** a script resolves its staging directory
- **THEN** it SHALL use `{cwd}/tmp/{sessionId}` from the script's own `--session-id` argument
- **AND** a session without an id SHALL fall back to `{workspace}/tmp`

### Requirement: Invalid Payload Invocations Are Rejected Before Side Effects

An invalid payload invocation SHALL exit non-zero with a structured error and SHALL NOT call the Skill API: a legacy free-text flag in either form, a missing payload-file flag, an absent or unreadable file, or a path outside the session staging directory (a prefix sibling, a symlink whose real path escapes it, a workspace-root file, a home-anchored or absolute path, or another session's staging directory).

#### Scenario: Legacy free-text flag is rejected before anything else

- **GIVEN** a skill script invoked with a legacy free-text flag in either `--flag value` or `--flag=value` form
- **WHEN** the script parses its argument list
- **THEN** it SHALL reject the invocation before doing anything else
- **AND** it SHALL NOT call the Skill API

#### Scenario: Workspace-root, home-anchored and absolute payload paths rejected

- **GIVEN** an agent workspace whose staging directory is `{workspace}/tmp/sess_own` and whose root contains `memory.private.jsonl`, and an agent runtime home directory `$HOME`
- **WHEN** a script is invoked with `--message-file memory.private.jsonl`, `--message-file {workspace}/memory.private.jsonl`, `--message-file ~/.git-credentials`, `--message-file $HOME/.env`, or `--message-file /etc/passwd`
- **THEN** the script SHALL reject the payload because the resolved path is outside the session staging directory
- **AND** it SHALL exit non-zero without calling the Skill API

#### Scenario: Another session's staging directory and prefix siblings rejected

- **GIVEN** a session `sess_own` whose staging directory is `{workspace}/tmp/sess_own`, a sibling session staging directory `{workspace}/tmp/sess_other`, and the prefix siblings `{base}-2` and `{base}2`
- **WHEN** a script invoked with `--session-id "sess_own"` receives `--message-file {workspace}/tmp/sess_other/reply.md`, `--message-file {workspace}/tmp/sess_own-2/reply.md`, or `--message-file {workspace}/tmp/sess_own2/reply.md`
- **THEN** the script SHALL reject the payload because the resolved path is not inside `{workspace}/tmp/sess_own`, using boundary-safe equal-or-separator-prefixed matching so `{base}-2` and `{base}2` are rejected

#### Scenario: Symlink escape rejected by the real-path re-check

- **GIVEN** a session staging directory `{workspace}/tmp/sess_own` containing a symlink `leak.md` pointing at `/etc/passwd` (or at a path outside the staging directory)
- **WHEN** a script is invoked with `--message-file {workspace}/tmp/sess_own/leak.md`
- **THEN** the script SHALL resolve the real path (`Deno.realPath`) and reject the payload because the real path escapes the staging directory
- **AND** it SHALL NOT call the Skill API

#### Scenario: Missing flag, absent file and unreadable file rejected

- **GIVEN** a script invocation that provides neither the legacy flag nor a payload-file flag, or a payload-file flag pointing at a path where no readable file exists
- **WHEN** the script parses its arguments or reads the payload
- **THEN** it SHALL exit non-zero with a structured error naming the required payload-file flag or the missing file
- **AND** it SHALL NOT call the Skill API

### Requirement: Legacy Token-Path Compatibility For Existing Callers

A payload path or structured file-tool path that still carries the `$TMPDIR`/`$SESSION_ID` shell tokens SHALL keep resolving to the same staging directory it resolves to today; the shared payload helper's token/pointer/path resolution behavior SHALL be unchanged by the instruction-surface switch, and this compatibility SHALL be covered by tests.

#### Scenario: Legacy token paths keep their current resolution

- **GIVEN** a per-spawn session whose shell expanded `--message-file "$TMPDIR/$SESSION_ID/reply.md"` to `{workspace}/tmp/sess_own/reply.md` before the script ran
- **WHEN** `send-reply` is invoked with that expanded path
- **THEN** the script SHALL resolve and read it exactly as before this change
- **AND** a payload helper invoked with a raw (unexpanded) `$TMPDIR`/`$SESSION_ID` token path SHALL retain its current documented resolution behavior
- **AND** this compatibility SHALL be covered by tests
