# Design

## Context

Source design: `docs/superpowers/specs/2026-11-07-identity-linked-memory-design.md` §4.6. Requires `identity-linked-memory-recall`, which gives `MemoryHandler` the constructor parameter and field `identityRegistry?: IdentityRegistry` and `SkillRegistry`/`AgentCore` wiring.

Observed code:

- `src/core/memory-store.ts`: `patchMemory(workspace, targetId, patch)` (line 139) calls `private async findMemoryById(workspace, memoryId)` (line 203), which searches the public file and, only when `workspace.isDm`, the private file; it throws `MemoryError("Memory not found: <id>")` when absent and appends the patch to the file holding the original.
- `src/skills/memory-handler.ts` `handleMemoryPatch`: after parameter validation and the `scope === "channel"` branch, the user-scope branch (around line 704) calls `this.memoryStore.patchMemory(context.workspace, params.memory_id, patch)` and maps `"Memory not found:"` errors to the message plus the `--scope channel` hint.
- `IdentityRegistry.linkedWorkspaces(current)` returns linked descriptors in configuration order carrying `current.isDm`.

## Goals / Non-Goals

**Goals:** owner resolution for user-scope patches; ambiguity error; DM-only linked private patching.

**Non-Goals:** channel-scope patching, `memory-save`, response shape changes, cross-workspace copying, any change to `patchMemory()` itself.

## Decisions

### D1. `findMemoryById` becomes public

Change `private async findMemoryById` to `async findMemoryById` with an updated doc comment ("Public so `memory-patch` can resolve the owning workspace of a linked memory"). Behavior unchanged.

### D2. Owner resolution in `handleMemoryPatch`

Replace the user-scope block's workspace argument with a resolved owner. Insert before the existing `try { patchEntry = await this.memoryStore.patchMemory(...) }`:

```ts
let owner: WorkspaceInfo = context.workspace;
if (await this.memoryStore.findMemoryById(context.workspace, params.memory_id) === null) {
  const owners: WorkspaceInfo[] = [];
  for (const linked of this.identityRegistry?.linkedWorkspaces(context.workspace) ?? []) {
    try {
      if (await this.memoryStore.findMemoryById(linked, params.memory_id) !== null) owners.push(linked);
    } catch (error) {
      logger.warn("Skipped unreadable linked memory source during patch", {
        workspaceKey: linked.key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (owners.length > 1) {
    return {
      success: false,
      error: `Memory ${params.memory_id} is ambiguous: it exists in more than one linked account`,
    };
  }
  if (owners.length === 1) owner = owners[0];
}
```

Then call `this.memoryStore.patchMemory(owner, params.memory_id, patch)`; the existing not-found mapping stays as is (it fires when `owner` is still the current workspace and the id is absent). The success log uses `workspaceKey: owner.key`. The response `data` is unchanged (no source attribution).

Private gating needs no new code: linked descriptors carry the current `isDm`, and `findMemoryById` reads private files only when `isDm`.

Alternative considered: pick the first linked owner on ambiguity. Rejected by the source design: guessing could disable another person's memory.

## Risks / Trade-offs

- [Patch on one account changes what other accounts recall] → Intended; linking is operator authorization.
- [Extra reads for a not-found id] → Bounded by the small group size.

## Migration Plan

None. Pre-release; without identity groups the code path is identical to today.
