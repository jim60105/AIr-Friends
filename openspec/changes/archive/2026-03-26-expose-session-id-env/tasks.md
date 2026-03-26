## 1. Remove SESSION_ID File

- [x] 1.1 Remove all `SESSION_ID` file write operations (`Deno.writeTextFile(sessionIdFile, shellSessionId)`) from `src/core/session-orchestrator.ts` across all session flows
- [x] 1.2 Remove all `SESSION_ID` file cleanup/removal code from `src/core/session-orchestrator.ts` finally blocks
- [x] 1.3 Remove the `SESSION_ID` entry from `.gitignore` rules in `src/core/git-backup-service.ts`
- [x] 1.4 Update or remove tests related to `SESSION_ID` file creation/cleanup

## 2. Expose SESSION_ID as Environment Variable

- [x] 2.1 Add `Deno.env.set("SESSION_ID", shellSessionId)` after `createSession()` in each session flow in `src/core/session-orchestrator.ts`
- [x] 2.2 Add `Deno.env.delete("SESSION_ID")` in session cleanup/finally blocks
- [x] 2.3 Add tests verifying `SESSION_ID` env var is set during session and cleaned up after

## 3. Update Prompts

- [x] 3.1 Update `prompts/system_reply.md` to instruct agent to use `$SESSION_ID` env var instead of embedding `{{ sessionId }}`
- [x] 3.2 Update `prompts/system_spontaneous.md` similarly
- [x] 3.3 Update `prompts/system_self_research.md` similarly
- [x] 3.4 Update `prompts/system_memory_maintenance.md` similarly

## 4. Remove sessionId Template Variable

- [x] 4.1 Remove `sessionId` from template variables in context assembly / session orchestrator code
- [x] 4.2 Remove `sessionId` from the `TemplateVariables` type definition in `src/types/template.ts`
- [x] 4.3 Update tests that reference `sessionId` as a template variable

## 5. Update Documentation

- [x] 5.1 Update `AGENTS.md` — remove references to `SESSION_ID` file in workspace, update skills section
- [x] 5.2 Update `docs/DESIGN.md` — remove `SESSION_ID` file reference, document env var approach
- [x] 5.3 Update `docs/AGENT_PERMISSIONS.md` — clarify `SESSION_ID` is an env var available to agent subprocess

## 6. Verification

- [x] 6.1 Run full test suite to ensure no regressions
- [x] 6.2 Verify lint and type check pass
