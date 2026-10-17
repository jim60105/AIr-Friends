# Design

## Context

See proposal.md for motivation. The original approved design at `docs/superpowers/specs/2026-10-17-email-platform-design.md:88,133` promises the persisted originating thread/anchor after restart. The main `scheduled-reminders` spec has the same promise. Later `docs/email-platform.md:2460-2463,2482-2484` deliberately requires membership in bounded recent history and documents expiry. This proposal explicitly supersedes that later expiry contract through delta requirements and an apply-time documentation update.

`session-orchestrator.ts:5513-5517` checks last-200 membership and disables the reminder on a miss. Independently, `email-adapter.ts:609-626` selects explicit anchors from its bounded send history. The adapter then searches that same recent window for an inbound sender. `EmailMessageStore.get(owner, threadId, recordId)` already validates IDs and both ownership boundaries; adapter `fetchMessage` uses it. The verified 201-record probe found the original through durable get/fetchMessage while preflight and explicit send resolution refused it, including after store reopen. That probe did not run a complete scheduler/SMTP flow.

## Goals / Non-Goals

**Goals:** Remove history-window expiry from both explicit-anchor checks while preserving fail-closed origin validation and submission accounting.

**Non-Goals:** Unbounded prompt history, larger scan limits, scheduler redesign, automatic revival of disabled reminders, persistence migration, new retry policy or relaxed allowlist/third-party grants.

## Decisions

### Use existing durable interfaces in both checks

Replace reminder preflight's recent membership check with a narrow host-owned email reply-eligibility resolver backed by durable owner-thread-record lookup. Reuse this resolver in adapter explicit-send resolution so both checks validate record identity, usable wire threading and verified recipient. `fetchMessage` alone returns no wire IDs and cannot prove eligibility. Expose the resolver through existing email service/core composition, without exposing archived content to tools. Lookup errors or unavailable capability fail closed for email. Permanent unusable origins become disabled/review-required before generation; retain evidence suppression ahead of generation. Remove the obsolete anchor-window constant/comments and keep non-email behavior unchanged.

In adapter explicit-send resolution, call `messageStore.get(owner, threadId, replyToMessageId)` directly before any bounded-history dependency. A missing/invalid record refuses the send. Thread references and subject come from that exact selected record. Do not require nonempty recent history in this explicit branch. The implicit branch retains its existing latest-record selection and bounded context behavior; spontaneous sends retain their separate new-thread path.

### Resolve the initiating sender independently of recent context

For the persisted reminder's original inbound anchor, derive the recipient from that durable record's normalized verified sender and require it to map to the owner. Keep current submission-time allowlist checks. Do not choose a latest inbound sender from the last 200 records.

Explicit anchors can also reference outbound records under existing reply behavior. Add a small `EmailMessageStore` method that inspects the existing thread index under the owner lock and returns validated same-owner-thread inbound recipient metadata without cloning whole message histories or using owner-wide sender fallback. No new index or persistence is needed. Use it for outbound anchors without a finite eligibility window and validate normalized sender against owner. If no verified inbound source exists, refuse. Missing threading identifiers remain a refusal. Do not change implicit-anchor sender selection in this repair.

### Preserve operation identity and evidence ordering

Do not change `{ workId: reminder.id, actionSlot: reminder:<id> }`, evidence checks before generation, or the service journal's suppression of submitted/unknown/submitting operations. Preserve exact-origin propagation through the session and Skill API. Never allocate a DM/new thread or infer a third-party grant. Keep current review-required behavior for truly unusable origins and revoked owners.

## Risks / Trade-offs

A retained record can still be unusable due to missing source/wire identifiers or corruption. Durability removes age as a failure reason; it does not promise recovery of deleted records. Durable metadata lookup must retain owner+thread containment and fail closed on archive errors. Outbound explicit anchors need durable inbound metadata lookup so an all-outbound recent suffix cannot recreate expiry indirectly.

## Verification and rollout

Apply tests should create an original inbound anchor plus 200 newer same-thread records, reopen file-backed stores and exercise complete reminder preflight through adapter resolution and controlled submission. Also cover a newer all-outbound suffix, explicit outbound-anchor behavior, implicit latest-anchor regression, missing/cross-owner/cross-thread and unusable wire IDs, allowlist revocation, stable operation identity and duplicate/uncertain suppression when completion persistence fails. Update the operator expiry paragraphs and related API comments to describe retained durable anchors. No migration, automatic re-enable or compatibility layer is introduced.

## Batch review dispositions

Adopted the final review's usability blocker by specifying a shared durable eligibility resolver, since message existence cannot validate wire threading. Add a complete reminder test showing an unthreadable retained anchor is disabled/review-required without generation or SMTP on later ticks. Adopted the store-level metadata method recommendation to avoid whole-thread copies and owner-wide fallback. Adopted the outbound-anchor normative scenario suggestion.
