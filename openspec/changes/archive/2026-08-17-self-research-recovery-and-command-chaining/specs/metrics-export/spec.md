## MODIFIED Requirements

### Requirement: Metric Definitions

The system SHALL expose the following metrics with the specified types and labels:

| Metric Name | Type | Labels |
|---|---|---|
| `airfriends_sessions_total` | Counter | `platform`, `type`, `status` |
| `airfriends_session_duration_seconds` | Histogram | `platform`, `type`, `status` |
| `airfriends_active_sessions` | Gauge | — |
| `airfriends_messages_received_total` | Counter | `platform` |
| `airfriends_replies_sent_total` | Counter | `platform` |
| `airfriends_memory_operations_total` | Counter | `operation`, `visibility` |
| `airfriends_skill_api_calls_total` | Counter | `skill`, `status` |
| `airfriends_rate_limit_rejections_total` | Counter | `platform` |
| `airfriends_audit_entries_total` | Counter | `phase` |
| `airfriends_skill_readiness` | Gauge | `skill` |
| `airfriends_files_sent_total` | Counter | `platform` |
| `airfriends_reminders_set_total` | Counter | `platform` |
| `airfriends_reminders_delivered_total` | Counter | `platform`, `status` |
| `airfriends_reminders_cancelled_total` | Counter | `platform` |
| `airfriends_idle_timeout_total` | Counter | `platform`, `outcome` |
| `airfriends_self_research_no_note_total` | Counter | — |

The `airfriends_files_sent_total` counter SHALL be incremented once per individual file delivered (a multi-file `send-file` invocation increments it by the number of delivered files), not once per invocation.

The `airfriends_self_research_no_note_total` counter SHALL be incremented exactly once per self-research session that ends without producing any research output (no new or content-changed file under `$AGENT_WORKSPACE/notes/` or `journal/`), after the corrective retry ran — and ONLY when completion verification is enabled (`selfResearch.verifyCompletion !== false`); the disabled mode takes no snapshot, cannot measure the outcome, and SHALL NOT increment the counter.

#### Scenario: Session counter increments on success

- **GIVEN** `metrics.enabled` is `true`
- **WHEN** a message session completes successfully on Discord
- **THEN** `airfriends_sessions_total{platform="discord",type="message",status="success"}` SHALL be incremented

#### Scenario: Session duration recorded in histogram

- **GIVEN** `metrics.enabled` is `true`
- **WHEN** a session completes in 5 seconds
- **THEN** `airfriends_session_duration_seconds` SHALL record the observation in the appropriate bucket

#### Scenario: Active sessions gauge reflects concurrent sessions

- **GIVEN** 2 sessions are actively running
- **WHEN** the gauge is queried
- **THEN** `airfriends_active_sessions` SHALL show `2`
- **AND** when both sessions complete, it SHALL show `0`

#### Scenario: Files sent counter increments per file

- **GIVEN** `metrics.enabled` is `true`
- **WHEN** a `send-file` invocation delivers 3 files to a Misskey channel
- **THEN** `airfriends_files_sent_total{platform="misskey"}` SHALL be incremented by 3

#### Scenario: Self-research no-note counter increments

- **GIVEN** `metrics.enabled` is `true` and `selfResearch.verifyCompletion` is `true`
- **WHEN** a self-research session ends without producing a note, even after its corrective retry
- **THEN** `airfriends_self_research_no_note_total` SHALL be incremented exactly once

#### Scenario: Self-research no-note counter disabled with verification off

- **GIVEN** `metrics.enabled` is `true` and `selfResearch.verifyCompletion` is `false`
- **WHEN** a self-research session ends without producing a note
- **THEN** `airfriends_self_research_no_note_total` SHALL NOT be incremented (the disabled mode performs no verification and cannot measure the outcome)
