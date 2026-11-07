# Identity-Linked Memory Recall Design

- Date: 2026-11-07
- Status: Approved in brainstorming
- Scope: One change, `identity-linked-memory-recall`

## 1. Goal

Let an operator declare that several platform accounts belong to the same human, and let the agent recall memories from every account in that group as if they were one memory population.

The storage layout does not change:

- Every account keeps its own workspace directory and its own `memory.public.jsonl` / `memory.private.jsonl`.
- `memory-save` keeps writing to the current account's workspace.
- Channel-scoped memory keeps its per-channel workspace.
- No workspace is merged, copied or linked on disk.

Only the **read** paths merge:

1. Fixed loading at session start (core and working tiers).
2. Fast Recall (trigger-message retrieval during context assembly).
3. The `memory-search` skill (Deep Recall).

`memory-patch` is the one write path that may target another account, because it updates an existing memory in place: the patch event is appended to the workspace that actually owns the target memory. Nothing is copied.

The merged view is intentionally unattributed: the agent treats the memories as one person's memories and does not receive a platform or workspace label. This was an explicit decision.

## 2. Non-goals

- No workspace consolidation, no shared filesystem, no cross-account file access by the agent.
- No change to reply policy, the `channels` allowlist, platform adapters, rate limiting, YOLO resolution or permissions.
- No merge for `memory-stats`, `memory-export`, memory maintenance, conversation summaries or the dashboard.
- No runtime reload: identity groups are read once at startup and require a restart to change.
- No automatic identity inference. Groups exist only because an operator wrote them.

## 3. Configuration

New top-level key `identities`:

```yaml
identities:
  - id: "alice"
    accounts:
      - "discord/123456789012345678"
      - "misskey/abcdef1234567890"
      - "alice@example.com"
```

`id` is an operator-facing label used only in logs and error locations. It has no semantic effect.

`accounts` accepts three forms and normalizes every entry to the internal workspace key form `{platform}/{userId}`:

| Input form | Example | Canonical result |
|---|---|---|
| Workspace key | `discord/123456789012345678` | `discord/123456789012345678` |
| Channel-style account id | `discord/account/123456789012345678` | `discord/123456789012345678` |
| Email canonical address | `alice@example.com` | `email/e_<sha256>` |
| Email workspace key | `email/e_<sha256>` | `email/e_<sha256>` |
| `email/` + address | `email/alice@example.com` | `email/e_<sha256>` |

Normalization rules:

- Trim surrounding whitespace.
- A value containing `@` and no `/` is an email address and goes through `normalizeEmailMailbox()`.
- A value starting with `email/` strips that prefix; the remainder is either a canonical address (normalized) or a `e_<64 hex>` owner id (validated as-is).
- Any other value is split on the first `/` into `platform` and `userId`; `platform` must be one of `VALID_PLATFORMS` (`discord`, `misskey`, `email`), and `userId` must be non-empty and contain no `/`. Values matching `{platform}/account/{userId}` are accepted through `parseChannelId()` and collapsed to `{platform}/{userId}`.
- Unknown platforms, channel ids (`{platform}/channel/...`), timeline ids and malformed values fail configuration loading.

Validation is fail-fast with `ConfigError`:

- `identities` must be an array of mappings.
- `id` must be a non-empty unique string.
- `accounts` must be a non-empty array of strings.
- The same canonical account key must not appear twice, either inside one group or across groups.
- Error messages identify the field path (`identities[i].accounts[j]`) and never echo the raw value, so an email address cannot leak through an error message or log line.

Environment override `IDENTITIES` (JSON array, same shape, parsed before validation) mirrors `CHANNELS`:

```bash
IDENTITIES='[{"id":"alice","accounts":["discord/123","alice@example.com"]}]'
```

`src/utils/env.ts` adds `IDENTITIES: "identities"` to `ENV_MAPPINGS` and JSON-parses it with the existing `CHANNELS` pattern (a non-array or invalid JSON is ignored with a warning).

An account does **not** have to appear in `channels` to be linked. Linking is its own authorization for memory recall; reply policy stays independent.

## 4. Components

### 4.1 `IdentityRegistry`

New module `src/core/identity-registry.ts`.

```ts
export interface IdentityGroupConfig {
  id: string;
  /** Canonical workspace keys, produced by the config loader. */
  accounts: string[];
}

export class IdentityRegistry {
  constructor(groups: readonly IdentityGroupConfig[], workspaceManager: WorkspaceManager);

  /** Group label of a workspace key, when the account is linked. */
  groupOf(workspaceKey: string): string | undefined;

  /**
   * Other workspaces of the current account's group, in configuration order.
   * Empty when the account is not linked or the group has one account.
   */
  linkedWorkspaces(current: WorkspaceInfo): WorkspaceInfo[];

  /** Number of configured groups, for startup observability. */
  readonly groupCount: number;
}
```

`linkedWorkspaces()` uses one private helper, `workspaceInfoFor(accountKey)`, to construct read-only `WorkspaceInfo` objects:

- `key = workspaceManager.computeWorkspaceKey({ platform, userId })`
- `path = workspaceManager.getWorkspacePath(key)`
- `tmpPath = join(path, "tmp")`
- `isDm = current.isDm`

`isDm` here means "private visibility is allowed in this recall", which is exactly how `MemoryStore` consumes the field. It is not a claim about the linked account's own conversation history.

Every configured account key passes through `computeWorkspaceKey()` and `getWorkspacePath()`, so a traversal-shaped userId is sanitized and a resolved path that leaves the workspace root is rejected by the existing boundary check.

The registry never creates a directory, never creates a workspace and never writes a file. A linked account that has never interacted with the bot resolves to a path whose memory files do not exist; loading it yields an empty list.

Groups are explicit and non-transitive: an account belongs to at most one configured group.

### 4.2 Config types and loader

- `src/types/config.ts`: add `IdentityGroupConfig` and `Config.identities?: IdentityGroupConfig[]`.
- `src/core/config-loader.ts`: default `identities: []`, normalize and validate after environment overrides (so YAML and `IDENTITIES` go through the same path), and build `IdentityGroupConfig` values containing canonical account keys.

### 4.3 `ContextAssembler`

Constructor gains an optional fifth parameter `identityRegistry?: IdentityRegistry`. Absent means no linking, so existing hand-built test constructions keep their behavior.

Both fixed-loading sites change from one workspace to a source set:

```ts
const memoryWorkspaces = [workspace, ...identityRegistry.linkedWorkspaces(workspace)];
```

- `assembleContext` (normal/lurk sessions) concatenates `getCoreTierMemories(w)` and `getRecentWorkingMemories(w, workingMaxItems)` across every workspace, then calls the existing `selectFixedMemories()` with the existing budgets.
- `assembleSpontaneousContext` does the same for its core/working candidates. Spontaneous sessions are trigger-less, so they still run no Fast Recall.
- Channel memory candidates are untouched and stay scoped to the current channel.

Budget semantics:

- All accounts share one `coreMaxTokens` budget and one `workingMaxTokens` / `workingMaxItems` budget. No per-account extension is added.
- `selectFixedMemories()` already sorts core oldest-first and working newest-first and already numbers the rendered lines deterministically, so multiple workspaces need no new ordering rule.
- `injectedIds` still contains exactly the memories injected, so Fast Recall excludes them across the merged population.

Fast Recall (`selectFastRecall`) passes the linked workspaces to the retriever (section 5).

### 4.4 `MemoryRetriever`

`MemoryRecallRequest` gains:

```ts
/** Other workspaces of the same identity group; public, plus private in a DM. */
linkedWorkspaces?: readonly WorkspaceInfo[];
```

`loadDocuments()` builds the source list in a fixed order:

1. Current workspace public file.
2. Current workspace private file when the current session is a DM.
3. Current channel memory file when not a DM and a channel workspace was supplied.
4. Every linked workspace's public file.
5. Every linked workspace's private file when the current session is a DM.

All documents then enter the existing single population. BM25 statistics, the supersede map, `relatedTo` expansion, scope filters, visibility filters and the mode-specific selection are unchanged. This means:

- Cross-account `relatedTo` and `supersedes` references work inside the merged view.
- `excludeIds` applies across the merged view.
- The existing `visibility !== "private" || isDm` filter remains as a second privacy gate.
- No output field changes: results carry no source attribution.

Snapshot cache:

- `MemorySnapshotCache` keys entries by absolute file path, so every source is cached independently.
- A patch or save to any account's JSONL changes that file's size and invalidates only that source on the next search.
- No index, no materialized merged file, no write hook.

Duplicate memory ids (pathological, because ids are timestamp + random):

- At document-loading time, a later document whose id already appeared is dropped, so the current workspace wins over linked accounts and an earlier configured account wins over a later one.
- This preserves the documented "no id appears twice" contract of Deep Recall.
- `memory-patch` still reports ambiguity instead of guessing (section 4.6).

Linked-source failure handling:

- A linked source that cannot be read (permissions, I/O, malformed path) is logged at `warn` and skipped, so one bad linked account cannot break the current account's session.
- The current workspace keeps its existing failure behavior.

### 4.5 `MemoryHandler` (`memory-search`)

- Constructor gains an optional `identityRegistry?: IdentityRegistry`.
- `handleMemorySearch` resolves `linkedWorkspaces` from `context.workspace` and passes them to `retriever.search({ mode: "deep", ... })` together with the existing channel workspace resolution.
- Output shape and token budgeting are unchanged. The `agentNotes` section is unchanged.
- `memory-stats` and `memory-export` are intentionally not changed.

### 4.6 `MemoryHandler` (`memory-patch`)

User-scope patch resolution:

1. Look for `memory_id` in the current workspace, exactly as today.
2. If absent, search each linked workspace in configuration order.
3. If exactly one workspace owns the id, call the existing `patchMemory()` on that workspace, so the patch event appends to the owner's JSONL.
4. If no workspace owns the id, return the existing not-found error.
5. If more than one workspace owns the id, return an explicit ambiguity error naming the id; do not pick one.

Supporting change: `MemoryStore.findMemoryById()` becomes public (it already resolves patches and already checks private memories only when `workspace.isDm`). Linked workspace objects carry the current session's `isDm`, so a public-channel session cannot patch another account's private memory, while a DM can.

Channel-scope patching is unchanged and still requires `canWriteChannelMemory`.

## 5. Data flow

```text
config.yaml / IDENTITIES
        │  normalize + validate at load
        ▼
IdentityRegistry ──► linkedWorkspaces(current)
        │
        ├── ContextAssembler fixed loading ──┐
        │    current + linked core/working   │
        │                                    ▼
        │                          selectFixedMemories(existing budgets)
        │
        ├── ContextAssembler Fast Recall ──► MemoryRetriever.search(fast)
        │
        └── MemoryHandler memory-search ───► MemoryRetriever.search(deep)
                                             │
                                             ▼
                              sources: current public/private,
                              current channel, linked public/private(DM)
                                             │
                                             ▼
                              one BM25 population + existing selection
```

Writes:

```text
memory-save  ──► current workspace JSONL only
memory-patch ──► current workspace first; otherwise the owning linked workspace
channel write ─► channel workspace (unchanged)
```

## 6. Privacy and invariants

- Linked private memories are readable only when the current session is a DM. They are never added as sources in a non-DM session, and the existing visibility filter also rejects them.
- Linking is authorized by the operator. A linked account's memories become readable by the other linked accounts; the design adds no further consent check.
- Recall never writes, creates or mutates a workspace directory.
- The current account's own memory behavior is unchanged when it belongs to no group.
- An account in two groups is a configuration error, never a transitive merge of those groups.
- Email addresses are normalized to owner ids before use; logs and errors use group ids and field paths, never addresses.
- The identity feature has no effect on platform replies, DM/channel routing, audit phases or skill permissions.

## 7. Wiring

- `AgentCore` creates one `IdentityRegistry` after `WorkspaceManager` and before `SkillRegistry` / `ContextAssembler`.
- `SkillRegistry` receives the registry and passes it to `MemoryHandler`.
- `ContextAssembler` receives the registry as its fifth constructor argument.
- `main.ts` bootstrap path needs no new service, scheduler or background task: config is static for the process lifetime.

## 8. Testing

| Test file | Coverage |
|---|---|
| `tests/core/identity-registry.test.ts` | Canonical forms, group lookup, current account not linked, ordering, read-only workspace construction, no directory creation |
| `tests/core/config-loader.test.ts` | `identities` validation, duplicate id, duplicate account within/across groups, email address normalization, malformed platform/channel id, `IDENTITIES` env override, error messages do not echo addresses |
| `tests/core/memory-recall/retriever.test.ts` | Linked public memories ranked with current ones, linked private excluded outside DM and included in DM, cross-source `relatedTo` / `supersedes` / `excludeIds`, duplicate id resolution order, missing linked file yields no documents, linked read failure is skipped |
| `tests/core/context-assembler.test.ts` | Fixed loading merges core/working, shared budgets, spontaneous assembly merges, linked failure does not fail assembly, no-group behavior is byte-identical to today |
| `tests/skills/memory-handler.test.ts` | Search passes linked sources, patch resolves owner, patch ambiguity, patch not-found, save stays local, stats/export stay local |
| `tests/integration/` | One session with a linked account recalls that account's memory through the real assembly path |

The repository test rules apply: tests must be deterministic and isolated, must not observe another module's environment variables, and coverage must stay above 75%.

## 9. Verification

- `deno fmt --check src/ tests/`
- `deno lint src/ tests/`
- `deno check src/main.ts`
- `deno task test`
- Manual smoke with `--dry-run`: create two fixture workspaces, give account A a memory, link A and B, then run a B session and confirm the assembled prompt contains A's memory. Repeat in a public-channel fixture and confirm A's private memory is absent.

## 10. Documentation

- `config.example.yaml`: `identities` block with comments, canonical forms and a "linking is authorization" warning.
- `.env.example`: `IDENTITIES` JSON example.
- `helm/values.yaml`: `IDENTITIES` under `env:`.
- `docs/reference/config-schema.md`: table row for `identities` / `IDENTITIES`.
- `docs/admin/configuration.md`: core configuration block entry.
- `docs/architecture/memory-recall.md`: source set and identity groups.
- `docs/guide/memory-experience.md`: cross-account sharing and the DM-only private boundary.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| An operator links an account that belongs to someone else, granting memory access | Documented as an explicit authorization; no inference, no defaults, no partial groups |
| Linked core/working memories crowd out the current account under the shared budget | Budgets stay unchanged and operator-tunable through `memory.recall`; no silent per-account expansion |
| Duplicate memory ids across accounts | Deterministic dedupe at load (current workspace first) and explicit ambiguity error on patch |
| A corrupted or unreadable linked account breaks sessions | Linked sources log and skip; the current workspace keeps its existing failure behavior |
| Extra per-session file reads | The number of linked accounts is a small operator-authored set; recall uses the snapshot cache and fixed loading is local I/O |
| Identity changes need a restart | Documented; no hot reload machinery added |

## 12. Rollout and compatibility

- `identities` defaults to an empty list; with no groups every code path behaves exactly as today.
- No data migration, no schema change to memory events, no workspace layout change.
- The feature ships as one OpenSpec change; configuration, source resolution, recall integration, patch ownership and documentation are delivered together.
