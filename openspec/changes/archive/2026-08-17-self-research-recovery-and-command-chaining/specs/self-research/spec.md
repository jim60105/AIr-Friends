## ADDED Requirements

### Requirement: Research Session Completion Verification

After a self-research ACP session ends with `end_turn`, the system SHALL verify that the agent actually produced research output before declaring success. Research output SHALL be defined as a new file, or a file whose content hash changed AND whose modification time is at or after the session start (minus at most 1 second of clock slack), under `$AGENT_WORKSPACE/notes/` or `$AGENT_WORKSPACE/journal/`, compared with a recursive fingerprint snapshot taken before the prompt was sent (fingerprint = relative path → size, mtimeMs, and content hash; the hash removes same-size/same-millisecond overwrite blind spots). A session that produced no research output SHALL NOT be reported as successful.

When no research output was produced (and completion verification is enabled), the system SHALL send ONE corrective retry prompt on the SAME ACP session before failing: the retry prompt SHALL state that a research note must be written, SHALL embed the session's recent permission-rejection reasons (bounded via the existing per-session permission-rejection ring buffer and `formatPermissionRejections()`), SHALL name the commands OpenCode itself denies before the ACP gate (`echo`, `curl`, `git`, `python`, `mkdir`, …) so `|| echo`-style fallbacks are abandoned in favor of the Read tool, SHALL restate the sandbox usage rules (multi-command bash calls with `;`/`&&`/`||` allowed only when every command is individually allowed; `|`, `&`, `2>/dev/null`, `> file` rejected; webfetch 403/429 responses → switch to `agent-browser`), and SHALL require writing the note to `$AGENT_WORKSPACE/notes/{topic-slug}.md` and updating `$AGENT_WORKSPACE/notes/_index.md` (env-var paths, deployment-independent). After the retry, verification SHALL run again. If the retry also produced nothing, the session SHALL end as a failure: `success: false`, error reason `no_research_note`, a WARN log, an audit `session_end` entry with `success: false` and the reason, and the `airfriends_self_research_no_note_total` counter incremented exactly once per session (only when completion verification is enabled).

The first turn's response SHALL be recorded as an audit `agent_response` entry with `isRetry: false` WITHOUT any `session_end` yet; the retry prompt SHALL be recorded as an audit `prompt_sent` entry and its response as `agent_response` with `isRetry: true`; exactly ONE `session_end` entry SHALL be written after the final verification outcome. Fingerprint snapshot or verification I/O errors SHALL NOT fail the session: the system SHALL log a warning and treat the session as having produced output (fail-safe — never retry on verification uncertainty). Non-`end_turn` stop reasons SHALL keep the existing behavior (failure without retry).

#### Scenario: Note written in normal flow

- **GIVEN** a self-research session with completion verification enabled
- **WHEN** the agent ends the turn after creating `/app/data/agent-workspace/notes/operatiology-and-noology.md` and updating `_index.md` (new files, or content-changed files with mtime at/after session start)
- **THEN** the session SHALL be reported successful

#### Scenario: No note produced triggers one corrective retry

- **GIVEN** a self-research session whose agent ended the turn without writing any file under `$AGENT_WORKSPACE/notes/` or `journal/` (e.g. after its tool calls were rejected)
- **WHEN** completion verification runs
- **THEN** the system SHALL record `retry_triggered` (reason `no_research_note`, retryCount 1, maxRetries 1) in the audit log
- **AND** SHALL send one corrective retry prompt on the same ACP session embedding the recent permission rejections and naming OpenCode-denied commands
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

- **GIVEN** a self-research session whose agent turn ends with a non-`end_turn` stop reason (e.g. `cancelled`)
- **WHEN** the session completes
- **THEN** the session SHALL be reported failed without any completion retry

### Requirement: Completion Verification Configuration

The completion verification behavior SHALL be controlled by `selfResearch.verifyCompletion`, a boolean config field defaulting to `true`. When `false`, self-research sessions SHALL use the legacy behavior: any `end_turn` counts as success, no fingerprint snapshot is taken, no retry runs, and the `airfriends_self_research_no_note_total` counter SHALL NOT be incremented (the outcome cannot be measured without verification). The field SHALL be overridable via the `SELF_RESEARCH_VERIFY_COMPLETION` environment variable (`"true"` / `"false"`), which SHALL be documented in `config.example.yaml`, `.env.example`, and `helm/values.yaml`.

#### Scenario: Enabled by default

- **GIVEN** no `verifyCompletion` field in the `selfResearch` config
- **WHEN** configuration is loaded
- **THEN** `selfResearch.verifyCompletion` SHALL default to `true`

#### Scenario: Environment variable override

- **GIVEN** `SELF_RESEARCH_VERIFY_COMPLETION=false`
- **WHEN** configuration is loaded
- **THEN** `selfResearch.verifyCompletion` SHALL be `false` and the legacy end_turn-equals-success behavior SHALL apply, with no snapshot, no retry, and no no-note counter increment
