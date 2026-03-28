## MODIFIED Requirements

### Requirement: Workspace Initialization
**Change**: Memory files are no longer created during workspace initialization
**Before**: `initializeWorkspaceFiles()` creates empty `memory.public.jsonl` and `memory.private.jsonl`
**After**: Only the workspace directory and `tmp/` subdirectory are created; memory files are created on first write

#### Scenario: New user workspace created
- GIVEN a new user sends their first message
- WHEN `getOrCreateWorkspace()` is called
- THEN the workspace directory exists
- AND the `tmp/` subdirectory exists
- AND no memory files exist yet

#### Scenario: Channel workspace created
- GIVEN a channel workspace is first needed
- WHEN `getOrCreateChannelWorkspace()` is called
- THEN the channel workspace directory exists
- AND no `memory.channel.jsonl` file exists yet
