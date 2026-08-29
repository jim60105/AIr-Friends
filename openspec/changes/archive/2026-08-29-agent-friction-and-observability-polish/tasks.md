# Tasks: agent-friction-and-observability-polish

Four independent items — commit each separately in this order.

## 1. send-file workspace-prefix guidance

- [x] 1.1 `src/skills/types.ts`: add `code?: string` to `SkillResult`; confirm the Skill API server response passthrough carries `code` (inspect `src/skill-api/server.ts` response construction; add it if modeled)
- [x] 1.2 `src/skills/file-handler.ts`: in the stat-failure path (after `fullPath = resolve(context.workspace.path, filePath)` throws), add the self-referential detection per design §1: RELATIVE input only + segment-boundary regex match of `context.workspace.key` in the workspace-relative resolution; stat the de-prefixed candidate and include the "did you mean" filename ONLY when it exists (no guessing otherwise); return `{ success: false, code: "SKILL_FILE_PATH_WORKSPACE_PREFIXED", error: <guidance> }`; leave all other error paths untouched
- [x] 1.3 Tests in `tests/skills/file-handler.test.ts` (model after the existing multi-file/limit tests): (a) workspace-key-prefixed nonexistent path + existing candidate → code + guidance shows corrected `--file-paths "out.png"`; (b) prefixed path whose candidate is ALSO missing → code but NO claimed filename; (c) plain missing file (no key segment) → no code, original error; (d) absolute in-workspace path still delivers; (e) existing legit relative path that contains `discord/<uid>/` segments → delivers (heuristic never reached)
- [x] 1.4 Verify: `deno task test --filter file-handler` passes

## 2. Git backup expected exit codes

- [x] 2.1 `src/core/git-backup-service.ts`: `runGit(args, expectedExitCodes: number[] = [0])`; DEBUG log for expected codes (message template `"Git command expected exit {exitCode}: {args}"`), ERROR unchanged otherwise (keep credential redaction on both paths)
- [x] 2.2 Pass `expectedExitCodes: [1]` at every `["diff", "--cached", "--quiet"]` call site; `[128]` at `["rev-parse", "--verify", "HEAD"]`; sweep remaining probe call sites for test-time ERROR noise and opt them in ONLY where the non-zero code is a documented state probe
- [x] 2.3 Tests in `tests/core/git-backup-service.test.ts`: expected code → no ERROR entry (capture logs), unexpected code → ERROR present, push failures unchanged
- [x] 2.4 Verify: `deno task test --filter git-backup` passes

## 3. Chunk-log gating

- [x] 3.1 `src/types/config.ts` `LoggingConfig`: `agentStreamChunks?: boolean`; `src/core/config-loader.ts`: default `false`; `src/utils/env.ts`: `LOGGING_AGENT_STREAM_CHUNKS` mapping (boolean parse next to `GELF_ENABLED`)
- [x] 3.2 `ClientConfig` (src/acp/types.ts): thread `logAgentStreamChunks?: boolean` from orchestrator client-config sites into `ChatbotClient`; gate the two per-chunk `logger.debug` calls in `sessionUpdate` (thought + message chunk). Buffers/flush/INFO summaries untouched
- [x] 3.3 Update `tests/acp/client.test.ts` cases that assert `Agent thought:`/`Agent message chunk:` debug output to enable the flag; add one test: default config emits no per-chunk debug but the complete-thought INFO still flushes
- [x] 3.4 Config docs sync (repo checklist): `config.example.yaml` (`logging.agentStreamChunks: false`), `.env.example` (`LOGGING_AGENT_STREAM_CHUNKS=false`), `helm/values.yaml` env section, AGENTS.md logging section table
- [x] 3.5 Verify: `deno task test --filter client` passes; `deno check src/main.ts` exits 0

## 4. Exit-order guidance wording

- [x] 4.1 `prompts/system_reply.md`: replace the "Exit directly after sending the reply" bullet with the explicit order per design §4 (side effects first, then final send-reply, then immediate exit)
- [x] 4.2 `src/skills/file-handler.ts` success `nextAction`: "If your text reply is still pending, send it now with send-reply — then EXIT IMMEDIATELY."; leave `src/skills/reply-handler.ts` nextAction strings as-is
- [x] 4.3 Update tests asserting the old literal `nextAction` string (`rg -n "EXIT IMMEDIATELY" tests/`)
- [x] 4.4 Verify: `deno task test`, `deno lint src/ tests/`, `deno fmt src/ tests/ && deno fmt --check src/ tests/`
