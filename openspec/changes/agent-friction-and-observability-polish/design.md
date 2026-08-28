# Design: agent-friction-and-observability-polish

## 1. send-file workspace-prefix detection (`src/skills/file-handler.ts`)

Current per-file flow (lines ~55–101): `validateFilePath` boundary check (passes! the doubled path IS inside the workspace) → `fullPath = resolve(context.workspace.path, filePath)` → `Deno.stat` fails → generic `"Failed to read file: No such file or directory (os error 2): stat '<doubled path>'"` returned to the agent.

Fix inside the stat-failure path (ENOENT only — a legit existing nested path never reaches this code), before returning the generic error. Tightened per rubber-duck review to avoid false-positive guidance:

```ts
// Self-referential prefix detection: the agent passed a workspace-prefixed
// path (e.g. "data/workspaces/discord/123/out.png") from inside that same
// workspace — a classic double-join after reading absolute paths from logs.
// Trigger ONLY when: input was RELATIVE, and the workspace-relative
// resolution contains a segment-boundary match of the workspace key
// ("discord/123/") derived from context.workspace.components — not a loose
// substring of the raw string.
const wasRelative = !isAbsolute(filePath);
const relFromRoot = fullPath.slice(context.workspace.path.length + 1);
const keyRe = new RegExp(`(^|/)${escapeRegExp(context.workspace.key)}/`);
if (wasRelative && keyRe.test(relFromRoot)) {
  const candidate = relFromRoot.slice(relFromRoot.indexOf(`${context.workspace.key}/`) + context.workspace.key.length + 1);
  const candidateExists = await fileExists(resolve(context.workspace.path, candidate));
  // guidance: always states the double-join; names `--file-paths "<candidate>"`
  // as the intended file ONLY when candidateExists === true, otherwise asks
  // the agent to re-check paths relative to the workspace root (no guessing).
  return { success: false, code: "SKILL_FILE_PATH_WORKSPACE_PREFIXED", error: guidance };
}
```

`guidance` must be self-contained (copy the payload.ts error tone — see `skills/lib/payload.ts` messages): what was wrong, why, and a corrected example naming the workspace root and the candidate path:
`SKILL_FILE_PATH_WORKSPACE_PREFIXED: "--file-paths \"data/workspaces/discord/123/out.png\" resolves to .../workspaces/discord/123/data/workspaces/discord/123/out.png — it already contains the workspace path and was joined to the workspace root again. File paths must be RELATIVE to the workspace root (/app/data/workspaces/discord/123), which is your working directory. Did you mean --file-paths \"out.png\"? Absolute paths inside the workspace are also accepted."`

Add `code?: string` to `SkillResult` (`src/skills/types.ts`); confirm `SkillAPIServer` returns the result object verbatim (it does — `data`/`error` pass through; add `code` passthrough if the response model strips unknown fields).

Do NOT auto-correct and send the candidate — the agent must converge on the documented contract.

## 2. Expected exit codes in git (`src/core/git-backup-service.ts`)

```ts
private async runGit(args: string[], expectedExitCodes: number[] = [0]): Promise<GitResult> {
  ...
  if (code !== 0) {
    if (expectedExitCodes.includes(code)) {
      logger.debug("Git command exited {code}: {args}", ...);
    } else {
      logger.error("Git command failed", ...);  // unchanged, keep credential redaction
    }
  }
```

Wire expected codes at probe-style call sites only: every `["diff", "--cached", "--quiet"]` (staged-changes probe: 1 = dirty, the NORMAL backup path — used in `initialize()` and `performBackup()`), and `["rev-parse", "--verify", "HEAD"]` (128 = no commits yet, fresh-repo init path). Status-probe calls that legitimately fail in recovery flows (`rev-parse --verify origin/main` before remote exists, `branch` checks) MAY opt in during implementation if their ERROR logs fire in tests; do not blanket-silence push/fetch/commit failures.

## 3. Chunk-log gating (`src/acp/client.ts`, config chain)

- `LoggingConfig`: add `agentStreamChunks?: boolean` (default `false` via config-loader, same pattern as `gelf` defaults); env override map in `src/utils/env.ts`: `LOGGING_AGENT_STREAM_CHUNKS → logging.agentStreamChunks` (boolean parse like `GELF_ENABLED`).
- `ChatbotClient.sessionUpdate`: wrap the two `logger.debug("Agent thought: {text}"…)` / `logger.debug("Agent message chunk: {text}"…)` calls in `if (this.config?.logging?.agentStreamChunks)` — ChatbotClient gets its config surface via existing constructor options; if no logging config is threaded there today, pass a single boolean flag through `ClientConfig` (explicit, no global config import into the ACP layer).
- Buffer pushes, `flushThoughtBuffer()`, `flushMessageBuffer()` and their INFO summaries stay unconditional.
- Update `config.example.yaml`, `.env.example`, `helm/values.yaml` (`LOGGING_AGENT_STREAM_CHUNKS: "false"`) and the AGENTS.md logging/env tables.

## 4. Exit-order guidance (`prompts/system_reply.md`, handler `nextAction`)

- system_reply.md rule becomes: "Complete ALL side effects first — memory-save/patch, reactions, reminders, file sends. THEN send your final `send-reply`. After the final `send-reply` you MUST exit immediately: no further tool calls, summaries, or memory writes. Anything you wanted to save must already be saved."
- `src/skills/reply-handler.ts` `nextAction` (two sites): keep "EXIT IMMEDIATELY" semantics; the doom-loop variant's wording stays.
- `src/skills/file-handler.ts` `nextAction`: `"You have done your job. EXIT IMMEDIATELY"` → `"If your text reply is still pending, send it now with send-reply — then EXIT IMMEDIATELY."` (file-then-reply is a supported, spec'd flow; the old string contradicted it).
- Update any test asserting these literal strings.

## Risk notes

- `SkillResult.code` addition: server response models may need the field added — check `src/skill-api/server.ts` response shaping before assuming pass-through.
- Chunk gating must not break `tests/acp/client.test.ts` assertions that assert `Agent thought:` debug lines exist — update them to enable the flag in those tests.
- Heuristic residual false-positive window: a LEGIT relative path containing `{platform}/{userId}/` segments that does NOT exist while the stripped candidate happens to exist would receive prefixed guidance with a suggestion. Accepted: the code is guidance-only (nothing is auto-sent), the trigger sits behind an ENOENT, and the shape is pathological; a wrong suggestion still names the actual workspace root so the agent can recover in one turn.
