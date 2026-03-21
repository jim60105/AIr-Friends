# Agent Workspace

## Purpose

Provides a global, cross-conversation workspace for the AI agent to store long-term knowledge notes, research conclusions, and daily reflections. Unlike per-user workspaces, the agent workspace is shared across all users and conversations.

## Requirements

### Requirement: Global Workspace Location

The agent workspace SHALL be located at `{workspace.repoPath}/agent-workspace/`. It is NOT per-user — it is a single shared workspace accessible across all conversations and users.

#### Scenario: Workspace path
- **GIVEN** `workspace.repoPath` is `./data`
- **WHEN** `getOrCreateAgentWorkspace()` is called
- **THEN** the workspace path resolves to `./data/agent-workspace/`

### Requirement: Directory Structure

The system SHALL create the following directory structure on first initialization:

```
data/agent-workspace/
├── README.md              # Workspace usage guide
├── notes/                 # Knowledge notes by topic
│   ├── _index.md          # Notes index (agent-maintained)
│   └── {topic-slug}.md    # Individual topic files
└── journal/               # Daily reflections
    └── {YYYY-MM-DD}.md    # Daily entries
```

#### Scenario: First-time initialization
- **GIVEN** the `agent-workspace/` directory does not exist
- **WHEN** `getOrCreateAgentWorkspace()` is called
- **THEN** the directories `notes/` and `journal/` are created
- **AND** `README.md` is created with usage guidelines
- **AND** `notes/_index.md` is created with a `# Notes Index` header

### Requirement: Idempotent Initialization

The workspace initialization SHALL be idempotent. If the workspace already exists, existing files SHALL NOT be overwritten.

#### Scenario: Repeated initialization
- **GIVEN** the agent workspace already exists with custom content in `README.md`
- **WHEN** `getOrCreateAgentWorkspace()` is called again
- **THEN** the existing `README.md` content is preserved
- **AND** the directory structure remains unchanged

### Requirement: AGENT_WORKSPACE Environment Variable

The agent workspace path SHALL be exposed to the ACP agent subprocess via the `AGENT_WORKSPACE` environment variable. The agent reads workspace content on-demand using this path.

#### Scenario: Agent reads workspace via env var
- **GIVEN** the agent subprocess is spawned
- **WHEN** the agent executes `cat $AGENT_WORKSPACE/notes/_index.md`
- **THEN** the agent can read the index file content

### Requirement: Not Pre-Loaded in Context

Agent workspace file content SHALL NOT be included in the initial system prompt or context assembly. The agent reads workspace files on-demand. The system prompt SHALL include workspace usage guidance only.

#### Scenario: Context does not include workspace files
- **GIVEN** the agent workspace contains multiple notes
- **WHEN** the system assembles conversation context
- **THEN** the workspace file contents are not included
- **AND** the system prompt contains workspace usage instructions

### Requirement: Markdown-Based Format

All files in the agent workspace SHALL use `.md` (Markdown) format for token efficiency and readability.

#### Scenario: File format constraint
- **GIVEN** the agent writes a research note
- **WHEN** the note is saved to the workspace
- **THEN** the file uses `.md` extension

### Requirement: Memory-Search Integration

The `memory-search` skill SHALL search both user memories and agent workspace notes, returning results in separate sections (`memories` and `agentNotes`).

#### Scenario: Search returns both sections
- **GIVEN** user memories contain "pasta recipe"
- **AND** agent workspace `notes/cooking.md` contains "pasta recipe"
- **WHEN** `memory-search` is invoked with query "pasta"
- **THEN** the results include a `memories` section with user memory matches
- **AND** the results include an `agentNotes` section with workspace note matches

### Requirement: Privacy Boundary

User private data SHALL NOT be stored in the agent workspace. The system prompt SHALL guide the agent to use `memory-save` skill for user-specific private information.

#### Scenario: Privacy guidance
- **GIVEN** the agent receives personal information from a user
- **WHEN** the agent decides where to store it
- **THEN** the system prompt instructs using `memory-save` (not the agent workspace)

### Requirement: Path Safety

The agent workspace path SHALL be validated to be within the `repoPath` boundary using `validatePathWithinBoundary()`. Attempts to access paths outside this boundary SHALL be rejected.

#### Scenario: Path traversal prevention
- **GIVEN** the workspace path is `./data/agent-workspace/`
- **WHEN** an access attempt targets `./data/agent-workspace/../../etc/passwd`
- **THEN** the path validation rejects the access
