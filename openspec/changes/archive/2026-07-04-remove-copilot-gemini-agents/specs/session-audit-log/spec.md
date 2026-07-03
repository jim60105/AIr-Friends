## MODIFIED Requirements

### Requirement: Session Start Audit Phase

The system SHALL write a `session_start` audit entry immediately after session registration in the session registry. The entry data SHALL contain `sessionId`, `sessionType` (e.g., `"message"`, `"spontaneous"`, `"selfResearch"`, `"memoryMaintenance"`, `"channelLurk"`, `"reminder"`), `workspaceKey`, `agentType`, `model`, `reasoningEffort`, and `yolo` (boolean).

#### Scenario: Message session start
- **WHEN** a message session is registered with workspace key `discord/123`, agent type `opencode`, model `claude-opus-4.8`, reasoning effort `high`, and YOLO mode disabled
- **THEN** a `session_start` entry SHALL be written with `sessionType: "message"`, `workspaceKey: "discord/123"`, `agentType: "opencode"`, `model: "claude-opus-4.8"`, `reasoningEffort: "high"`, `yolo: false`

#### Scenario: Self-research session start
- **WHEN** a self-research session starts
- **THEN** a `session_start` entry SHALL be written with `sessionType: "selfResearch"`

#### Scenario: Reasoning effort recorded as default when chain resolves to default
- **WHEN** a session is registered and no routing-rule, section, or global override produces an active value (the effective chain resolves to `"default"`)
- **THEN** the `session_start` entry's `reasoningEffort` field SHALL be `"default"`
