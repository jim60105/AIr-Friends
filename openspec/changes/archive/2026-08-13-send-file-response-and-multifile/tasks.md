## 1. Platform Adapter Multi-File Contract

- [x] 1.1 Add `SendFilePayload` interface (`{ content: Uint8Array; fileName: string }`) and `messageIds?: string[]` to `SendFileResult` in `src/types/platform.ts`
- [x] 1.2 Change abstract `sendFile(channelId, fileContent, fileName, options?)` to `sendFile(channelId, files: SendFilePayload[], options?)` in `src/platforms/platform-adapter.ts`
- [x] 1.3 Update Discord adapter `sendFile()` to accept the files array and send one message with all attachments (`AttachmentBuilder` per file); return `messageIds` (single-element for one message)
- [x] 1.4 Update Misskey adapter `sendFile()`: upload all files to Drive; notes path creates one note with all `fileIds`; chat path sends one message per file with the comment on the first message only; return `messageId` (last) and `messageIds` (all, in send order)
- [x] 1.5 Update the memory-export call site in `src/skills/memory-handler.ts` to the new `sendFile` array signature

## 2. FileHandler Multi-File, Caption Pipeline, and Response State

- [x] 2.1 Rewrite `FileHandler.handleSendFile` to accept `filePaths: string[]` (reject missing/empty/empty-string members), validate each path (traversal, workspace/agent-workspace boundary, extension whitelist), apply the per-file size limit, and enforce batch limits — `maxFilesPerInvocation` (default 10) and `maxTotalSizeMb` (default 50) — before reading any file bytes; all validation, limit checks, and reads complete before any platform call (preflight all-or-nothing)
- [x] 2.2 Apply the send-reply content pipeline to the caption: `stripXmlTags()` then `unescapeNewlines()` (reuse the functions from `src/skills/reply-handler.ts` or move them to a shared module) before passing as `comment`
- [x] 2.3 File-send response state is session-scoped: add `fileSent` flag to `SessionRegistry` (`markFileSent` / `hasFileSent`, default false at registration, sibling of `replySent`); the Skill API server marks it when at least one file was delivered (including partial delivery)
- [x] 2.4 Return result `data` matching the send-reply contract: `messageIds` (delivered), `messageId` (last delivered), `nextAction: "You have done your job. EXIT IMMEDIATELY"`; propagate partial-failure errors alongside delivered IDs; increment `filesSentTotal` once per delivered file

## 3. Registry and Orchestrator Response Accounting

- [x] 3.1 (superseded by 2.3) No file-handler accessor needed — response state is read from the session record; remove any handler-based state accessor
- [x] 3.2 In `SessionOrchestrator.processMessage()`: compute `fileSent` via `sessionRegistry.hasFileSent(shellSessionId)` (false when no shell session); evaluate `hasResponded = replySent || reactionSent || fileSent` before and after the retry loop (state is per-session, so no clearing needed)
- [x] 3.3 Add optional `fileSent?: boolean` to `SessionResponse`; set it in the success/end paths of `processMessage()`; set `fileSent: false` explicitly in every other flow's `SessionResponse` and `session_end` audit write (spontaneous, self-research, memory-maintenance, dry-run, error paths)
- [x] 3.4 Skip error dispatch when a file was sent: add `response.fileSent` to the guards in `src/core/agent-core.ts` and `src/core/reply-dispatcher.ts`

## 4. Skill API Quota Enforcement

- [x] 4.1 In `src/skill-api/server.ts`: enforce `MAX_FILE_SENDS_PER_SESSION = 1` for `send-file` (reserve before execution, rollback on zero delivery, count only when ≥1 file delivered), return HTTP 429 on excess, terminate the agent via `onTerminateRequest` at `MAX_FILE_SEND_ATTEMPTS_BEFORE_TERMINATE = 4` (doom-loop), reject triggerless sessions (no `triggerEvent`) with HTTP 403, exclude `send-file` results from the dedup cache, and mark the session's `fileSent` flag on delivery — mirroring the send-reply machinery without touching the reply counters

## 5. Retry Prompt

- [x] 5.1 Update `defaultRetryMessage` in `src/acp/agent-factory.ts`: mention "reply, reaction, or file", name `send-file` alongside `send-reply`/`react-message` with a qualifier to use it only when a suitable file already exists in the workspace, add a likely-cause bullet for `send-file` caption payloads, and embed the `send-file` SKILL.md content (read it with a try/catch fallback like the other two skills)

## 6. Skill Script and SKILL.md

- [x] 6.1 Update `skills/send-file/scripts/send-file.ts`: parse repeatable `--file-paths` (alias `-f`, `collect`), require at least one occurrence, reject singular `--file-path`/`--file-path=...` with instructive code `SKILL_SINGLE_FILE_FLAG` (example showing two `--file-paths` args) before any API call; send `filePaths` array to the Skill API; keep the optional `--caption-file` payload flow unchanged
- [x] 6.2 Update `skills/send-file/SKILL.md`: document the repeatable `--file-paths` flag (multi-file examples), the removed `--file-path` flag, the new `SKILL_SINGLE_FILE_FLAG` error code, the one-send-per-session rule, and that the caption follows the same payload-file rules as `send-reply`

## 7. Configuration Surface

- [x] 7.1 Add `maxFilesPerInvocation` (default 10) and `maxTotalSizeMb` (default 50) to `SendFileSkillConfig` in `src/types/config.ts`
- [x] 7.2 Wire `SKILL_SEND_FILE_MAX_FILES_PER_INVOCATION` / `SKILL_SEND_FILE_MAX_TOTAL_SIZE_MB` env overrides in `src/utils/env.ts`
- [x] 7.3 Document the two new settings in `config.example.yaml`, `.env.example`, and `helm/values.yaml` (env section)

## 8. Audit and Metrics

- [x] 8.1 Add `"file_sent"` to `AuditPhase` in `src/types/audit.ts` and `fileSent?: boolean` to the `session_end` data block
- [x] 8.2 In `src/skill-api/server.ts`: when `send-file` delivers at least one file, write a `file_sent` audit entry with `filesCount` (delivered count), `captionHash` (when hashing), `fileNamesHash` (hash of comma-joined names when hashing, plain names otherwise), `platform`

## 9. Tests

- [x] 9.1 Extend `tests/skills/file-handler.test.ts`: multi-file success (captures files array passed to adapter), preflight all-or-nothing rejection (one invalid path → no send), batch-count and aggregate-size limit rejections before read, caption pipeline (XML tags stripped, `\n` unescaped), missing/empty `filePaths` errors, per-file size/extension checks, `hasFileSent`/`clearFileState` behavior, `nextAction` in result data
- [x] 9.2 Extend `tests/skills/scripts.test.ts`: repeatable `--file-paths` reaches the API as an array; singular `--file-path` (both forms) exits with `SKILL_SINGLE_FILE_FLAG`, instructive message, and never hits the API; mixed singular+plural flags rejected; caption payload flow still works alongside multi-file; missing/out-of-bounds caption file still yields `SKILL_MISSING_PAYLOAD`-family errors
- [x] 9.3 Update platform adapter tests (Discord/Misskey) for the new `sendFile` array signature; add a Misskey chat multi-file case asserting one message per file with caption on the first and a mid-batch failure case asserting delivered IDs are returned and unreferenced uploads are best-effort deleted
- [x] 9.4 Add orchestrator-level tests: a session where the agent only calls `send-file` completes successfully without retry and reports `fileSent: true`; retry still fires when no reply/reaction/file occurred; file-send state is per-session (fresh each session); partial delivery (1 of 2 delivered) suppresses the retry; `fileSent: false` is returned by flows that do not track files
- [x] 9.5 Update `tests/skill-api/server.test.ts` and audit tests: `send-file` quota (second call → 429, doom-loop → terminate incl. identical repeated calls, rollback on zero delivery), triggerless-session rejection (403), partial delivery marks `fileSent` and keeps the quota slot, `file_sent` entry, `session_end.fileSent`
- [x] 9.6 Update the retry-prompt content test in `tests/acp/` if one exists (assert `send-file` appears with the qualifier)
- [x] 9.7 Add a dry-run regression test asserting no file-send response state is produced; confirm the web-dashboard-chat prompt still forbids `send-file`

## 10. Docs and Verification

- [x] 10.1 Update `AGENTS.md` and `docs/SKILLS_IMPLEMENTATION.md`: send-file multi-file contract, one-send-per-session rule, response accounting, caption pipeline, batch limits, error code
- [x] 10.2 Run `deno fmt --check src/ tests/`, `deno lint src/ tests/`, `deno check src/main.ts`, and `deno test`; ensure coverage stays above 75%
