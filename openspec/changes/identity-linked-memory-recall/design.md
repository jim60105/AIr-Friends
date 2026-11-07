# Design

## Context

Source design: `docs/superpowers/specs/2026-11-07-identity-linked-memory-design.md` §4.3–4.5, §6, §7, §8, §10. Requires `IdentityRegistry` (`src/core/identity-registry.ts`) and `Config.identities?: IdentityGroupConfig[]` from `identity-linked-memory-config`.

Observed code:

- `src/core/memory-recall/retriever.ts`: `MemoryRecallRequest` (line 53); `rank()` filters `visibility !== "private" || request.workspace.isDm` and picks scopes; `loadDocuments()` (line 371) builds `sources` (current public; current private in DM, else current channel file) and loops `this.cache.getDocuments(path, load)`. No logger in this file.
- `src/core/memory-recall/snapshot-cache.ts`: `getDocuments(path, load)` keys by absolute path; a missing file yields `[]`; a failing `load` rejects and drops its slot.
- `src/core/memory-store.ts`: `getCoreTierMemories(ws)` and `getRecentWorkingMemories(ws, limit)` read public, plus private when `ws.isDm`; `loadAllMemories` returns `[]` for a missing file (via `WorkspaceManager.readWorkspaceFile` "File not found") and creates nothing.
- `src/core/memory-recall/fixed-selection.ts`: `selectFixedMemories()` sorts core oldest-first and working newest-first (ties by id), slices working to `workingMaxItems`, so merged inputs need no new ordering.
- `src/core/context-assembler.ts`: constructor `(memoryStore, config, workspaceManager?, retriever?)` (line 93); `assembleContext` loads `userCore`/`userWorking` at lines 243–247 and calls `selectFastRecall(event, workspace, channelWorkspace, recentMessages, injectedIds, agentWorkspacePath)` (line 452); `assembleSpontaneousContext` loads inline at lines 1138–1149.
- `src/skills/memory-handler.ts`: constructor `(memoryStore, retriever?)` (line 45); `handleMemorySearch` calls `this.retriever.search({ mode: "deep", ... })` (line 371).
- `src/skills/registry.ts`: constructor `(memoryStore, remindersConfig?, reminderStore?, sendFileConfig?, recallConfig?, emailCompose?)`; builds `MemoryHandler(memoryStore, this.memoryRetriever)` (line 64).
- `src/core/agent-core.ts`: constructs `WorkspaceManager`, `MemoryStore`, `SkillRegistry` (5 args, line 85) and `ContextAssembler` (4 args, line 120); getters such as `getSkillRegistry()`.

### Relation to existing specs

`memory-recall` "Memory Eligibility / Conversation scopes" speaks of "the user's" public and private memories. For an account in an identity group, "the user" extends to every account in the group as specified by `identity-linked-recall`; for an unlinked account both specs say the same thing. No MODIFIED delta is written because no existing scenario's outcome changes; the archiver should keep both specs and not treat them as conflicting.

## Goals / Non-Goals

**Goals:** linked sources in retrieval, fixed loading (both assembly paths), Fast Recall, `memory-search`; one registry wired by `AgentCore`.

**Non-Goals:**
- `memory-patch` owner resolution and making `MemoryStore.findMemoryById` public (`identity-linked-memory-patch`).
- Any change to `memory-save`, `memory-stats`, `memory-export`, channel memory, maintenance, summaries, dashboard, reply policy, prompts/templates, or output shapes.
- Per-account budgets or source labels in prompts.

## Decisions

### D1. Retriever request and source order

Add to `MemoryRecallRequest`:

```ts
/** Other workspaces of the same identity group; public, plus private in a DM. */
linkedWorkspaces?: readonly WorkspaceInfo[];
```

`loadDocuments()` keeps the current sources and loop unchanged, then:

```ts
const seen = new Set(documents.map((doc) => doc.memory.id));
for (const linked of request.linkedWorkspaces ?? []) {
  const visibilities: MemoryVisibility[] = request.workspace.isDm ? ["public", "private"] : ["public"];
  for (const visibility of visibilities) {
    try {
      const docs = await this.cache.getDocuments(
        this.memoryStore.getMemoryFilePathFor(linked, visibility),
        () => this.memoryStore.loadAllMemories(linked, visibility),
      );
      for (const doc of docs) {
        if (seen.has(doc.memory.id)) continue;
        seen.add(doc.memory.id);
        documents.push(doc);
      }
    } catch (error) {
      logger.warn("Skipped unreadable linked memory source", {
        workspaceKey: linked.key, visibility, error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
```

Add `const logger = createLogger("MemoryRetriever");` (`import { createLogger } from "@utils/logger.ts";`). Private inclusion is gated on `request.workspace.isDm` (the current session), not on `linked.isDm`; `rank()`'s existing visibility filter is the second gate. Dedupe is applied only to linked documents, so a request without linked workspaces is byte-identical to today. Everything after `loadDocuments()` (scope filter, supersede map, BM25, `excludeIds`, `expandRelated`, selection) is unchanged.

Alternative considered: a merged materialized index. Rejected: the per-path snapshot cache already invalidates per file.

### D2. Fixed loading helper in `ContextAssembler`

Constructor gains a fifth optional parameter `identityRegistry?: IdentityRegistry`, stored as `private readonly identityRegistry?: IdentityRegistry`. Add:

```ts
private async loadUserFixedCandidates(
  workspace: WorkspaceInfo,
  linkedWorkspaces: readonly WorkspaceInfo[],
  workingMaxItems: number,
): Promise<{ userCore: ResolvedMemory[]; userWorking: ResolvedMemory[] }>
```

It loads the current workspace exactly as today (errors propagate as today), then for each linked workspace in order loads `getCoreTierMemories(linked)` and `getRecentWorkingMemories(linked, workingMaxItems)` inside `try/catch`; a failure logs `logger.warn("Skipped unreadable linked memories", { workspaceKey: linked.key, error })` and contributes nothing. Dedupe uses one `seen: Set<string>` shared by core and working, initialized with the ids of the current workspace's core and working lists; each linked memory (core or working) whose id is in `seen` is dropped, otherwise its id is added. The current lists themselves are never deduped (identical to today). Returns concatenated arrays; `selectFixedMemories()` is called unchanged with the existing budgets.

- `assembleContext`: compute `const linkedWorkspaces = this.identityRegistry?.linkedWorkspaces(workspace) ?? [];` once; replace lines 243–247 with the helper; pass `linkedWorkspaces` as a new last parameter of `selectFastRecall`, which adds `...(linkedWorkspaces.length === 0 ? {} : { linkedWorkspaces })` to the `search()` request.
- `assembleSpontaneousContext`: same helper for its `userCore`/`userWorking`; no Fast Recall is added.
- Linked workspaces carry `isDm` of the current workspace (registry contract), so `getCoreTierMemories` reads linked private files only in a DM.
- Channel candidates and the channel workspace code are untouched.

### D3. `memory-search`

`MemoryHandler` constructor becomes `(memoryStore, retriever?, identityRegistry?: IdentityRegistry)`. In `handleMemorySearch`, before `search()`: `const linkedWorkspaces = this.identityRegistry?.linkedWorkspaces(context.workspace) ?? [];` and add `...(linkedWorkspaces.length === 0 ? {} : { linkedWorkspaces })` to the request. Save/stats/export are not edited.

### D4. Wiring

- `SkillRegistry` constructor gains a seventh optional parameter `identityRegistry?: IdentityRegistry`, passed as `new MemoryHandler(memoryStore, this.memoryRetriever, identityRegistry)`.
- `AgentCore`: after `this.memoryStore` is created, `this.identityRegistry = new IdentityRegistry(config.identities ?? [], this.workspaceManager);` and `logger.info("Identity groups loaded: {groupCount}", { groupCount: this.identityRegistry.groupCount });` (no account keys or group ids logged). Pass it as `new SkillRegistry(this.memoryStore, config.reminders, reminderStore, config.skills?.sendFile, config.memory.recall, undefined, this.identityRegistry)` and as the fifth `ContextAssembler` argument. Declare the field `private readonly identityRegistry: IdentityRegistry;` with the other fields and add `getIdentityRegistry(): IdentityRegistry` next to `getMemoryStore()`.
- `src/main.ts` / `src/bootstrap.ts`: no change.

### D5. Test fault injection

An unreadable linked source is produced by creating a **directory** at the linked account's `memory.public.jsonl` path (`Deno.mkdir(join(linked.path, "memory.public.jsonl"), { recursive: true })`). `Deno.readTextFile` then throws a non-NotFound error whose message does not contain "not found", so `MemoryStore.loadAllMemories` rethrows it; this exercises retrieval, fixed loading and (in `identity-linked-memory-patch`) patch resolution without a test subclass or helper injection point. Linked workspaces in unit tests come from a real `IdentityRegistry` over the test's `WorkspaceManager`, so paths match production.

### D6. Review document

`docs/architecture/memory-recall.md` (source set and identity groups) and `docs/guide/memory-experience.md` (cross-account sharing, DM-only private boundary, save stays local) are reviewed by a human as the named review document **"identity-linked-recall documentation review"**; wording is not a test requirement. Keep each file's existing language.

## Risks / Trade-offs

- [Linked memories crowd out the current account under shared budgets] → Accepted per source design; budgets stay operator-tunable in `memory.recall`.
- [Extra file reads per session] → Small operator-authored groups; retrieval uses the per-path snapshot cache.
- [A linked account's corrupted file breaks sessions] → Linked loads are isolated by `try/catch`; the current workspace keeps its existing behavior.
- [Fixed-loading log reveals linked workspace keys] → Keys are `{platform}/{userId}` (email user ids are hashes), already logged elsewhere; no addresses.

## Migration Plan

None. Pre-release; with `identities: []` every path is unchanged.
