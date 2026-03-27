## REMOVED Requirements

### Requirement: Index File Location
**Reason**: Memory index provides no measurable performance benefit for current workload sizes
**Migration**: Remove all memory.index.jsonl files from workspaces

### Requirement: Index Entry Schema
**Reason**: MemoryIndexEntry type no longer needed
**Migration**: Remove from src/types/memory.ts

### Requirement: Lazy-Loaded with Fallback
**Reason**: Index is being fully removed; fallback (full scan) becomes the only path
**Migration**: Remove index loading code from MemoryStore

### Requirement: Incremental Maintenance
**Reason**: No index to maintain
**Migration**: Remove index update calls from addMemory/patchMemory

### Requirement: Explicit Rebuild Mechanism
**Reason**: No index to rebuild
**Migration**: Remove rebuild logic

### Requirement: O(1) ID Lookup via Index
**Reason**: Full file scan is fast enough for current data sizes
**Migration**: findMemoryById reverts to sequential file scan
