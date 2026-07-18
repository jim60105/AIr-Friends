## Why

Security audit run-2 (finding F16, LOW) found a residual of run-1's F3. Self-research is the *one* session type authorized to write shared agent-workspace notes (`session-orchestrator.ts:1337` sets `canWriteAgentWorkspace: true`) and is also the *one* session type that ingests external RSS content. `buildSelfResearchPrompt` interpolates the RSS `title`/`sourceName`/`url`/`description` **verbatim** into the prompt's Reference Materials block (`session-orchestrator.ts:2788-2791`); `rss-fetcher.ts` only strips XML tags and truncates — no prompt-injection handling. The resulting workspace write is then auto-approved with no content inspection. So attacker-influenced feed content can be laundered into shared notes that later reach other users. F3 gated the write by session *type* but not by content *provenance*, and the one authorized writer is exactly the one consuming untrusted external content.

Severity is LOW and this change is scoped to match: self-research is disabled by default with placeholder feeds, the prompt already frames RSS as third-party "articles," `send-reply` is forbidden in research sessions, and any injected instruction must survive two lossy LLM hops (an LLM-authored note, then re-selection by a later session) before reaching a user. The fix is a cheap, high-leverage hardening, not a rearchitecture.

## What Changes

- **Delimit RSS content as explicitly untrusted in the self-research prompt.** Wrap each interpolated item in unambiguous untrusted-content markers with an instruction not to follow directives contained within, so the model treats feed text as third-party data rather than as prompt instructions — instead of the current bare numbered markdown interpolation.
- **(Documented, optional follow-on)** Provenance-tag notes that a self-research session derived from external feed content, and consider requiring operator review before such notes become readable by user-facing sessions — addressing the sink (shared notes reaching other users) rather than only the source. Deferred as optional given the LOW severity and its overlap with F3's already-shipped agent-workspace write-gate.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `self-research`: the research prompt SHALL delimit interpolated RSS/feed content with explicit untrusted-content markers instructing the model not to follow any instructions contained within it.

## Impact

- **Code:** `src/core/session-orchestrator.ts` (`buildSelfResearchPrompt` RSS interpolation → delimited untrusted block); optionally `prompts/system_self_research.md` (reinforce the untrusted framing around `{{ rssItems }}`).
- **Docs:** self-research prompt/behavior notes.
- **Tests:** the assembled self-research prompt wraps each RSS item in the untrusted-content delimiters with the do-not-follow instruction.
- **Cross-reference:** this is the content-provenance complement to run-1's F3 (session-type write-gate) and is related to F15 (the other shared-store write path); the shared sink — untrusted content reaching other users via a shared store — is common to all three.
