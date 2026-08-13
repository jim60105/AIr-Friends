# Session Audit Log (Delta)

## MODIFIED Requirements

### Requirement: File Sent Audit Phase

The system SHALL write a `file_sent` audit entry when the `send-file` skill delivers at least one file. The entry data SHALL contain `filesCount` (integer, number of files delivered), `messageId` (string, the last delivered message ID — the session reply anchor), `messageIds` (array of strings, all delivered message IDs in send order), `captionHash` (SHA-256 hash of the caption text when `hashContent` is true; omitted otherwise), `fileNamesHash` (SHA-256 hash of the comma-joined file names when `hashContent` is true; the plain comma-joined file names otherwise), and `platform`. Message IDs are platform message identifiers, not user content, and SHALL be recorded verbatim regardless of `hashContent`. Individual file content SHALL NOT be hashed or recorded (files may be large binary data). On partial delivery (e.g. Misskey chat mid-batch failure), the entry SHALL still be written with the delivered count and the delivered message IDs, and the failure SHALL additionally be visible via the `skill_call` entry's `skillResult`.

#### Scenario: Successful multi-file send
- **GIVEN** audit is enabled with `hashContent: true`
- **WHEN** `send-file` succeeds with `filePaths: ["a.png", "b.png"]` and caption `"here you go"` on Discord, delivering message ID `msg-1`
- **THEN** a `file_sent` entry SHALL be written with `filesCount: 2`, `messageId: "msg-1"`, `messageIds: ["msg-1"]`, `captionHash: "sha256:<hex>"`, `fileNamesHash: "sha256:<hex>"`, and `platform: "discord"`

#### Scenario: File send without caption
- **GIVEN** audit is enabled with `hashContent: false`
- **WHEN** `send-file` succeeds with a single file and no caption
- **THEN** a `file_sent` entry SHALL be written with `filesCount: 1`
- **AND** the entry SHALL NOT contain a `captionHash` field

#### Scenario: Multi-message delivery records all IDs
- **GIVEN** audit is enabled
- **WHEN** `send-file` delivers two Misskey chat messages with IDs `file-1` and `file-2`
- **THEN** a `file_sent` entry SHALL be written with `messageId: "file-2"` and `messageIds: ["file-1", "file-2"]`

#### Scenario: Partial delivery still emits file sent entry
- **GIVEN** audit is enabled
- **WHEN** `send-file` delivers 1 of 2 files on Misskey chat before a mid-batch failure, delivering message ID `file-1`
- **THEN** a `file_sent` entry SHALL be written with `filesCount: 1`, `messageId: "file-1"`, and `messageIds: ["file-1"]`
