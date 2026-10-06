# Design: make-skill-staging-agent-portable

## Context

See proposal.md for motivation. Current-state facts this design consumes (verified in the working tree):

- **Token surface.** `prompts/system_reply.md`, `system_spontaneous.md`, `system_self_research.md`, `system_summary.md`, `system_memory_maintenance.md` render `--session-id {{ sessionId || "$SESSION_ID" }}`; `system_summary.md` additionally renders `{{ tmpDir || "$TMPDIR/$SESSION_ID" }}/summary.md` twice. The staging-block fragment (`Your payload staging directory ... is {{ tmpDir }}`) already exists in the first four plus maintenance, but is wrapped in `{{ if tmpDir }}` with a token fallback outside it, and `system_self_research.md` never receives `tmpDir` at all.
- **Render call sites.** `ContextAssembler.renderFullPrompt()` (normal message) already builds `tmpDir = {workspace.tmpPath}/{sessionId}` + `sessionId`; `assembleContext()` and `assembleSpontaneousContext()` accept `_sessionId` but DROP it from `templateVars` (the system-prompt render on those paths has no session identity — the message flow works today only because `renderFullPrompt` re-renders `system_reply.md`). Orchestrator-side renders — `buildSpontaneousPrompt` (passes `sessionId`+`tmpDir`), `buildSelfResearchPrompt` (passes `sessionId`, NO `tmpDir`), `buildMemoryMaintenancePrompt` (passes both), the summary render (passes both), and every `RetryPromptContext` construction (passes `sharedProcess`, `sessionId`, `stagingDir`) — are already literal-fed except the assembler gaps and the retry builder.
- **Retry text.** `agent-factory.ts` `buildDefaultRetryMessage(stagingDir, sessionId, ...)` uses `stagingDir ?? "$TMPDIR/$SESSION_ID"` and `sessionId ?? "$SESSION_ID"`: literals only when the caller provided them (pooled), tokens in per-spawn. The orchestrator already computes literal `sessionId`/`stagingDir` for `RetryPromptContext` on every retry call site (message, spontaneous, self-research, reminder, reconnect paths).
- **Skill instruction files.** Token-bearing payload recipes in `skills/send-reply`, `edit-reply`, `send-file`, `memory-save`, `memory-search`, `fetch-context`, `set-reminder` `SKILL.md` (staging path, flag table "must be under `$TMPDIR/$SESSION_ID/`", error-code text); token-bearing `--session-id "$SESSION_ID"` usage in those plus `react-message`, `get-message`, `cancel-reminder`, `list-reminders`, `memory-export`, `memory-patch`, `memory-stats` `SKILL.md`; token-bearing example strings in `skills/{send-reply,edit-reply,memory-save,memory-search,fetch-context,set-reminder,send-file}/scripts/*.ts` and the `twoStepGuidance`/`outOfBoundsMessage`/`notFoundMessage` text in `skills/lib/payload.ts`.
- **Runtime resolution (unchanged).** `skills/lib/payload.ts` `resolvePayloadBase()`: shared mode resolves staging ONLY from the `active.json` pointer (row-10 pointer mechanism); per-spawn mode uses `{cwd}/tmp/{sessionId}` with the CLI id; the process `TMPDIR` is never consulted. Because bash expands `"$TMPDIR/$SESSION_ID/reply.md"` inside double quotes before the script sees it, the script-side "legacy expansion" is exactly this expanded-path resolution plus the ACP-side `resolveSessionPath()` token expansion (row 2/4-owned) — both stay byte-identical.
- **Row 9/10/4 invariants.** Process `TMPDIR`/state roots are mode/channel-scoped and deliberately distinct from the canonical staging root `{session workspace}/tmp/{skillSessionId}` (row 9); pooled processes carry `SKILL_SHARED_PROCESS=1` and NO frozen `SESSION_ID` (row 10); row 4 authorizes restricted structured writes to that canonical staging root whether the path arrives literal or token-expanded. This change makes every prompt hand the agent the literal form, so structured tools receive absolute literal paths and the token path becomes a legacy-compat route only.

## Goals / Non-Goals

**Goals:**
- Literal session id + absolute canonical staging directory in the rendered output of every payload-staging prompt (system templates, retry text), per-spawn and pooled, OpenCode and OMP.
- Skill instruction files and script error/example text teach absolute-literal staging anchored on the system-prompt rendering.
- Pinned backward-compat: existing OpenCode token-path callers (`"$TMPDIR/$SESSION_ID/x.md"` expanded by bash, structured-tool token paths expanded by the gate) keep resolving identically, with tests.
- End-to-end mocked delivery through the real Skill API/reply-handler with a mock platform: staging file → `send-reply` works in per-spawn AND pooled shapes with exactly one intended response and no duplicate retry/fallback delivery.

**Non-Goals:**
- Payload containment/security semantics, canonical-root observation, protected IO, or the ACP-side `resolveSessionPath()` expansion implementation (rows 2/3/4 own these; consumed unchanged, read-only-compat tests only).
- Staging relocation, provisioning changes, or mode roots (row 9 landed; row 4 surfaces unprovisioned staging).
- Pool identity, mode state, pointer mechanism, `SKILL_SHARED_PROCESS` semantics (row 10 landed; this change only documents/tests the consumer consequence).
- Reply quota, retry attempt limits, doom-loop policy, Skill API authority (existing `skills-and-reply` requirements unchanged — only the retry prompt's PATH FORM changes).
- Network/search (17–19), packaging (20), combined final regression pass (22).

## Decisions

### D1. Literal-first everywhere; fallback removed from templates, not just pooled

`{{ sessionId || "$SESSION_ID" }}` and `{{ tmpDir || "$TMPDIR/$SESSION_ID" }}` become `{{ sessionId }}` / `{{ tmpDir }}` inside the payload-staging blocks, and the call sites make the pair non-optional inputs of those renders (types stay optional on `TemplateVariables` — operator-mounted legacy templates must still render — but every bundled render passes values). Alternative considered: keep the fallback for per-spawn; rejected — it is the exact shape that silently produces token instructions the pooled process cannot honor, and design §11 requires literals in *every* relevant prompt. The `agent_permissions.md` mention of `$TMPDIR` as an allowed-write zone stays: it describes the permission gate's expansion capability (row-2/4 behavior), not an instruction to stage there; the staging instruction block will name the absolute directory.

### D2. One staging-path helper for render inputs, no new resolution authority

The call sites already compute `{workspace.tmpPath}/{shellSessionId}` at six-plus places (retry contexts, summary, maintenance, spontaneous). Implementation extracts the existing pattern into one small internal helper (e.g. `sessionStagingDir(workspace, shellSessionId)` in `src/core/`) used by every render/retry-context construction, so per-spawn and pooled feeds cannot drift. It performs no resolution of its own — pure string composition of values the orchestrator already owns — so it does not become a second `resolveSessionPath`. The canonical form remains `{session workspace}/tmp/{literalSkillSessionId}`, matching the row-4 staging role and the row-9 payload-staging-vs-process-TMPDIR separation.

### D3. Retry strategy becomes context-mandatory

`RetryPromptContext` gains required `sessionId: string` and `stagingDir: string` (the orchestrator already has both at every construction site) and `buildDefaultRetryMessage` drops the `?? "$TMPDIR/$SESSION_ID"` fallbacks and the pooled-only "SESSION_ID env not set" note (reworded to a spawn-shape-neutral sentence pointing at the system-prompt rendering). `getRetryPromptStrategy` requires the context; token-shaped calls become a compile error rather than a silent fallback. Alternative: keep optional context and emit tokens when absent — rejected per D1 and because tests must be able to assert "no unexpanded tokens" unconditionally.

### D4. `skills/lib/payload.ts` is a read-only-compat extension: documentation + tests, zero behavior change

Design §11 says keep legacy expansion for existing OpenCode callers. Script-side, "legacy expansion" = the shell-expanded token path arriving as an ordinary absolute/relative path (`resolvePayloadBase` per-spawn branch + pointer branch — unchanged) and the guidance text. Implementation adds: (a) header/doc-comment rewrite stating the literal-first prompt contract and the pinned legacy behavior; (b) `twoStepGuidance`/`outOfBoundsMessage`/`notFoundMessage` re-anchored to "the staging directory rendered in your system prompt" while still naming the concrete enforced base `{base}` (the base is already interpolated; only the `$TMPDIR/$SESSION_ID` parenthetical goes); (c) no change to `resolvePayloadBase`/`resolvePayloadPath`/containment logic. The ACP-side `ChatbotClient.resolveSessionPath()` token expansion is row 4's surface — untouched here, pinned by a compat test only.

### D5. SKILL.md rewrite pattern

Every token recipe becomes: "Write the text to `{staging-dir}/{name}.md` inside the payload staging directory shown in your system prompt (an absolute path), then invoke the script with the payload-file flag pointing at that absolute path and `--session-id <id>` exactly as rendered." Examples keep `${HOME}` (the skill-install root token is unrelated to staging and still expands in shell) but stage paths become `<ABSOLUTE_STAGING_DIR>/reply.md`-style placeholders with a note that the system prompt names the real directory. The session-id parameter note collapses to: "pass the literal session id rendered in your system prompt; never `$SESSION_ID` — it is absent (pooled) or unreliable to depend on." Legacy flag warnings, error-code tables, and reply-quota text keep their substance with paths re-anchored. Enumerated files: `send-reply`, `edit-reply`, `send-file`, `memory-save`, `memory-search`, `fetch-context`, `set-reminder` (payload recipes + error text); `react-message`, `get-message`, `cancel-reminder`, `list-reminders`, `memory-export`, `memory-patch`, `memory-stats` (session-id usage text only). The `send-reply`/`react-message`/`send-file` SKILL.md files are embedded verbatim into the retry prompt, so their rewrite is part of the retry's no-token guarantee.

### D6. Acceptance is consumer-visible: rendered strings + real script/library + mock platform

- **Prompt-render unit tests**: render each bundled template through the real engine with real orchestrator/assembler inputs; assert literal id + absolute dir present, and regex-assert no `$TMPDIR`/`$SESSION_ID` inside staging/session-id instruction lines. Not source-text snapshots — tests invoke `renderTemplate`/`loadSystemPrompt`.
- **Retry unit tests**: `getRetryPromptStrategy(type, rejections, ctx)` in both spawn shapes: literals present, no tokens, SKILL.md bodies embedded.
- **payload.ts compat tests**: per-spawn expanded path resolves + reads + deletes as today; pointer-only shared-mode precedence and `SKILL_SESSION_UNRESOLVED` unchanged; symlink-escape/sibling-prefix rejection unchanged (extend existing suite; the existing tests are the compat oracle).
- **End-to-end mocked delivery**: temp-filesystem staging + the REAL `send-reply` script payload contract and the REAL Skill API handler + reply-handler (existing mock-platform harness pattern) in per-spawn env (no `SKILL_SHARED_PROCESS`, `--session-id` literal) and pooled env (`SKILL_SHARED_PROCESS=1`, pointer, `SKILL_JWT_DIR`, no `SESSION_ID` env): staging file → handler → mock platform records exactly one intended reply, retry policy records no duplicate/fallback delivery. Design §14 reply-flow row.
- Docs: `AGENTS.md` §4 payload-file note updated to literal-first with the compat sentence, `docs/AGENT_PERMISSIONS.md` token note marked legacy-compat, `CHANGELOG.md` entry.

## Risks / Trade-offs

- [Operator-mounted legacy templates still contain `{{ sessionId || "$SESSION_ID" }}`] → bundled templates drop it; `TemplateVariables` fields stay optional so such mounts render unchanged and keep working through the unchanged legacy expansion; documented in CHANGELOG as deprecated form.
- [Agent ignores the rendered absolute path and types a token anyway] → fully functional compat route (gate expansion + pointer/CLI resolution) is pinned by tests, so this degrades to today's behavior, never a wrong-directory write.
- [Six-plus render/retry call sites drift] → D2's single composition helper + render-output tests covering every enumerated session type.
- [SKILL.md rewrite churns the embedded retry body] → intended; retry no-token test asserts it. Keep quota/warning semantics byte-stable where possible so existing reply-policy tests need no edit.
- [Shared-file churn with rows 4/10/13 in `session-orchestrator.ts`] → edits confined to variable-injection call sites; no control-flow change; serialized apply order noted in the proposal's batch contract.

## Migration Plan

Pure instruction-surface change: deploy = ship templates + orchestrator/factory edits + SKILL.md + docs together (no config, no state migration). Rollback = revert commit; legacy token behavior was never removed, so no data/session state depends on the new form. Staging provisioning, pointer files, and JWT issuance untouched.

## Open Questions

None. (Whether `prompts/system_reminder.md`/channel-lurk text names staging at all is an implementation-time detail resolved by grep at task 2.1 — it cannot change the spec, which enumerates the behavior for every payload-staging path.)
