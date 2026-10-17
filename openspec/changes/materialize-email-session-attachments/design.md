# Design

## Context

See proposal.md for scope. The authoritative design at `docs/superpowers/specs/2026-10-17-email-platform-design.md:64-70` requires agent-accessible copies within the current user's session. `message-store.ts` produces `email-local` metadata, and adapter event/history/message retrieval forwards it without `sessionPath`. `context-assembler.ts:968-974` emits opaque identifiers and `session-orchestrator.ts:6211-6218` skips unstaged local images. The verified isolated probe observed null sessionPath and zero image blocks; it did not exercise IMAP-to-model delivery.

`attachment-materializer.ts` already validates owner and IDs, checks destination containment and rejects symlinks before archive reads. `session-staging.ts` and orchestrator `stagingDirFor` already define the literal Skill API session-id directory, with workspace tmp fallback when Skill API is disabled. Backend forwarding reads raw archive files independently.

## Goals / Non-Goals

**Goals:** Make existing attachment references usable through the production session boundary with one shared preparation operation and no session state on the global adapter.

**Non-Goals:** New MIME parsing, archive layout, image policy, forwarding behavior, permission widening, persistent sessionPath fields, or a generic cross-platform attachment framework.

## Decisions

### Bind materialization to the host session

Wire an email-only attachment-preparation dependency from the existing email message store through activation/core composition. The operation accepts host-owned session owner, canonical staging directory and returned messages; it invokes the existing materializer for each local reference. Never take owner or staging root from tool parameters, email body, attachment metadata or process TMPDIR. Validate the workspace belongs to the active email owner before using its staging root. Keep adapter retrieval session-neutral.

Use session-local copies of message/attachment metadata and assign sessionPath only after successful materialization. Ignore previously populated paths when preparing another session. Deduplicate identical owner/record/attachment references within one preparation batch, without a global cache. Do not persist these paths in message records or events shared with concurrent sessions.

### Integrate before every consumer

After workspace/session staging provisioning, prepare the trigger before initial context assembly. Give the context assembler the same session-bound preparation callback so fetched recent messages are prepared before attachment formatting and budget accounting. Both orchestrator prompt paths at the existing buildPromptContent callers consume that prepared trigger. Preserve the current trigger-only image selection and image-size/capability limits.

Thread the same host-owned preparation capability through the Skill API context. In `context-handler.ts`, prepare email messages before serializing fetch-context results; in `reply-handler.ts`, prepare a fetched email before returning get-message data. Preserve existing owner/thread checks and limits on all retrieval paths. Search retrieval, if supported by the email adapter, uses the same preparation step. No tool receives arbitrary archive access.

### Treat failures explicitly

If a requested attachment cannot be safely staged, fail that preparation/retrieval with a content-free diagnostic; initial prompt preparation must not proceed with opaque references presented as usable files. Do not log filenames, body text, source bytes or private archive paths. Existing session tmp cleanup owns any partial copies; permanent archive bytes remain intact. Repeat retrieval may rematerialize inside the same current boundary through the existing helper.

## Risks / Trade-offs

Staging included history adds bounded file I/O; retain existing message/count limits and avoid staging the whole archive. Session metadata copying prevents cross-session mutation at a small per-returned-message cost. Failure of one required attachment prevents that context result, making incomplete access visible rather than silently omitting files.

The helper's path checks must be exercised through production wiring with hostile filenames and symlinked destination components. This change reuses its containment model and grants no direct archive read permission to the agent.

## Verification and rollout

During apply, add focused production-path tests covering trigger/history and both prompt callers, fetch-context/get-message, per-session isolation, unsafe destinations, missing source and cleanup. Confirm only trigger images become image blocks and backend forwarding still reads unchanged archived bytes. Update `docs/email-platform.md` for session paths and failures. No data migration or compatibility shim is required; existing archive references are materialized on demand.
