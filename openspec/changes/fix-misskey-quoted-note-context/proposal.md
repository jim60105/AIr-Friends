## Why

Misskey quote-renotes currently reach the agent with only the quoting user's comment, even when the platform supplies the complete source note. The confirmed question about a quoted WWII unexploded-ordnance article lost its referent, so the agent asked what the user meant; preserving the source also requires explicit separation from direct user instructions.

## What Changes

- Add an optional, typed one-hop `quotedNote` reference to normalized events and history messages, preserving source identity, original author, source URL, text and attachment metadata separately from the outer message.
- Extract embedded source data first. Resolve missing embedded sources only through the configured Misskey instance's `notes/show`, with a five-second operation deadline, one attempt per distinct source and nonfatal unavailable-reference results.
- Preserve the reference through trigger projection, both trigger-formatting paths, recent/related history, spontaneous history and `fetch-context` message results.
- Render source data inside an attributed third-party reference boundary that says quoted commands are not direct user instructions. Encode untrusted fields so they cannot create renderer-owned heading, role or closing-boundary lines.
- Charge the complete rendered reference to token estimates and conversation admission. Quoted attachments remain attributed URL/metadata references, including on triggers; existing outer-trigger image handling is unchanged.
- Add deterministic regressions and update existing platform/skill documentation plus the changelog during implementation. This proposal makes no application-code edits.

## Capabilities

### New Capabilities

None. Quote support extends existing platform and context contracts.

### Modified Capabilities

- `platform-abstraction`: Optional quote data on `NormalizedEvent` and `PlatformMessage`, one-hop Misskey extraction and bounded resolution, with unchanged outer identity and threading.
- `context-assembly`: Third-party reference rendering across trigger and history paths, boundary encoding and quote-aware token budgeting.
- `multimedia-messages`: Quoted attachment ownership and URL-only treatment while preserving outer-trigger capability, size, timeout and SSRF safeguards.
- `skills-and-reply`: `fetch-context` preserves the same typed third-party reference in recent/search message results.

## Impact

Implementation is confined to `src/types/events.ts`, `src/platforms/misskey/misskey-utils.ts`, `misskey-adapter.ts` and the narrowly scoped abortable-request support in `misskey-client.ts`; `src/core/context-assembler.ts`; and, only if forwarding requires adjustment, `src/skills/context-handler.ts`/`types.ts`. Extend existing tests under `tests/platforms/misskey/`, `tests/core/context-assembler.test.ts`, `tests/core/session-orchestrator.test.ts` and `tests/skills/context-handler.test.ts`. Reuse fixtures and existing attachment mapping rather than duplicating conversion.

Implementation documentation belongs in `docs/PLATFORM_INTEGRATION.md`, `docs/SKILLS_IMPLEMENTATION.md`, `skills/fetch-context/SKILL.md` and `CHANGELOG.md`. No deployment setting, environment variable, dependency upgrade, persistence schema, compatibility layer or migration is introduced. Reply policy, source-user workspace ownership, reply threading, pure-renote eligibility, public/private visibility, Discord and Misskey chat behavior remain unchanged. No article fetching, recursive quote expansion, automatic summarization, new image-download path, retry mechanism or telemetry subsystem is included.

## Workday Scope

One cohesive change has an eight-hour implementation ceiling. Allocate 1.75 hours to the shared types/extraction and abortable bounded resolver; 1.75 hours to rendering/projection/token accounting; 2.25 hours to deterministic conversion/adapter/context/skill and attachment regressions; 0.50 hours to documentation; and 1.75 hours to focused checks, review fixes and contingency. The conservative one-hop and URL-only attachment choices avoid a separate multimodal pipeline change.

## Batch:

```text
depends-on: none
```

There is no semantic dependency on any active OMP change and no new application gate inherited from that batch. The following conflicts concern integration ordering only. Serialize shared-file edits under the apply integration owner, preserving both changes' contracts.

| Active change(s) | Dependency | Conflict and resolution |
| --- | --- | --- |
| `make-skill-staging-agent-portable` | None | Same `src/core/context-assembler.ts`, its tests and `skills/fetch-context/SKILL.md`; staging-variable/CLI guidance edits are disjoint from quote projection/rendering and response-shape docs. Serialize application and retain both. |
| `finish-omp-mocked-skill-handoff` | None | Same `skills-and-reply` capability with disjoint ADDED requirement names, plus shared changelog. Preserve its OMP handoff and final-batch audit scope; append this independent quote entry without claiming it is an OMP batch row. |
| `cover-omp-mocked-acp-lifecycle` | None | Possible deletion-only edits to existing `tests/core/` assertions. Quote regressions are independently owned and must not be removed as redundant OMP lifecycle coverage. No production overlap. |
| All 24 active OMP changes listed before this proposal | None | Most share `CHANGELOG.md` during implementation. Serialize append integration. No active proposal owns Misskey conversion/client or event quote fields, or modifies `platform-abstraction`, `context-assembly` or `multimedia-messages`. |

`src/core/session-orchestrator.ts` is read-only for this change; its image selection already reads only outer `event.attachments`. OMP changes to its acquisition, readiness, recovery and staging call sites therefore have no production code conflict with this proposal. The existing orchestrator test file can have disjoint test additions; integrate additively. Archived changes are baseline history, not active dependencies.
