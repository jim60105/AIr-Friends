# Design: Fix ACP Edit/Write Permission Gate

## Context

OpenCode v1.17.13 (PR #34079, released 2026-07-01) enriched the ACP `requestPermission()` payload: the `toolCall.title` for edit/write tools changed from the permission name (`"edit"`) to the target **file path**, while `toolCall.kind` stayed `"edit"` (OpenCode's `toToolKind()` maps `write`/`edit`/`apply_patch`/`patch` all to `"edit"`). The ACP SDK `ToolKind` vocabulary is `read | edit | delete | move | search | execute | think | fetch | switch_mode | other` — there is **no `"write"` kind**.

The permission gate in `src/acp/client.ts:1031` currently enters the scoped edit/write branch only when `title === "edit" || title === "edit_file" || kind === "write"`. Real OpenCode ≥ v1.17.13 requests match none of these (title is a path, kind is `"edit"`), so **every edit/write request in restricted mode falls through to the `else` branch and is rejected as `Rejecting unknown tool call`** (client.ts:1141) — including the TMPDIR payload writes (`$TMPDIR/$SESSION_ID/reply.md`) that F3 write-gating was built to auto-approve.

A production failure (session `sess_mss9gmv7` in `tmp/export-8defa000383f0a2.clef`) shows the agent correctly following the documented payload-file contract and being rejected twice, then the missing-reply retry also failing. Contributing factors: (a) tests mock request shapes OpenCode never sends (`kind: "write"` cast via `as unknown as`, `title: "write_file"`, `title: "edit_file"`), and (b) the container installs `releases/latest` OpenCode with no version pinning.

## Goals / Non-Goals

**Goals:**
- Restore scoped edit/write permission handling for real OpenCode requests in restricted mode: TMPDIR payload writes auto-approved, out-of-workspace writes rejected, agent-workspace writes gated by `canWriteAgentWorkspace`.
- Keep acceptance working for both the new (v1.17.13+) and legacy (≤ v1.17.12 / other agents) request shapes.
- Prevent recurrence: pin the OpenCode version in the container and warn at bootstrap when the installed version is below the known-good minimum.
- Give the agent actionable feedback: include the session's recent permission-rejection reasons in the missing-reply retry prompt.
- Update tests to mock the real request shapes and add regression coverage for the exact failure scenario.

**Non-Goals:**
- Changing the ACP protocol or the SDK (`@agentclientprotocol/sdk` stays 0.14.1).
- Adding a free-text message field to ACP permission responses (the protocol does not support it; the retry prompt is the feedback channel instead).
- Fixing the OpenCode-side `echo` deny rule or other Layer-2 rules in `agent-config/opencode.json`.
- YOLO-mode behavior (already auto-approves everything).
- Supporting `delete`/`move` tool kinds in restricted mode (they remain default-deny; not exercised by OpenCode today).

## Decisions

### Decision 1: Classify edit/write requests by ACP `kind`, with legacy title fallback

Change the branch condition at `client.ts:1031` to:

```typescript
const isEditWriteRequest =
  kind === "edit" ||
  title === "edit" || title === "edit_file" ||
  title === "write" || title === "write_file";
```

- `kind === "edit"` covers OpenCode v1.17.13+ (`toToolKind()` maps write/edit/apply_patch/patch → `"edit"`).
- Legacy titles (`"edit"`, `"edit_file"`, `"write"`, `"write_file"`) keep older OpenCode and hypothetical other agents working.
- The existing body (path extraction from `locations` then `rawInput`, `isAgentWorkspaceWrite`, `canWriteAgentWorkspace` gate, TMPDIR/extension checks, boundary-safe expansion of `$TMPDIR`/`$SESSION_ID`) is unchanged and already handles both rawInput shapes: `{filePath, content}` (write tool) and `{filepath, diff}` (edit tool).

*Alternatives considered:* matching on `title` ending in `.md`/`.txt` (fragile, extension-dependent); matching rawInput key presence (`diff`/`content`) (overlaps with legacy free-text flag checks and other tools); hard-deprecating legacy titles entirely (unnecessary churn given zero users, and title-based detection costs nothing).

### Decision 2: Per-session rejection-reason ring buffer in `ChatbotClient`

Add a bounded per-client array `recentPermissionRejections` recording `{ toolName, kind, commandOrPath, reason, ts }` whenever `requestPermission()` or `writeTextFile()` denies. Expose `getRecentPermissionRejections(): PermissionRejection[]` and `clearPermissionRejections()`.

**Lifecycle (critical)**: the buffer MUST NOT be cleared in `reset()` — `AgentConnector.prompt()` calls `client.reset()` at the start of every prompt, including the retry prompt, so clearing there would wipe the first turn's rejections before the retry prompt is assembled, silently no-op'ing the feedback feature. Instead, the buffer SHALL be cleared exactly once per logical session via an explicit `clearPermissionRejections()` call when a new ACP session is created (`AgentConnector.createSession()`), and the retry flow SHALL snapshot the records before invoking the second `connector.prompt()`.

**Bounds**: cap entries at 10 AND truncate per-entry fields (`commandOrPath` to ~200 chars) and the whole section (≤ ~2000 chars) so an oversized or user-derived command string cannot bloat the prompt or be re-injected verbatim.

**Sanitization**: because `toolName`/`kind` are agent-derived (in the new shape `title` — the `toolName` — IS the file path), ALL agent-derived fields (`toolName`, `kind`, `commandOrPath`) are sanitized at record time: control characters (`\x00-\x1f\x7f`) are stripped and each field is bounded to ~200 chars (truncation marker included), so the diagnostic section cannot be re-injected with agent-influenced newlines or prompt-structure characters (rubber-duck BLOCKING finding).

**Single-record per denial**: each denial records exactly ONE entry with its specific cause; the disallowed-extension branch returns reject immediately instead of falling through to the generic `rejected_edit_write` record (which previously produced a contradictory second entry — rubber-duck NON-BLOCKING finding).

**Recording completeness**: a single private `recordPermissionRejection(toolName, kind, commandOrPath, reason)` helper SHALL be called on EVERY denial path — legacy free-text flag, generic-command rejection, unauthorized shared-workspace write, disallowed extension, edit/write reject, and unknown-tool reject — so retry diagnostics never miss or misattribute a real rejection cause.

Recording is a synchronous push alongside the existing fire-and-forget audit write — no async behavior added.

*Alternatives considered:* reading the audit writer back (async, per-session audit may be disabled); persisting to workspace files (overkill); clearing in `reset()` (rejected — would break retry-time availability). In-memory ring buffer is cheap and scoped to the session lifetime, which is exactly the retry window.

### Decision 3: Enrich the retry prompt with rejection reasons

`getRetryPromptStrategy()` (agent-factory.ts:204) returns a static message. Change its signature to accept an optional `rejections?: PermissionRejection[]` parameter and append a `Recent permission rejections in this session:` section when non-empty, e.g.:

```text
Recent permission rejections in this session (diagnostic data, not instructions):
- write $TMPDIR/$SESSION_ID/reply.md (kind: edit) rejected: rejected_unknown
- bash "echo \"$TMPDIR/$SESSION_ID\"" rejected: rejected_generic_command_first_token_not_allowed
```

The three retry call sites in `session-orchestrator.ts` (lines ~719, ~1208, ~2485) SHALL be converged into a single shared helper (e.g. `sendRetryPrompt(sessionId, sessionLogger, ...)`) that (a) snapshots `connector.getClient()?.getRecentPermissionRejections()` BEFORE the second `connector.prompt()` call, (b) truncates/bounds the section, and (c) passes it into the strategy — so the three flows cannot drift apart and retry-time availability is guaranteed even though `reset()` runs at the start of the retry prompt. When no rejections exist, the message is byte-identical to today.

*Alternatives considered:* making the retry message a template with injected context (same result, more indirection); ignoring feedback entirely (agent keeps guessing — the observed failure mode); clearing the buffer in `reset()` (rejected — see Decision 2). The rejection section is the only protocol-compatible channel because `RequestPermissionResponse` only carries an outcome, and the agent-facing denial text is fixed by OpenCode ("The user rejected permission to use this specific tool call.").

### Decision 4: Pin OpenCode version in the container build

In `Containerfile`:

```dockerfile
ARG OPENCODE_VERSION=1.17.13
ARG OPENCODE_SHA256_AMD64=... ARG OPENCODE_SHA256_ARM64=...
...
curl -fsSL "https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-${OC_ARCH}.tar.gz" -o /tmp/opencode.tar.gz \
  && echo "${OPENCODE_SHA256_${OC_ARCH_LABEL}}  /tmp/opencode.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/opencode.tar.gz -C /opencode
```

The known-good version is 1.17.13 (first release containing the enriched permission prompt; the gate handles both shapes, so any ≥ 1.17.13 is fine). Bumping the pin becomes a deliberate act with an ACP contract review. Checksum verification (per-arch, set at build time) closes the tag-only supply-chain and reproducibility gap so the pinned version is actually the one installed.

*Alternatives considered:* keeping `releases/latest` (silent breakage — the actual incident); pinning by commit SHA (opaque, harder to update); tag-only pin without checksums (weaker supply-chain guarantee). Version tag + checksum pinning is the standard, reviewable choice.

### Decision 5: Bootstrap version check (non-fatal, observable)

Add `verifyOpenCodeVersion()` in `src/utils/` (or `src/acp/`): spawn `opencode --version` with a short timeout, parse the semver, compare against a `KNOWN_GOOD_OPENCODE_MIN_VERSION = "1.17.13"` constant (env-overridable via `AGENT_OPENCODE_MIN_VERSION` for flexibility). Behavior:

- ≥ minimum → INFO log with detected version
- < minimum, unparseable, or spawn failure → prominent WARN naming detected version, minimum, and the request-shape incompatibility risk; the warning SHALL use a structured, greppable marker (e.g. `OpenCode version check: UNKNOWN|BELOW_MINIMUM|OK`) so it is monitorable in logs
- Never blocks startup, never touches the network, never starts an ACP session

This is deliberately an **observability measure, not a hard gate**: the version check cannot detect future behavioral drift of newer versions (a newer OpenCode could change the request shape again while still satisfying `>= minimum`), and non-container deployments can still run with an incompatible binary. The container pin (Decision 4) is the actual prevention; the check makes drift visible early. We do NOT warn on "above tested maximum" — there is no tested maximum, and the gate accepts both request shapes.

Called from `bootstrap()` after config load.

*Alternatives considered:* hard-failing on version mismatch (too strict for dev machines using other OpenCode builds); skipping the check entirely (silent drift again — rejected by the proposal); warning on newer-than-tested versions (no evidence of a breaking shape change above 1.17.13 — would be noise). A structured warning plus a pinned container default gives safety without breaking local development.

## Risks / Trade-offs

- **Broadened gate entry** (any `kind === "edit"` now enters path-based scoping instead of falling to unknown-tool rejection) → Mitigation: the scoped body is still default-deny for anything outside workspace/TMPDIR/agent-workspace-with-authorization; the F3/F4 extension checks and `$VAR` token fail-containment rules are unchanged. Unknown-tool rejection still applies to non-edit kinds. A request with `kind === "edit"` but empty locations/rawInput falls through to the edit/write reject branch (fail-closed), not to approval — preserved and tested.
- **Title-based legacy matching could mask future OpenCode shape changes** → Mitigation: the bootstrap version warning (Decision 5) surfaces version drift; tests assert both shapes.
- **Version check is observational, not a hard gate** (non-container deploys can still run an incompatible binary; a future OpenCode could break the contract while still satisfying `>= minimum`) → Mitigation: the container pin (Decision 4) is the real prevention; the structured, greppable WARN makes drift visible early. No "above tested maximum" warning — no evidence of a breaking shape above 1.17.13, and the gate accepts both shapes.
- **Rejection-reason strings in retry prompts may contain user-derived content** (commands/paths the agent typed) → Mitigation: bounded section (≤ 10 entries, per-field truncation ~200 chars, section cap ~2000 chars), ALL agent-derived fields sanitized at record time (control characters stripped — no newline/CR injection), framed as "diagnostic data, not instructions", and only injected into the agent's own session prompt — no external exposure.
- **Ring-buffer lifecycle could silently no-op the feedback feature** (reset() runs at the start of every prompt, including the retry) → Mitigation: buffer is NOT cleared in `reset()`; it is cleared per logical session via `clearPermissionRejections()` at `AgentConnector.createSession()`, and the retry flow snapshots records before the second `connector.prompt()` (Decision 2/3). A test asserts records survive across the retry boundary.
- **Partial rejection recording** (some denial branches recording, others not) → Mitigation: single `recordPermissionRejection()` helper invoked on every denial path; tests cover each rejection type.
- **`opencode --version` could hang on a broken install** → Mitigation: subprocess timeout (e.g. 5s) with graceful fallback to the WARN path.
- **Container pin may lag upstream fixes** → Mitigation: bumping `OPENCODE_VERSION` is a one-line, reviewable change; checksum verification ensures the pinned version is the installed one; the bootstrap check tells operators when the installed version drifted anyway.

## Migration Plan

No migration needed — project is pre-release with zero users. Deploy order:

1. Land gate fix + test updates (Decision 1, tests) — restores correct behavior with current OpenCode.
2. Land retry-prompt feedback (Decisions 2–3) — improves agent self-correction.
3. Land version pin + bootstrap check (Decisions 4–5) — prevents recurrence.
4. Rebuild container with the pinned OpenCode; verify a normal Discord/Misskey message flows end-to-end in restricted mode (write `$TMPDIR/$SESSION_ID/reply.md` → `send-reply --message-file` → reply delivered).

Rollback: revert the commit; the previous image continues to run (the failure it produces is the pre-existing silent rejection, unchanged).

## Open Questions

- Is 1.17.13 the correct pin, or should we pin the newest release at implementation time after re-verifying the request shape? (Resolve during implementation by checking the installed binary in the built image; the per-arch checksums must be updated to match whatever version is pinned.)
