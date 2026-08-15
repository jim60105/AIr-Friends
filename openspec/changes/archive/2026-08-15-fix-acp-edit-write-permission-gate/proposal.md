# Proposal: Fix ACP Edit/Write Permission Gate

## Why

OpenCode v1.17.13 (PR #34079 "enrich permission prompts", released 2026-07-01) changed the ACP `requestPermission()` request shape: edit/write tool requests now carry `title` = the target **file path** and `kind` = `"edit"`, instead of the old `title` = permission name (`"edit"`). The permission gate in `src/acp/client.ts:1031` classifies edit/write requests only by legacy values (`title === "edit"`, `title === "edit_file"`, `kind === "write"` — the latter does not even exist in the ACP `ToolKind` vocabulary: `read | edit | delete | move | search | execute | think | fetch | switch_mode | other`). As a result, **every edit/write request in restricted mode is rejected as `Rejecting unknown tool call`**, even writes to the session TMPDIR that the F3 write-gating was designed to auto-approve.

This breaks the payload-file contract (`$TMPDIR/$SESSION_ID/{name}.md` staging) that `send-reply`, `memory-save`, `memory-search`, `send-file` captions, and all other communication skills depend on. The Agent cannot stage its reply text, cannot call `send-reply --message-file`, the missing-reply retry also fails, and the session ends in failure with no user-facing reply. Production log analysis (`tmp/export-8defa000383f0a2.clef`, session `sess_mss9gmv7`) shows the Agent correctly following the documented pattern — writing `$TMPDIR/$SESSION_ID/reply.md` — and being rejected twice, then giving up.

The regression is silent because: (a) tests mock request shapes that OpenCode never sends (`kind: "write"`, `title: "write_file"`, `title: "edit_file"`), and (b) the container image installs `releases/latest` OpenCode, so the upgrade happened without any contract pinning.

## What Changes

- **Fix edit/write classification in `requestPermission()`**: recognize edit/write requests by the ACP `kind === "edit"` (the kind OpenCode sends for `write`/`edit`/`apply_patch`/`patch` tools, per `toToolKind()`), while keeping legacy title checks (`"edit"`, `"edit_file"`, `"write"`, `"write_file"`) for older OpenCode versions and other ACP agents. Path extraction (from `locations` then `rawInput`) is unchanged and already handles both the `{filePath, content}` and `{filepath, diff}` shapes. Requests with `kind === "edit"` but no resolvable path still fail closed (rejected, never approved).
- **Update permission tests to the real OpenCode request shapes** (title = file path, `kind: "edit"`, both rawInput shapes) and add regression tests: TMPDIR payload write (`$TMPDIR/$SESSION_ID/reply.md`) approved; out-of-workspace write rejected; unresolvable-path edit/write rejected; unknown-tool rejection preserved for genuinely unknown calls.
- **Pin the OpenCode CLI version in the container** (`Containerfile` downloads a fixed `v1.17.13` artifact with per-arch SHA-256 checksum verification instead of `releases/latest`) and add a bootstrap compatibility check that logs a structured, greppable warning when the installed OpenCode version is below the known-good minimum or undeterminable, so future silent upgrades surface immediately.
- **Add rejection-reason feedback to the retry prompt**: `ChatbotClient` records recent permission-rejection reasons on EVERY denial path (per-session, bounded and truncated), and the missing-reply retry prompt includes them (e.g. `write $TMPDIR/$SESSION_ID/reply.md rejected: path outside workspace`) so the Agent can self-correct instead of guessing — ACP `RequestPermissionResponse` has no free-text message field, so the retry prompt is the only channel to explain rejections to the Agent. The records survive across the retry boundary (not cleared by the prompt-level `reset()`) and are cleared per logical session.
- **Docs**: update `AGENTS.md` / `docs/AGENT_PERMISSIONS.md` to document the real request shapes, the OpenCode version contract, and the `AGENT_OPENCODE_MIN_VERSION` env override (also surfaced in `config.example.yaml`, `.env.example`, and `helm/values.yaml`).

## Capabilities

### New Capabilities

- `agent-version-compatibility`: Pinning and runtime verification of the external ACP agent (OpenCode) version so that ACP contract changes surface at build/bootstrap time instead of silently degrading sessions.

### Modified Capabilities

- `acp-integration`: The **Permission Handling — Restricted Mode** requirement changes to classify edit/write requests by ACP `kind` (`"edit"`) rather than legacy title strings, so the scoped path validation (workspace/TMPDIR containment, `$TMPDIR`/`$SESSION_ID` token expansion, agent-workspace write-gating) actually runs for real OpenCode requests. The **Retry on Missing Reply** requirement changes so the retry prompt carries the session's recent permission-rejection reasons.

## Impact

- `src/acp/client.ts` — edit/write classification condition, per-session rejection-reason tracking (every denial path), exposure to retry flow
- `src/acp/agent-connector.ts` — clear rejection records per logical session (`createSession()`); `src/acp/agent-factory.ts` / `src/core/session-orchestrator.ts` — retry prompt enriched via a shared retry-prompt helper
- `Containerfile` — pinned OpenCode version with checksum verification; `src/bootstrap.ts` — version compatibility check
- `tests/acp/client.test.ts`, retry-flow tests in `tests/core/`, plus new bootstrap/version-check tests
- `config.example.yaml`, `.env.example`, `helm/values.yaml` — `AGENT_OPENCODE_MIN_VERSION` surfaced for deployment visibility
- `docs/AGENT_PERMISSIONS.md`, `AGENTS.md`, `openspec/specs/acp-integration/spec.md`, `openspec/specs/agent-version-compatibility/spec.md` (new)
- **No migration/backward-compat burden**: project is pre-release with zero users in the wild.
