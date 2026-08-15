# Tasks: Fix ACP Edit/Write Permission Gate

## 1. Fix the edit/write classification in the permission gate

- [x] 1.1 In `src/acp/client.ts`, replace the edit/write branch condition at ~line 1031 with a helper that recognizes `kind === "edit"` OR legacy titles (`"edit"`, `"edit_file"`, `"write"`, `"write_file"`), per Design Decision 1
- [x] 1.2 Verify the scoped branch body still extracts paths from `locations` first, then from `rawInput` (`path`, `file_path`, `filePath`, `filepath`, `file`, `filename`, `paths`, `files`), covering both OpenCode write (`{filePath, content}`) and edit (`{filepath, diff}`) shapes
- [x] 1.3 Confirm unknown-tool rejection still applies to non-edit kinds (e.g. `kind: "other"` tool calls that are not registered skills)

## 2. Add per-session permission rejection tracking

- [x] 2.1 Add a bounded ring buffer (max 10 entries) `recentPermissionRejections` to `ChatbotClient`, plus a `PermissionRejection` type (`{ toolName, kind, commandOrPath, reason, ts }`) in `src/acp/types.ts` or `client.ts`
- [x] 2.2 Add a single `recordPermissionRejection(toolName, kind, commandOrPath, reason)` helper and call it on EVERY denial path in `requestPermission()` (legacy free-text flag, generic-command rejection, unauthorized shared-workspace write, disallowed extension, edit/write reject, unknown-tool reject) and every `writeTextFile()` denial
- [x] 2.3 Expose `getRecentPermissionRejections()` and `clearPermissionRejections()`; clear the buffer ONLY at logical session start (`AgentConnector.createSession()`), NOT in `reset()` — `reset()` runs at the start of every prompt including the retry, and clearing there would wipe the data the retry prompt needs (Design Decision 2)
- [x] 2.4 Enforce bounds: per-field truncation (`commandOrPath` ~200 chars) and a section cap (~2000 chars) so oversized/user-derived content cannot inflate the retry prompt or be re-injected verbatim; sanitize ALL agent-derived fields (`toolName`, `kind`, `commandOrPath`) at record time (strip control characters, bound each field incl. truncation marker); record exactly ONE entry per denial (extension branch returns reject immediately, no generic duplicate)

## 3. Enrich the retry prompt with rejection reasons

- [x] 3.1 Change `getRetryPromptStrategy()` in `src/acp/agent-factory.ts` to accept optional `rejections` and append a `Recent permission rejections in this session:` section (bounded, truncated per entry, framed as diagnostic data not instructions) when non-empty
- [x] 3.2 Converge the three retry flows in `src/core/session-orchestrator.ts` (~lines 719, 1208, 2485) into a single shared retry-prompt helper that snapshots `connector.getClient()?.getRecentPermissionRejections()` BEFORE the retry `connector.prompt()` call and passes them into the strategy, so the flows cannot drift apart
- [x] 3.3 Ensure the retry prompt is byte-identical to today when no rejections exist

## 4. Pin OpenCode version in the container and verify at bootstrap

- [x] 4.1 Add `ARG OPENCODE_VERSION=1.17.13` and per-arch `ARG OPENCODE_SHA256_*` checksums to `Containerfile`; change the `opencode-unpacker` download URL to `releases/download/v${OPENCODE_VERSION}/opencode-linux-${OC_ARCH}.tar.gz` and verify the archive with `sha256sum -c` before extracting
- [x] 4.2 Implement `verifyOpenCodeVersion()` (spawn `opencode --version` with a ~5s timeout, parse semver, compare with `KNOWN_GOOD_OPENCODE_MIN_VERSION` constant, env-overridable via `AGENT_OPENCODE_MIN_VERSION`) — INFO on OK, structured WARN (greppable `OK`/`BELOW_MINIMUM`/`UNKNOWN` marker) on below-minimum or undetermined, never blocks startup
- [x] 4.3 Call `verifyOpenCodeVersion()` from `bootstrap()` after config load

## 5. Update and add tests

- [x] 5.1 Update existing edit/write permission tests in `tests/acp/client.test.ts` that use unrealistic shapes (`kind: "write"` via `as unknown as`, `title: "write_file"`, `title: "edit_file"`) to real shapes: `kind: "edit"` with `title` = file path, and `kind: "edit"` with legacy `title: "edit"`
- [x] 5.2 Add regression tests: (a) `kind: "edit"` request with `rawInput: { filePath, content }` writing `$TMPDIR/$SESSION_ID/reply.md` auto-approved in restricted mode; (b) `kind: "edit"` request with `rawInput: { filepath, diff }` for an in-workspace path approved; (c) out-of-workspace path rejected; (d) `kind: "edit"` with empty locations AND unparseable rawInput rejected (fail-closed, not approved); (e) unknown-tool rejection preserved for non-edit kinds; (f) mixed valid/invalid multi-path requests rejected
- [x] 5.3 Add tests for rejection tracking: entries recorded on every denial type, cleared only by `clearPermissionRejections()` (NOT by `reset()`), bounded at 10, per-field truncation
- [x] 5.4 Add tests for retry prompt enrichment: rejections included when present (surviving across the retry `prompt()` boundary), absent when empty, byte-identical message with no rejections
- [x] 5.5 Add tests for `verifyOpenCodeVersion()`: at/above minimum (INFO), below minimum (WARN), unparseable/failure (WARN, startup continues)

## 6. Docs and deployment config

- [x] 6.1 Update `AGENTS.md` (ACP permission handling section) and `docs/AGENT_PERMISSIONS.md` to document the real OpenCode request shapes (`kind: "edit"`, title = file path) and the version pin/check
- [x] 6.2 Document `AGENT_OPENCODE_MIN_VERSION` in `config.example.yaml` (comment), `.env.example`, `helm/values.yaml` (under `env:`), and `AGENTS.md` — noting it only affects the bootstrap warning, not a functional gate

## 7. Verification

- [x] 7.1 Run `deno fmt src/ tests/`, `deno lint src/ tests/`, `deno check src/main.ts`, and `deno test` — all green
- [x] 7.2 Confirm test coverage stays above 75%
- [x] 7.3 Rebuild the container with the pinned OpenCode version (checksum-verified) and verify a real restricted-mode session end-to-end: agent writes `$TMPDIR/$SESSION_ID/reply.md` via the `write` tool (real `kind: "edit"` request shape), calls `send-reply --message-file`, reply is delivered
