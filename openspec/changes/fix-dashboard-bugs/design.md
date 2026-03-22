## Context

The web dashboard has four bugs making core features non-functional. All are simple mismatches between frontend/backend contracts.

## Goals / Non-Goals

### Goals

- Fix workspace file path mismatch: `buildDirectoryTree` generates paths with leading `/`, but `handleWorkspaceFile` rejects them
- Fix chat message field name: frontend sends `message` but server expects `content`
- Populate model dropdown from `modelRouting` config instead of hardcoded values
- Fix session audit ID mismatch: completed session store uses `{type}_{timestamp}` but audit files use `sess_*`

### Non-Goals

- No new features beyond the bug fixes
- No refactoring beyond what is necessary to fix the bugs

## Decisions

1. **Workspace file path**: Strip leading `/` from the path in `handleWorkspaceFile` (server-side fix) rather than changing `buildDirectoryTree`, because the tree's paths are used in the UI and stripping there would be less intuitive. The path traversal protection is still maintained after stripping.

2. **Chat message field name**: Fix the frontend `chat.js` to send `content` instead of `message`, matching the server's expected field name. Server-side fix rejected because other clients may already use `content`.

3. **Model dropdown**: Add a `/api/config/models` endpoint that extracts unique model strings from `modelRouting.rules[].model` and the default `agent.model`. The frontend fetches this on page load and populates the `<datalist>`. Keep the `<datalist>` approach (not a `<select>`) so users can still type custom model names.

4. **Audit ID mismatch**: Store the skill-API session ID (`sess_*`) alongside the display ID in `CompletedSession`. The dashboard uses the skill-API session ID for audit file lookups. Add an optional `auditSessionId` field to `CompletedSession`.

## Risks / Trade-offs

- **Model endpoint exposes config** → Only model names exposed, no credentials or other config
- **Audit ID change requires passing sess ID to `completedSessionStore.add()`** → Minimal plumbing needed since `sessionId` is already available in the orchestrator scope
