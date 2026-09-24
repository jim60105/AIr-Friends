## Context

See proposal.md — Why. The store layer already has `MemoryStore.patchChannelMemory(channelWorkspace, targetId, patch)` (`src/core/memory-store.ts:802-852`) with the same append-only patch-event semantics as user-scope `patchMemory()` (`src/core/memory-store.ts:139-198`), including the tier rule that core results pin `decay: 1.0` (`importance-decay` spec). Its patch type simply omits `visibility` — channel memories have no visibility field. Only the skill handler (`handleMemoryPatch`, `src/skills/memory-handler.ts:482-644`) hardcodes the user workspace.

The channel-branch pattern the handler should follow already exists three times in the same file: `handleMemorySave` (`:142-214`, including the F15 `context.canWriteChannelMemory !== true` gate and the `channelId`/`workspaceManager` guards), `handleMemorySearch` (`:340-363`), and `handleMemoryStats` (`:446-460`) — all resolve the channel workspace with `context.workspaceManager.getOrCreateChannelWorkspace(context.workspace.components.platform, context.channelId)`. `memory-search` results already label each entry with `scope: "user" | "channel"`, so agents hold the scope information needed to route the patch.

## Goals / Non-Goals

**Goals:**
- Agents can patch channel-scope memories found via `memory-search` (disable, decay, tier, category, importance, relatedTo, supersedes).
- Channel patches are authorization-gated exactly like channel saves (F15).
- Existing user-scope patch behavior — parameters, defaults, error strings, response shape — is byte-for-byte preserved when `scope` is omitted.

**Non-Goals:**
- No changes to `MemoryStore` (`patchMemory` / `patchChannelMemory` / resolution logic), memory file formats, or the HTTP skill API surface (params pass through the generic registry route).
- No auto-scope detection, no batch patching (an agent patches N memories with N calls, as today), no dashboard/audit changes.
- No new capability for channel-scope `visibility` — the field does not exist there; do not fabricate one.

## Decisions

### D1: Explicit `--scope user|channel` flag; no silent fallback

`MemoryPatchParams` gains `scope?: string` (same optional-string shape as `MemorySaveParams.scope` / `MemorySearchParams.scope`, `src/skills/types.ts`). Validation copies the save pattern verbatim (`memory-handler.ts:89-95`): `const scope = (params.scope ?? "user") as MemoryScope;` then reject when `scope !== "user" && scope !== "channel"` with `"Invalid 'scope' parameter. Must be 'user' or 'channel'"` — the exact string used by save/search. The `?? "user"` default happens BEFORE the enum check (as in save), so an explicit `null`/bogus value is rejected, not defaulted.

*Rejected alternative — try user store, then channel store when scope is omitted.* It is ambiguous (patching the wrong store on an ID collision is silent data corruption of the wrong scope's file), it pays a full load of both stores per patch, and it breaks the authorization model: a fallback would make an unauthorized session's failing user patch leak into a channel-store probe. Explicit scope matches `memory-save`/`memory-search`, and the scope is already in the agent's hand from the search result. Boring and unambiguous wins.

### D2: Channel branch mirrors `handleMemorySave`'s channel branch

Placement: **after** the existing per-field validation and the "at least one field" check (all shared — validation is scope-independent), replacing the single `patchMemory()` call site. Order of gates, identical to save (`:142-163`) except that the visibility gate is checked first — before the authorization gate — which is deliberate: its message is a static string independent of channel state and leaks nothing (an unauthorized session learns only that visibility is not patchable on channel scope, information already published in SKILL.md). The visibility-rejection spec scenario therefore carries a `canWriteChannelMemory` GIVEN so it and the authz scenario never claim different errors for the same input on an unauthorized session.

1. `visibility !== undefined` → error `"'visibility' cannot be patched on channel-scoped memories (channel memories are always public; use scope 'user' to patch visibility)"`. Rejected in the handler, not swallowed by the store — `patchChannelMemory`'s patch type has no `visibility` field, and silently dropping an operator-visible request would be a lie. (Distinct from save, where the channel-memory spec *overrides* visibility to public: a save may omit visibility, a patch that asks for it asked for something that doesn't exist.)
2. `context.canWriteChannelMemory !== true` → `"Not authorized to write channel memory in this session"` (verbatim save string; keep the taxonomy stable — patch is a channel write).
3. `!context.channelId` → `"Cannot patch channel memory: no channelId in context"`; `!context.workspaceManager` → `"Cannot patch channel memory: workspaceManager not available"` (save pattern `:152-163`).
4. `getOrCreateChannelWorkspace(...)` → `patchChannelMemory(channelWorkspace, params.memory_id, patch)` (patch object built by the existing shared code; its `visibility` key can only be present on the user path because of gate 1).

On success: log via `logger.info("Channel memory {memoryId} patched via skill", ...)` (Message Template style as in save's channel branch), bump `memoryOperationsTotal.labels("patch", "public")` — channel memories are always public, matching save's channel branch — and return the same `{ patchId, targetId, timestamp, changes }` shape as the user path, plus `scope: "channel"` for agent clarity.

### D3: Instructive not-found on the user path

`patchMemory` throws `MemoryError(MEMORY_READ_FAILED, "Memory not found: <id>")`. Wrap the user-path call: if the thrown error message starts with `"Memory not found:"`, return `success: false` with `error: "Memory not found: <id>. If it is a channel-scoped memory (see the 'scope' field of memory-search results), retry with --scope channel"`. Any other error propagates through the existing catch unchanged. Not-found on the channel path keeps the store's `"Channel memory not found: <id>"` verbatim (it already names its scope). The reverse hint (channel → user) is skipped — the channel error text already says "Channel". The hint is emitted unconditionally on the prefix, including in DMs with no `channelId`: deliberate, because conditioning on channel context would hide the retry path from exactly the maintenance/DM sessions that hit the not-found first, and the sentence costs nothing.

### D4: CLI flag parsing copies `memory-save.ts`

Add `"scope"` to the `string:` list in `skills/memory-patch/scripts/memory-patch.ts`; validate `["user","channel"].includes(args.scope)` else `exitWithError("Invalid scope. Must be 'user' or 'channel'")`; set `params.scope = args.scope`. Handler re-validates (the HTTP API is reachable directly; never trust the script).

### D5: Tests in `tests/skills/` mirroring `channel-memory-authz.test.ts`

Handler-level tests with temp-dir `WorkspaceManager` + real `MemoryStore` (the established F15 harness): (a) incident regression — authorized session patches a channel memory's `decay` 0.8→0.4, resolved state shows 0.4, original line untouched, patch event appended; plus the importance-decay interaction on the channel path: patching `{ tier: "core", decay: 0.4 }` on a working-tier channel memory SHALL resolve to `decay: 1.0` (store core-pin honored through the skill); (b) unauthorized `scope: "channel"` → rejection, channel file has no new event; (c) authorized `scope: "channel"` + `visibility` → rejection mentioning channel; (d) user-scope not-found error contains `--scope channel`; (e) channel-scope not-found keeps the store error verbatim; (f) user-scope patch without `scope` still succeeds with unchanged response shape (regression guard, may live in `memory-handler.test.ts` alongside existing patch tests); (g) invalid `scope: "guild"` rejected with the save/search error string. No new test infrastructure.

## Risks / Trade-offs

- [Core-tier channel memory targeted for decay patch] → `patchChannelMemory` already pins `decay: 1.0` for core results (store rule, untouched); the skill succeeds with the tier rule applied, matching user-scope behavior and the `importance-decay` spec. No new handler logic.
- [Skill channel patch can promote an entry to `tier: "core"`] → Unlike `addChannelMemory` (which force-downgrades a skill-requested core), `patchChannelMemory` honors a `tier: "core"` patch event, so an authorized session can promote an existing entry; this is store-honored behavior untouched by this change, is bounded by the channel core-tier cap (`MAX_CHANNEL_CORE_ENTRIES`, enforced via the dashboard/core queries), does not violate the `importance-decay` rule (which only forbids *reducing* core decay), and is exactly the semantics the user-scope patch path already has. Accepted; a handler-side downgrade mirroring save would be an F15-purism follow-up if operators ever demand it.
- [F15 policy widens what `canWriteChannelMemory` sessions can do] → Intended: the capability means "may write channel memory", and a patch event is exactly the append-only write the capability gates. Channel-memory bounds/moderation requirements are unaffected (patches never create entries; core pins can't be loosened by any process).
- [Agents habitually omit `--scope`] → the enhanced not-found error names the retry, converting the incident's dead end into one extra call. Accepted cost of D1's explicitness.
- [Error-string drift between save and patch channel branches] → D2 mandates verbatim reuse of the authorization string; tests (b)/(d) pin the two strings this change owns.
