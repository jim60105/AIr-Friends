## MODIFIED Requirements

### Requirement: Memory File Creation
**Change**: Memory files are created lazily on first write, not at workspace initialization
**Before**: Empty memory files pre-created at workspace creation
**After**: Files created automatically when first memory entry is appended

#### Scenario: First memory save creates file
- GIVEN a workspace with no memory files
- WHEN `addMemory()` is called for the first time
- THEN the appropriate memory file (public or private) is created
- AND the memory entry is written as the first line

#### Scenario: Read returns empty for missing file
- GIVEN a workspace with no memory files
- WHEN `loadAllMemories()` is called
- THEN an empty array is returned
- AND no error is thrown

#### Scenario: Channel memory file creation
- GIVEN a channel workspace with no memory file
- WHEN `addChannelMemory()` is called
- THEN `memory.channel.jsonl` is created with the first entry
