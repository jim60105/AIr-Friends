# Proposal: agent-friction-and-observability-polish

## Why

Three small, evidence-backed friction sources from the production log review (export-8df05099e9bc412), each independently trivial but together a full workday of mechanical fixes:

1. **`send-file` path doubling with no guidance**: an agent (confused by the relative-env bug) passed `data/workspaces/discord/<uid>/out.png`; `FileHandler` joined it onto the workspace root producing `.../workspaces/discord/<uid>/data/workspaces/discord/<uid>/out.png` and failed with a bare ENOENT "Failed to stat file" (13:20:59). The payload subsystem has a rich `SKILL_*` instructive-error culture; file paths have none, so the agent had to infer the doubling itself.
2. **Git backup fake ERRORs**: `git diff --cached --quiet` legitimately exits 1 (staged changes exist — the normal "needs backup" signal); `runGit()` logs ANY non-zero exit at ERROR ("Git command failed"), producing two false alarms per backup cycle in production logs.
3. **Per-chunk agent stream logs drown the log platform**: 93% of the 8,056-line export were `Agent thought:`/`Agent message chunk:` DEBUG lines (one per token). The complete-thought/complete-message INFO summaries already exist; per-chunk DEBUG made the incident undiagnosable without jq triage and costs log-platform volume on every deployment.
4. (Prompt hygiene, no spec change) The instructions tell the agent to "exit directly after send-reply" while memory-save guidance says save memories when relevant — agents visibly agonize (twice in the reviewed log) and both sessions did memory writes AFTER the reply, violating the letter of the rule. Make the order explicit instead of contradictory.

## What Changes

- `send-file`: when a `--file-paths` value resolves OUTSIDE the workspace but its repo-prefixed form reveals a path that exists inside it (the classic double-join shape), fail with a structured `SKILL_FILE_PATH_WORKSPACE_PREFIXED` error (payload.ts error culture: code + why + corrected example naming the actual workspace root). Absolute paths inside the workspace remain accepted (already pass `resolve()` + boundary checks). No silent path rewriting.
- `GitBackupService.runGit(args, expectedExitCodes?)`: exit codes in the expected set are logged at DEBUG, not ERROR; wire `expectedExitCodes: [1]` at `diff --cached --quiet` call sites and `[128]` at `rev-parse --verify HEAD`; unexpected codes keep ERROR.
- New config `logging.agentStreamChunks` (default `false`, env `LOGGING_AGENT_STREAM_CHUNKS`): gates the per-chunk `Agent thought: {text}` / `Agent message chunk: {text}` DEBUG logs in `ChatbotClient.sessionUpdate`. Buffering, flush-on-turn-end, and the INFO `Agent complete thought` / `Agent complete message` summaries are UNCHANGED. Update `config.example.yaml`, `.env.example`, `helm/values.yaml` per the repo's config checklist.
- Prompt/handler wording: `prompts/system_reply.md` — replace the blanket "Exit directly after sending the reply" with an explicit order: complete all side effects (memory-save/patch, react, send-file, reminders) BEFORE the final `send-reply`; after `send-reply` exit immediately with no further tool calls. Adjust `nextAction` strings in `src/skills/reply-handler.ts`/`file-handler.ts` to match (file-handler's "EXIT IMMEDIATELY" currently contradicts the supported reply-after-file flow — it becomes "If your text reply is still pending, send it now, then EXIT").

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `skills-and-reply`: new requirement "Instructive workspace-path errors for send-file" (typed `SKILL_FILE_PATH_*` error with corrected example).
- `git-backup`: new requirement "Expected git exit codes do not log as errors".
- `acp-integration`: "Agent Thought Chunk Logging with Dual-Format Text Extraction" MODIFIED — per-chunk DEBUG logging applies only when `logging.agentStreamChunks` is enabled; extraction rules unchanged; default disabled.

## Impact

- `src/skills/file-handler.ts`, `tests/skills/file-handler.test.ts`
- `src/core/git-backup-service.ts`, `tests/core/git-backup-service.test.ts`
- `src/acp/client.ts`, `src/types/config.ts`, `src/core/config-loader.ts` (default), `src/utils/env.ts` (override), `tests/acp/client.test.ts`
- `config.example.yaml`, `.env.example`, `helm/values.yaml`, `AGENTS.md` config tables
- `prompts/system_reply.md`, `src/skills/reply-handler.ts`, `src/skills/file-handler.ts` (`nextAction` strings — check `tests/skills/reply-handler.test.ts`/`file-handler.test.ts` for literal assertions)
- No dependency between the four items; all independently shippable within the change
