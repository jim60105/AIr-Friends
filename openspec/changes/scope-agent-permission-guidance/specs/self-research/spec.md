# Spec Delta

## MODIFIED Requirements

### Requirement: Research Session Completion Verification

After a self-research ACP session ends with `end_turn`, the system SHALL verify the agent produced research output before declaring success. Research output SHALL be a new file, or a content-hash-changed file with mtime at/after session start (≤1s clock slack), under `$AGENT_WORKSPACE/notes/` or `journal/`, compared with a recursive fingerprint snapshot (relative path → size, mtime, content hash). A session with no research output SHALL NOT be reported successful.

#### Scenario: Note written in normal flow
- **GIVEN** a self-research session with completion verification enabled
- **WHEN** the agent ends the turn after creating `/app/data/agent-workspace/notes/operatiology-and-noology.md` and updating `_index.md` (new files, or content-changed files with mtime at/after session start)
- **THEN** the session SHALL be reported successful

#### Scenario: No note produced triggers one corrective retry
- **GIVEN** a self-research session whose agent ended the turn without writing any file under `$AGENT_WORKSPACE/notes/` or `journal/` (e.g. after its tool calls were rejected)
- **WHEN** completion verification runs
- **THEN** the system SHALL record `retry_triggered` (reason `no_research_note`, retryCount 1, maxRetries 1) in the audit log
- **AND** SHALL send one corrective retry prompt on the same ACP session embedding the recent permission rejections and guidance for that session's selected engine and effective permission mode
- **AND** SHALL re-verify after the retry

#### Scenario: Retry succeeds
- **GIVEN** a self-research session whose first turn produced no note and the corrective retry was sent
- **WHEN** the retry turn writes a note under `$AGENT_WORKSPACE/notes/`
- **THEN** the session SHALL be reported successful with `success: true`

#### Scenario: Retry also produces nothing ends as failure
- **GIVEN** a self-research session whose first turn and corrective retry both produced no research output
- **WHEN** completion verification runs after the retry
- **THEN** the session SHALL end with `success: false` and error reason `no_research_note`
- **AND** the audit log SHALL contain exactly ONE `session_end` entry with `success: false` (written after the retry outcome), plus `prompt_sent`/`agent_response` entries for the retry turn with `isRetry: true`
- **AND** `airfriends_self_research_no_note_total` SHALL be incremented exactly once for the session

#### Scenario: Same-size same-millisecond overwrite still detected
- **GIVEN** a self-research session whose snapshot recorded an existing note file, and the agent overwrote it with different content of the same size within the same millisecond
- **WHEN** completion verification runs
- **THEN** the content hash comparison SHALL detect the change and the session SHALL be reported successful

#### Scenario: Pre-session file modification does not count
- **GIVEN** a file under `$AGENT_WORKSPACE/notes/` whose content changed before the session started
- **WHEN** completion verification runs after an `end_turn` with no other output
- **THEN** the session SHALL NOT be counted as having produced output because the modification time precedes the session start

#### Scenario: Verification uncertainty never retries
- **GIVEN** the agent workspace `notes/` directory cannot be read during verification (I/O error)
- **WHEN** a self-research session ends with `end_turn`
- **THEN** the system SHALL log a warning and treat the session as having produced output, with no retry prompt sent

#### Scenario: Non-end_turn stop reason keeps existing behavior
- **GIVEN** the session's agent turn ends with a non-`end_turn` stop reason (e.g. `cancelled`)
- **WHEN** the session completes
- **THEN** the session SHALL be reported failed without any completion retry

#### Scenario: Augment retry prompt with rejection context
- **GIVEN** the system sends the one corrective retry on the same ACP session
- **WHEN** the retry prompt is built
- **THEN** it SHALL state that a research note must be written and SHALL embed the session's recent permission-rejection reasons (bounded via the per-session permission-rejection ring buffer and `formatPermissionRejections()`)
- **AND** restricted OpenCode guidance SHALL name its pre-gate denied commands (`echo`, `curl`, `git`, `python`, `mkdir`, …) while OMP and YOLO guidance SHALL NOT inherit that OpenCode-only denial list

#### Scenario: Retry prompt restates sandbox and write rules
- **GIVEN** the corrective retry prompt is being assembled
- **WHEN** it instructs the agent's actions
- **THEN** restricted guidance SHALL restate the per-command chaining and applicable operator restrictions, including tolerated standard-stream fd redirects, without describing `||` itself as forbidden
- **AND** YOLO guidance SHALL omit restricted shell-denial claims while preserving applicable filesystem limits
- **AND** all modes SHALL retain the webfetch 403/429 fallback to `agent-browser`, require writing the note to `$AGENT_WORKSPACE/notes/{topic-slug}.md` and updating `$AGENT_WORKSPACE/notes/_index.md` (env-var paths, deployment-independent)
- **AND** edit/write note creation SHALL remain recommended without claiming native-YOLO rejects all shell redirects

#### Scenario: Audit entries record each turn and one session_end
- **GIVEN** a self-research session with completion verification enabled
- **WHEN** the first turn and the optional corrective retry are recorded
- **THEN** the first turn's response SHALL be an audit `agent_response` with `isRetry: false` without any preceding `session_end`
- **AND** the retry prompt SHALL be recorded as `prompt_sent` and its response as `agent_response` with `isRetry: true`, with exactly ONE `session_end` written only after the final verification outcome

#### Scenario: Failed final retry logs warning and metric
- **GIVEN** the corrective retry also produced no research output
- **WHEN** verification fails after the retry
- **THEN** the session SHALL emit a WARN log and increment `airfriends_self_research_no_note_total` exactly once (only when completion verification is enabled)

#### Scenario: Correction receives the running session context
- **GIVEN** a session whose effective permission mode differs from the global default
- **WHEN** its no-note correction is delivered for OpenCode or OMP
- **THEN** guidance SHALL follow the running session's selected engine and resolved effective mode
- **AND** it SHALL preserve the trusted script root and same-session retry target without changing retry count, completion criteria or platform-reply prohibition
