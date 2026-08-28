# Tasks: fix-pooled-skill-env-absolute-paths

## 1. Centralize and resolve the JWT directory

- [ ] 1.1 In `src/utils/skill-jwt.ts`, add `export const DEFAULT_SKILL_JWT_DIR = "data/skill-jwt"` and `export function resolveSkillJwtDir(jwtDir?: string): string { return resolve(jwtDir ?? DEFAULT_SKILL_JWT_DIR); }` (use `resolve` from `@std/path`; keep the module's dependency graph acyclic)
- [ ] 1.2 Replace the duplicated `"data/skill-jwt"` default and raw config reads with `resolveSkillJwtDir(...)` at all four sites: `src/bootstrap.ts` (jwtDir at startup), `src/core/agent-process-pool.ts` (constructor `this.jwtDir`), `src/core/session-orchestrator.ts` (`skillJwtDir` getter), `src/acp/agent-factory.ts` (`env["SKILL_JWT_DIR"]`)
- [ ] 1.3 Verify: `deno check src/main.ts` exits 0; `rg -n '"data/skill-jwt"' src/` shows the literal only in `src/utils/skill-jwt.ts`

## 2. Export absolute pool data paths

- [ ] 2.1 In `src/acp/agent-factory.ts` poolKey branch, wrap `TMPDIR`, `XDG_DATA_HOME`, and `cwdOverride` with `resolve(join(dataRoot, ...))`
- [ ] 2.2 Verify: `deno check src/main.ts` exits 0

## 3. Tests

- [ ] 3.1 In `tests/acp/agent-factory.test.ts`, add/adjust cases: with `poolKey` set and relative `workspace.repoPath`, `env.TMPDIR`, `env.XDG_DATA_HOME`, `env.SKILL_JWT_DIR`, and `cwd` all satisfy `isAbsolute()` and equal `resolve(join(repoPath, ...))` / `resolve("data/skill-jwt")`
- [ ] 3.2 In `tests/skills/lib-client.test.ts`, add a cwd-independence case: with absolute `SKILL_JWT_DIR` + pointer/JWT files created under it, run the resolution helpers with `Deno.cwd()` != the JWT dir's parent (use `Deno.Command` deno-test subprocess or refactor helpers to take an explicit cwd only if already supported — do NOT change the public API); assert the owning session resolves from the pointer and the JWT is read on the first attempt
- [ ] 3.3 Run the full gates: `deno task test`, `deno lint src/ tests/`, `deno fmt --check src/ tests/` — all pass; update any test expectations that asserted the old relative strings (test files only)
- [ ] 3.4 Confirm `deno test tests/integration/shared-process.integration.test.ts` passes unchanged

## 4. Docs touchpoints

- [ ] 4.1 If any error-message or prompt text references `data/skill-jwt` as a literal path, leave the wording but verify it is still accurate (paths in errors now render absolute) — check `skills/lib/client.ts` `SKILL_JWT_UNREADABLE` message and `src/core/config-loader.ts` validation warnings
