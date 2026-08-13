## Why

Three gaps in the `send-file` skill against its sibling `send-reply`/`react-message`:

1. **Retry misfires on file-only turns.** The missing-response check in the message flow only counts `send-reply` and `react-message`. An agent that answers the user by sending a file (a fully visible, legitimate response) is treated as "no response": the second-chance retry prompt fires, wasting a model turn and risking a duplicate send.
2. **Caption bypasses the reply content pipeline.** `send-file` may carry a text caption, but that caption is sent raw: it skips the `stripXmlTags`/`unescapeNewlines` processing every `send-reply` message gets, so captions render inconsistently with replies (literal `<e>...</e>` tags and `\n` sequences leak through).
3. **No multi-file support.** `send-file` accepts exactly one `--file-path`. Platform APIs natively support multiple files per message (Discord attachments, Misskey `fileIds`), so the agent is forced into repeated calls instead of one multi-file delivery.

## What Changes

- **File send counts as a session response.** Successful `send-file` marks per-session response state (new `fileSent` flag on the session record, sibling of `replySent`), so concurrent sessions can never leak file-response state. The missing-response retry SHALL trigger only when none of `send-reply`, `react-message`, or `send-file` produced output. `SessionResponse` gains `fileSent` (explicitly `false` in every flow that does not track files); error dispatch is skipped when a file was sent. The retry prompt SHALL name all three communication tools and embed the `send-file` SKILL.md. **Partial delivery counts**: on platforms that deliver per-file messages, `fileSent` is marked as soon as at least one file reached the platform, and the result reports the delivered message IDs alongside the error — so a partial failure never re-triggers the missing-response retry.
- **Caption handled with the send-reply message design.** The caption SHALL go through the same content pipeline as `send-reply` messages (`stripXmlTags` then `unescapeNewlines`) before being sent as the file message text. It already uses the payload-file flow (`--caption-file`, from the prevent-shell-expansion change); the result contract SHALL match `send-reply` (messageId + `nextAction` exit hint). **Non-goals, by design:** a successful `send-file` does NOT set `replySent`, does NOT update `lastSentMessageId` (`edit-reply` stays scoped to text replies — see design rationale), and does NOT trigger conversation summary generation (a file-only turn has no conversational text to summarize).
- **BREAKING — multi-file sending.** The script flag `--file-path` is replaced by a repeatable `--file-paths` flag; the Skill API parameter becomes `filePaths: string[]`. The legacy singular flag SHALL be rejected with an instructive error (new code `SKILL_SINGLE_FILE_FLAG`). The platform adapter `sendFile()` signature changes from single `(fileContent, fileName)` to a `files: Array<{content, fileName}>` array; `SendFileResult` gains `messageIds`. All paths SHALL be validated (traversal, workspace/agent-workspace boundary — **including real-path/symlink-escape containment**, extension) and all files SHALL be read **before any file is sent** — preflight validation is all-or-nothing: one invalid path rejects the whole call with nothing sent.
- **BREAKING — per-session send-file quota.** Mirroring `send-reply`, at most **1 successful `send-file` call per session** (`MAX_FILE_SENDS_PER_SESSION = 1`; a multi-file batch counts as one call); further attempts SHALL be rejected with HTTP 429, and 4+ attempts SHALL trigger agent termination (doom-loop protection). This restores the external-output guard that an unlimited file skill would remove. `send-file` SHALL be rejected (HTTP 403) in triggerless sessions (spontaneous / self-research / memory-maintenance / reminders), which only track replies, and `send-file` results SHALL NOT be served from the request dedup cache so the quota/doom-loop gate runs on every attempt.
- **Batch limits.** `send-file` SHALL reject a batch that exceeds `skills.sendFile.maxFilesPerInvocation` (default 10 — Discord's per-message attachment cap) or `skills.sendFile.maxTotalSizeMb` (default 50) **before reading file bytes**, bounding memory and matching platform capabilities. New config fields with `SKILL_SEND_FILE_MAX_FILES_PER_INVOCATION` / `SKILL_SEND_FILE_MAX_TOTAL_SIZE_MB` env overrides.
- **Platform delivery semantics:** Discord sends one message with all attachments. Misskey notes create one note with all `fileIds`. Misskey chat (API supports one `fileId` per message) sends one message per file, caption on the first; on ANY failure path that leaves Drive uploads unreferenced by a delivered message (mid-batch upload failure, note-creation failure, chat mid-batch send failure), best-effort Drive cleanup of those uploads is attempted, and already-delivered messages are reported.
- **Audit & metrics alignment:** `session_end` audit gains `fileSent`; a `file_sent` audit phase records the send; `airfriends_files_sent_total` increments per delivered file (not per call).

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `skills-and-reply`: "Retry on Missing Reply" — file sends count as a response and suppress the retry; retry prompt lists `send-file` and embeds its SKILL.md. "XML Tag Stripping" / "Literal Newline Unescaping" — apply to `send-file` captions. "Reply Rules" — `send-file` is limited to one successful call per session with doom-loop protection, uses its own file-send state, and does not consume the reply quota. "Send-File Workspace Boundary" — multi-file parameter, per-file validation, batch-count and aggregate-size limits, preflight all-or-nothing rejection, partial-delivery accounting, singular-flag rejection (`SKILL_SINGLE_FILE_FLAG`). "Instructive Skill Error Messages" — new error code.
- `session-audit-log`: `session_end` data gains `fileSent`; new `file_sent` phase.
- `metrics-export`: `airfriends_files_sent_total` counts individual delivered files.

## Impact

- Skill script `skills/send-file/scripts/send-file.ts` (repeatable `--file-paths`, singular-flag rejection, updated caption example) and `skills/send-file/SKILL.md` (multi-file usage docs).
- `src/skills/file-handler.ts` — multi-file validation/read loop (batch-count and aggregate-size preflight, real-path/symlink-escape containment), caption content pipeline, result contract, per-file metric increment.
- `src/skills/registry.ts` — (no state accessor; response state lives in the session record); `src/core/session-orchestrator.ts` — read `fileSent` from the session record, include it in `hasResponded`, thread through retry loop and `SessionResponse` (explicit `fileSent: false` in all other flows); `src/core/reply-dispatcher.ts` + `src/core/agent-core.ts` — skip error dispatch when file sent.
- `src/skill-api/server.ts` — per-session `send-file` quota (1 successful call, doom-loop termination at 4 attempts), triggerless-session rejection (403), result-cache exclusion, `fileSent` marking, `file_sent` audit emission and result handling; `src/skill-api/session-registry.ts` — `fileSent` flag + `fileSendCount` counter.
- `src/types/config.ts` — `SendFileSkillConfig` gains `maxFilesPerInvocation` / `maxTotalSizeMb`; `config.example.yaml`, `.env.example`, `helm/values.yaml` gain the two env-var entries; `src/utils/env.ts` — the two overrides.
- `src/types/platform.ts` (`SendFilePayload`, `SendFileResult.messageIds`) and both platform adapters (`src/platforms/discord/discord-adapter.ts`, `src/platforms/misskey/misskey-adapter.ts`); Misskey `sendChatMessage` per-file batching with best-effort Drive cleanup on partial failure.
- `src/skills/memory-handler.ts` — memory-export call site updated to the new `sendFile` signature.
- `src/acp/agent-factory.ts` — retry prompt mentions `send-file` (with a "only if a suitable file already exists" qualifier).
- `src/types/audit.ts` — `file_sent` phase + `fileSent` field; `src/skill-api/server.ts` — `file_sent` audit emission and result handling.
- Tests: `tests/skills/file-handler.test.ts` (multi-file, batch limits, preflight all-or-nothing, partial delivery, caption pipeline, state), `tests/skills/scripts.test.ts` (repeatable `--file-paths`, singular-flag rejection, caption payload), orchestrator retry tests (file-only success, partial delivery, state clearing, `fileSent: false` defaults), platform adapter tests, Skill API quota/audit tests, dry-run regression test.
- Docs: `AGENTS.md`, `docs/SKILLS_IMPLEMENTATION.md` updated for the new contract.
- New configuration surface (see above); no migration needed (early-stage project, zero users).
