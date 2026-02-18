Feature: Session Audit Log
  As a system operator
  I want each agent session to produce a JSONL audit trail
  So that I can replay and debug session timelines after the fact

  Background:
    Given the audit configuration is:
      | enabled        | true                             |
      | retentionDays  | 7                                |
      | hashContent    | true                             |
      | includedPhases | skill_call,reply_sent,session_end |

  Scenario: Audit log file is created for a normal message session
    When a user sends a message and the session completes
    Then a JSONL file is created at "data/audit/{platform}/{userId}/{sessionId}.jsonl"
    And each line is a valid JSON object with "ts", "phase", and "data" fields

  Scenario: Phase filtering
    Given includedPhases is ["skill_call", "session_end"]
    When the session writes entries for all phases
    Then only "skill_call" and "session_end" entries appear in the file

  Scenario: All phases recorded when includedPhases is empty
    Given includedPhases is []
    When the session writes entries for multiple phases
    Then all entries appear in the file

  Scenario: Content hashing
    Given hashContent is true
    When a skill_call audit entry is written with "content" parameter "Hello World"
    Then the "content" field value starts with "sha256:"
    And the "visibility" field is preserved as-is

  Scenario: Content hashing disabled
    Given hashContent is false
    When a skill_call audit entry is written with "content" parameter "Hello World"
    Then the "content" field value is "Hello World"

  Scenario: Reply sent audit entry
    When the send-reply skill succeeds
    Then a "reply_sent" audit entry is written with "replyContentHash" and "replyLength"
    And the hash starts with "sha256:" when hashContent is true

  Scenario: Session end audit entry on success
    When the session completes successfully with a reply
    Then a "session_end" entry is written with success=true and replySent=true and durationMs > 0

  Scenario: Session end audit entry on failure
    When the session throws an error
    Then a "session_end" entry is written with success=false and error containing the message

  Scenario: Audit I/O failure does not crash session
    Given the audit directory is not writable
    When the session attempts to write an audit entry
    Then the session continues normally without error
    And a warning is logged about the failed audit write

  Scenario: Retention cleanup deletes old files
    Given audit files with mtime older than retentionDays exist
    When the retention cleanup runs
    Then old files are deleted
    And recent files are preserved

  Scenario: Retention cleanup at startup
    Given audit is enabled with retentionDays > 0
    When the application bootstraps
    Then retention cleanup runs once at startup
    And a periodic cleanup is scheduled every 24 hours

  Scenario: Prometheus metric incremented
    When an audit entry is successfully written
    Then the "airfriends_audit_entries_total" counter is incremented with the phase label

  Scenario: Environment variable overrides
    Given AUDIT_ENABLED is "true"
    And AUDIT_RETENTION_DAYS is "14"
    And AUDIT_HASH_CONTENT is "false"
    And AUDIT_INCLUDED_PHASES is "session_end"
    When configuration is loaded
    Then audit.enabled is true
    And audit.retentionDays is 14
    And audit.hashContent is false
    And audit.includedPhases is ["session_end"]

  Scenario: Git backup includes audit directory
    Given git backup is enabled
    When a backup is performed
    Then files under "data/audit/" are included in the backup
