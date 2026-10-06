# Proposal: make-skill-staging-agent-portable

## Why

The payload-file contract currently tells agents to stage skill payloads at `$TMPDIR/$SESSION_ID/...` and to pass `--session-id "$SESSION_ID"` (approved design §11, §10 step 7). Those shell tokens only work when the subprocess environment freezes a per-session `SESSION_ID`/staging `TMPDIR` — the per-spawn OpenCode shape. OMP pooled processes must NOT freeze a per-process `SESSION_ID` (row-10 invariant, `SKILL_SHARED_PROCESS=1`) and the process `TMPDIR` is mode/channel state that row 9 deliberately keeps distinct from the canonical payload staging root, so on a pooled process the tokens are stale or expand to the wrong directory, and structured ACP file tools receive token paths instead of the literal paths the row-4 authorization decides on. Every prompt that instructs payload staging — including the missing-reply retry — must instead supply the literal active Skill API session ID and the absolute canonical staging directory, so the same agent-portable instruction works in per-spawn AND pooled shapes for both agents.

## What Changes

- Every relevant prompt surface — normal message, spontaneous post, channel lurk, self-research, conversation summary, memory maintenance (workspace and channel), AND the missing-reply retry prompt — renders the literal active Skill API session ID and the absolute session staging directory (`{session workspace}/tmp/{literalSkillSessionId}`, the canonical payload staging location row 9 keeps independent of process TMPDIR). Payload-file guidance in those prompts instructs the agent to write and reference ABSOLUTE literal paths, never `$TMPDIR`/`$SESSION_ID` tokens, in structured file-tool calls and payload-file flags (`--message-file`/`--content-file`/`--query-file`/`--caption-file`).
- Remove the `"$SESSION_ID"` fallback defaults from the Vento templates (`{{ sessionId || "$SESSION_ID" }}`, `{{ tmpDir || "$TMPDIR/$SESSION_ID" }}`): the render call sites make the two variables mandatory on every payload-staging prompt path, closing the gaps where self-research rendered no `tmpDir` and the normal/spontaneous assembler paths dropped the session variables entirely.
- Retry strategy in `src/acp/agent-factory.ts` becomes literal-first in BOTH spawn shapes: `RetryPromptContext` carries the literal session id and absolute staging directory always, and the built retry text contains no unexpanded tokens in its file-tool/flag instructions (replacing today's tokens-for-per-spawn / literals-only-when-pooled split).
- All skill instruction files (`skills/*/SKILL.md`) and the token-bearing error/example strings in `skills/*/scripts/*.ts` switch from token paths to absolute-literal guidance anchored on "the staging directory and session id rendered in your system prompt" — enumerated: send-reply, edit-reply, send-file (caption), memory-save (content), memory-search + fetch-context (query), set-reminder (message) payload recipes, plus the session-id-only usage text in react-message, get-message, cancel-reminder, list-reminders, memory-export, memory-patch, memory-stats.
- `skills/lib/payload.ts` KEEPS its legacy resolution behavior unchanged: per-spawn callers that still pass shell-expanded token paths, the shared-process `active.json` pointer precedence, and the symlink-aware session-scoped containment all keep working for existing OpenCode callers (backward-compat requirement). No containment/security semantics change (rows 2/3/4 own those).
- Shared-process consumer documentation and tests updated from the row-10 invariant: pooled skills receive the literal `--session-id` and canonical absolute payload path per prompt; no consumer may depend on a frozen process `SESSION_ID`.

No new configuration/environment/helm field is introduced; `config.example.yaml`, `.env.example` and `helm/values.yaml` remain unchanged.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `prompt-template-system`: the session-id/staging template variables become mandatory, literal-valued render inputs on every payload-staging prompt path, and `sessionId`/`tmpDir` are formally documented as core template variables (closing the gap that the core variable table omits them).
- `skills-and-reply`: skill payload recipes and usage instructions are agent-portable (absolute literal staging paths + literal session id, no shell tokens), the missing-reply retry prompt is literal-first in every spawn shape, and the payload helper's legacy token-path support is a pinned compatibility requirement.
- `shared-acp-process-pool`: the shared-process environment requirement states the no-frozen-`SESSION_ID` invariant and the per-prompt literal identity/staging delivery that replaces it for skill consumers.

## Impact

Eventual implementation owns: `prompts/system_reply.md`, `system_spontaneous.md`, `system_self_research.md`, `system_summary.md`, `system_memory_maintenance.md` (and the channel-lurk/reminder templates only if their rendered text names session identity or staging); render call sites in `src/core/context-assembler.ts` and `src/core/session-orchestrator.ts` confined to making `sessionId`/`tmpDir` variables mandatory (no flow/policy change — shared files with rows 4/10/13, coordinate by variable injection only); `RetryPromptContext`/`buildDefaultRetryMessage`/`getRetryPromptStrategy` in `src/acp/agent-factory.ts`; instruction text in `skills/*/SKILL.md` and error/example strings in `skills/*/scripts/*.ts`; compatibility-preserving tests plus new prompt-render and payload-consumer tests; `skills/lib/client.ts`/`payload.ts` doc comments stating the literal-first contract with unchanged behavior; `AGENTS.md` §4 payload-file note, `docs/AGENT_PERMISSIONS.md` token-expansion note, and `CHANGELOG.md`.

Consumes unchanged: row 4's staging-root authorization (`{cwd}/tmp/{shellSessionId}` as the authorized restricted write target), row 9's process-state-vs-payload-staging separation and staging provisioning, row 10's `SKILL_SHARED_PROCESS=1`/no-frozen-`SESSION_ID` invariant and pointer mechanism. Non-goals owned elsewhere: payload containment/security semantics and the canonical expansion implementation (rows 2/3/4 — consumed, not modified; `resolveSessionPath` token expansion stays); pool identity and mode state (rows 9/10, landed); reply quota/retry POLICY and Skill API authority (existing `skills-and-reply` reply-limit/retry requirements unchanged); network/search (rows 17–19); packaging (row 20); the combined final regression/docs pass (row 22 may extend but not re-do these cases).

## Workday Budget

Total ≤ 8.00h: template + render call-site edits 1.50h; retry-strategy literal-first change 0.50h; SKILL.md/script instruction text sweep across the 15 enumerated skills 1.50h; prompt-render unit tests + payload.ts legacy-compat tests 1.50h; end-to-end mocked per-spawn + pooled delivery test 1.50h; docs (SKILL.md/AGENTS.md §4/CHANGELOG) + full check suite 1.00h + 0.50h reserved contingency. No live agents, platform delivery, container/bwrap, or network; deterministic mocks only.

## Batch

depends-on: enforce-acp-filesystem-authorization
depends-on: spawn-mode-scoped-omp-agents
depends-on: isolate-omp-process-pools-by-mode

- This is batch row 16 (P6). Apply only after rows 4, 9, 10 — the staging-root authorization, process-state distinctness, and pooled no-frozen-`SESSION_ID` invariants it consumes are theirs.
- `skills/*/SKILL.md`: first and only batch-wide edit of these files; no batch-external conflict.
- `prompts/*.md`: only this change edits the system templates.
- `src/core/session-orchestrator.ts`: edits confined to `sessionId`/`tmpDir` variable injection at prompt-render/retry call sites; shared with rows 4 (gate-context registration), 10 (mode resolution before acquisition), 13 (readiness gate) — same file, disjoint call sites, serialize apply order; downstream rows (11/22) consume, not edit.
- `src/acp/agent-factory.ts`: only `RetryPromptContext`/retry-text surfaces edited here; rows 9/15 own launch/env/LSP surfaces — disjoint.
- `src/acp/client.ts`: NOT edited by this change (row 4 owns the sink/expansion cutover; this change pins its legacy behavior via tests only).
- `CHANGELOG.md` / `docs/AGENT_PERMISSIONS.md`: serial-append shared with every row; apply per batch order.
