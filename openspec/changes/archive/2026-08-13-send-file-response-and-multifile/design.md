## Context

The `send-file` skill delivers workspace files to the conversation channel, but it has diverged from its sibling skills in three ways:

1. **Response accounting.** `SessionOrchestrator.processMessage()` decides whether the agent "responded" from two handlers: `ReplyHandler.hasReplySent()` and `ReactionHandler.hasReactionSent()`. A turn that only sent a file is treated as unresponsive, triggering the second-chance retry prompt (wasted model turn, risk of duplicate output).
2. **Caption pipeline.** `send-reply` cleans messages with `stripXmlTags()` → `unescapeNewlines()` (Reply Rules/XML/Newline specs). `FileHandler` passes the caption straight through, so `<e>...</e>` tags and literal `\n` reach the platform.
3. **Single file.** The script takes one `--file-path`; the adapter contract is `sendFile(channelId, content, fileName, options)`. Discord (`files: []`) and Misskey notes (`fileIds: []`) natively support multiple attachments per message.

The caption already follows the send-reply payload-file flow (`--caption-file` under `$TMPDIR/$SESSION_ID/`, from the prevent-shell-expansion change) — that part of "same design as send-reply" is in place and stays.

## Goals / Non-Goals

**Goals:**

- A successful `send-file` counts as a session response; the missing-response retry only fires when none of reply/reaction/file was produced.
- The caption is processed with the exact same content pipeline as `send-reply` messages and delivered with the file.
- One invocation can send N files (bounded by batch-count/aggregate-size limits); preflight validation is all-or-nothing, delivery may be partial on per-file platforms with full accounting; the result contract mirrors `send-reply`.
- The external-output guard is preserved: at most one successful `send-file` call per session with doom-loop protection.
- Retry prompt, audit, metrics, and docs reflect the new semantics.

**Non-Goals:**

- **No `edit-file` skill and no editing of file messages.** `edit-reply` remains scoped to text replies.
- **No reply-quota consumption and no summary trigger.** `send-file` does not increment the reply count and does not trigger conversation summary generation (file-only turns carry no conversational text worth summarizing; the summary gate stays `replySent`).
- **No retry-semantics change for triggerless sessions** (spontaneous / self-research / memory-maintenance). Those flows already use simpler reply-only accounting (`replySent`); only the message flow gains `fileSent` in its `hasResponded` evaluation.
- **No per-platform max-file-count configuration beyond the shared batch limit.** Platform-specific extras (e.g. Discord's 10-attachment cap is already the default batch limit) surface as platform errors on the batch.
- **No caption re-editing, no cross-session file references.**

## Decisions

### D1 — Response state is per-session in `SessionRegistry`, not a channel-keyed map

`ReplyHandler`/`ReactionHandler` keep per-`{workspaceKey}:{channelId}` maps that the orchestrator reads and clears at session start. A first-draft design mirrored that for files, but a rubber-duck review flagged the hazard: a `{workspaceKey}:{channelId}` key races concurrent sessions on the same channel — one session's delivery could suppress another's retry, or a later clear could make the sending session retry despite delivery. File-send response state therefore lives on the **session record** (`SessionRegistry.fileSent`, initialized `false` at registration, sibling of the existing `replySent` flag): the Skill API server calls `markFileSent()` when at least one file was delivered, and the orchestrator reads `hasFileSent(sessionId)` (missing session ⇒ `false`). State is inherently per-session and cleared with the session lifecycle — no cross-session leakage, no manual clearing, no map leak.

- `SessionRegistry` gains `fileSent`, `markFileSent()`, `hasFileSent()`.
- `FileHandler` does NOT track response state (metrics only).
- `SkillRegistry` does NOT expose a file-handler accessor for state.

This deliberately does NOT touch the reply-limit counters (`replyCount`/`editCount`/doom-loop machinery stay reply-scoped); `fileSent` is a pure response-state flag parallel to the existing registry `replySent`.

**Alternative considered:** channel-keyed handler map mirroring reply/reaction — rejected after review: the concurrent-session race produces false-success sessions and skipped retries; the registry approach removes the race at no cost.

### D1b — Per-session send-file quota in the Skill API server

Mirroring `send-reply`, the Skill API server SHALL enforce `MAX_FILE_SENDS_PER_SESSION = 1` (a multi-file batch counts as one call): the send-file call is marked before execution, the mark is rolled back on total failure (nothing delivered), and the count is incremented only when at least one file was delivered. Rejected calls return HTTP 429 advising `edit-reply`-style in-session correction is not possible (no edit-file skill), and 4+ attempts trigger `onTerminateRequest` doom-loop termination — restoring the external-output guard that an unlimited file skill would remove. This is a hardcoded server-side constant, consistent with the reply/doom-loop constants; it does not interact with the reply count.

Two hardening decisions from review:

- **Triggerless sessions are rejected (HTTP 403)**. `send-file` is only meaningful where the flow tracks responses; spontaneous / self-research / memory-maintenance / reminder sessions only track `replySent`, so a file send there would be untracked output (duplicate spontaneous content, repeat reminder delivery). These sessions are identifiable by the absence of a `triggerEvent`, and the gate sits right before the quota check.
- **`send-file` results are never served from the request dedup cache.** The 1-second cache (keyed by skill+session+params) would otherwise return a cached success or rejection for identical repeated calls, bypassing the quota gate and starving doom-loop detection. In-flight concurrent duplicates still deduplicate via the pending-promise path (preventing double external delivery); completed results are simply not cached.

**Alternative considered:** unlimited send-file calls "because the agent is trusted" — rejected: the ACP agent processes user-controlled content; an unlimited external-output channel is a spam/abuse hole.

### D1c — Batch limits (count and aggregate size)

`FileHandler` SHALL reject a batch that exceeds `skills.sendFile.maxFilesPerInvocation` (default 10 — Discord's per-message attachment cap, used as the shared cap for all platforms) or `skills.sendFile.maxTotalSizeMb` (default 50) **before reading any file bytes**. This bounds the `N × maxFileSizeMb` memory the current design would allow (10 × 25 MB = 250 MB) and keeps batches within platform capabilities. New config fields + env overrides (`SKILL_SEND_FILE_MAX_FILES_PER_INVOCATION`, `SKILL_SEND_FILE_MAX_TOTAL_SIZE_MB`) following the existing `SKILL_SEND_FILE_*` pattern.

### D2 — Caption is a reply *message*, not a reply *accounting event*

The caption SHALL be processed through `stripXmlTags()` → `unescapeNewlines()` (the exact `send-reply` pipeline) and SHALL travel with the file message. The successful send marks `fileSent` (response tracking), but deliberately does NOT set `replySent`, does NOT consume the one-reply quota, and does NOT update `lastSentMessageId`.

**Why not full reply semantics?** `edit-reply` is scoped to the session's own most-recent message via `lastSentMessageId`, and on Misskey editing is delete-and-recreate. If a file message were editable, an edit would silently drop the attachment on Misskey (notes and chat). Keeping `send-file` out of `lastSentMessageId`/`replySent` makes it impossible for the agent to target a file message with `edit-reply`, avoiding cross-platform data loss. The caption still benefits from the message pipeline, and the file send still counts as a visible response — the two things that matter for rendering and retry.

**Alternative considered:** full reply semantics (mark replySent, update lastSentMessageId, consume quota) — rejected due to the Misskey attachment-loss hazard and because it would punish legitimate multi-file workflows with the one-reply limit.

### D3 — Adapter contract moves to a file array

`PlatformAdapter.sendFile()` becomes:

```ts
abstract sendFile(
  channelId: string,
  files: SendFilePayload[],          // { content: Uint8Array; fileName: string }
  options?: SendFileOptions,          // unchanged: comment, replyToMessageId
): Promise<SendFileResult>;          // + messageIds?: string[]
```

- **Discord:** one `channel.send({ files: [...] })` — all attachments, one message, one message ID.
- **Misskey note:** upload each file to Drive, then one `notes/create` with all `fileIds` — one note, one message ID.
- **Misskey chat:** the chat API (`chat/messages/create-to-user`) accepts one `fileId` per message, so the adapter sends one message per file; caption text goes on the first message only. Drive uploads happen before any chat message is created, so an upload failure aborts before anything is sent. Delivery is **not atomic**: if a mid-batch message send fails, the adapter SHALL stop, attempt best-effort deletion of the not-yet-referenced uploaded Drive files (`drive/files/delete`), and return a partial-failure result carrying the delivered `messageIds` plus the error. The handler treats any delivered message as a response (`fileSent` marked), so a partial failure never re-triggers the missing-response retry.
- **Drive cleanup covers every failure path** (review hardening): a mid-batch upload failure deletes the files uploaded so far; a `notes/create` failure after all uploads deletes every upload; the chat mid-batch path deletes the not-yet-referenced uploads. Uploads are only left behind when the best-effort deletion itself fails (accepted Misskey Drive behavior).
- `messageId` = last message ID (backward-compatible field for logs/result consumers); `messageIds` = all delivered IDs in send order.

**Alternatives considered:** (a) keep the single-file signature and loop in the handler — rejected: produces N separate messages on Discord/Misskey notes instead of one batched message, and loses the single-ID result contract; (b) reject multi-file on Misskey chat — rejected: the requirement is to support multi-file everywhere the platform allows, and per-file messages are the faithful chat-API mapping.

### D4 — Repeatable `--file-paths`, singular flag rejected

The script parses `--file-paths` with `collect` (repeatable, alias `-f`) and requires ≥ 1 occurrence; the Skill API receives `filePaths: string[]`. The old singular `--file-path` (both forms) is rejected with instructive code `SKILL_SINGLE_FILE_FLAG` showing the multi-file example — consistent with the project's "teach the correct pattern" contract philosophy (payload helper, legacy flags). Zero users in the wild makes the breaking rename free.

**Alternative considered:** keep `--file-path` and make it repeatable — rejected: the singular name misleads the agent into comma-joining or single-file usage; explicit plural + rejection teaches the capability.

### D5 — Preflight all-or-nothing; delivery may be partial

Every path is checked (traversal, workspace/agent-workspace boundary **including real-path / symlink-escape containment** — lexical prefix checks are insufficient because `Deno.stat`/`Deno.readFile` follow symlinks, so the resolved real path of each file is re-checked against the real workspace/agent-workspace roots), the batch is checked against the count/aggregate-size limits, and every file is read into memory BEFORE the first platform call. One bad path/file/limit breach fails the whole invocation with nothing sent. Rationale: partial deliveries are confusing to the user and the agent, and the validation loop is cheap compared to platform I/O. This guarantee is deliberately named **preflight** all-or-nothing: on platforms whose API sends one message per file (Misskey chat), delivery itself is inherently non-atomic and is handled by D3's partial-success accounting.

### D6 — Retry evaluation and error dispatch

`hasResponded = replySent || reactionSent || fileSent` in `processMessage()`, re-evaluated after each retry attempt; `fileSent` is read from the session record (`SessionRegistry.hasFileSent(shellSessionId)`), which is fresh per session — no clearing step is needed. `SessionResponse` gains optional `fileSent`; `reply-dispatcher` and `agent-core` skip error dispatch when `fileSent` is true. The retry prompt names all three tools and embeds the `send-file` SKILL.md.

### D7 — Audit, metrics, result contract

- New audit phase `file_sent` (filesCount = delivered count, captionHash when hashing, fileNamesHash, platform) written by the Skill API server when at least one file was delivered; `session_end` gains `fileSent` (explicitly `false` in all flows that do not track file sends).
- `airfriends_files_sent_total` increments once per delivered file (multi-file call increments by N) — the metric is described as "Total files sent", so per-file is the truthful accounting.
- Result `data` mirrors `send-reply`: `{ messageIds, messageId, nextAction: "You have done your job. EXIT IMMEDIATELY" }` so the agent stops after delivering; a partial failure additionally carries the platform error with the delivered IDs already present.
- Conversation summary generation stays gated on `replySent` (text replies only); file-only turns do not trigger a summary — deliberate, documented in the proposal's non-goals.

## Risks / Trade-offs

- **Misskey chat multi-file = N messages (N API calls).** More chatter and API usage than a single message → Mitigation: caption on the first message only; uploads are batched before any message is created; a mid-batch send failure stops the batch, reports delivered IDs, and best-effort deletes unreferenced Drive uploads; the delivered portion still counts as a response so the retry cannot duplicate it.
- **Drive orphans on any failure path.** Files uploaded but never referenced by a delivered message (upload mid-batch failure, note-creation failure, chat mid-batch failure) may remain → Mitigation: best-effort `drive/files/delete` on every failure path; residual orphans are an accepted Misskey drive behavior.
- **Triggerless sessions cannot send files.** Spontaneous / self-research / memory-maintenance / reminder sessions are rejected at the Skill API gate (HTTP 403) because they only track replies → Mitigation: instructive error tells the agent the session type cannot send files; spontaneous/reminder content stays reply-driven.
- **Batch limits are shared across platforms.** The 10-file default is Discord's per-message cap; Misskey has no such cap, so the shared limit is conservative for Misskey → Mitigation: configurable via `maxFilesPerInvocation`; documented default.
- **Discord per-file/message size limits beyond the 50 MB aggregate.** Platform errors surface wholesale (single message send is atomic) → Mitigation: no partial send on Discord; the agent sees the platform error and can split the batch.
- **One successful send-file per session may feel restrictive.** → Mitigation: a multi-file batch satisfies the need in one call (same shape as the one-reply rule); the limit restores the external-output guard and has doom-loop protection.
- **In-flight agents still using `--file-path`.** → Mitigation: instructive `SKILL_SINGLE_FILE_FLAG` error teaches the new form; zero production users.
- **Legacy `sendFile` callers.** Only internal call sites exist (`FileHandler`, memory-export) → Mitigation: both updated in the same change; mocks in tests updated.
- **Reply/reaction response state remains channel-keyed while fileSent is session-keyed.** The pre-existing reply/reaction maps keep their `{workspaceKey}:{channelId}` convention (out of scope); fileSent is deliberately session-scoped so concurrent sessions cannot leak file-response state — a strictly stronger guarantee than the legacy handlers provide.

## Migration Plan

No backward compatibility or migration required (early-stage, unreleased, zero users). Deploy by landing the change and updating `AGENTS.md` / `docs/SKILLS_IMPLEMENTATION.md` alongside. Rollback is a plain revert of the change.

## Open Questions

None blocking. (Possible follow-up, out of scope: a future `edit-file`/attachment-preserving edit capability for Misskey.)
