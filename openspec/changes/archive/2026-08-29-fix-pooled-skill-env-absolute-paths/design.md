# Design: fix-pooled-skill-env-absolute-paths

## Context

The bot process runs with cwd `/app` in containers (and the repo root locally). Pool-path values are built by joining the **relative** config value (`workspace.repoPath`, default `./data`) with pool segments:

```ts
// src/acp/agent-factory.ts (buildBaseAgentConfig, poolKey branch)
env["SKILL_JWT_DIR"] = appConfig.agent.sharedProcess?.jwtDir ?? "data/skill-jwt"; // relative
env["TMPDIR"] = join(dataRoot, "channel-tmp", poolKey);                             // relative
env["XDG_DATA_HOME"] = join(dataRoot, "opencode-data", poolKey);                    // relative
cwdOverride = join(dataRoot, "channel-cwd", poolKey);                               // relative
```

Every consumer that WRITES these paths (pool `issueSessionJwtFile`, `writeActivePointer`, `ensureSharedDirs`, bootstrap `ensureSkillJwtDir`) resolves them against the bot cwd — correct. But skill scripts READ `$SKILL_JWT_DIR` with `Deno.readTextFileSync(`${jwtDir}/${sessionId}.jwt`)` from an arbitrary tool cwd, so the relative value breaks: JWT unreadable, pointer unreadable, stale-`$SESSION_ID` fallback, `mktemp` failures in external skills.

## Decisions

### D1: Lexical `resolve()` at consumption, not `realPath`

Use `resolve()` from `@std/path` (pure lexical, no syscall, works before the directory exists). `realPath` would fail before `ensureSharedDirs`/`ensureSkillJwtDir` create the dirs and would fold symlinks, changing paths the permission gate already reasons about.

### D2: Centralize the JWT-dir default + normalization

The literal `"data/skill-jwt"` is currently duplicated in 4 places (`agent-factory.ts:105`, `agent-process-pool.ts:122`, `session-orchestrator.ts:3727`, `bootstrap.ts:187`). Replace with one exported helper in `src/utils/skill-jwt.ts`:

```ts
export const DEFAULT_SKILL_JWT_DIR = "data/skill-jwt";
/** Absolute JWT directory — the single source of truth for all readers and writers. */
export function resolveSkillJwtDir(config: Config): string {
  return resolve(config.agent.sharedProcess?.jwtDir ?? DEFAULT_SKILL_JWT_DIR);
}
```

(Import `Config` type is already used in `skill-jwt.ts`? — if not, accept `jwtDir?: string` instead: `resolveSkillJwtDir(jwtDir?: string)`. Pick whichever keeps the module dependency graph acyclic; do NOT introduce a `types/config.ts` → `skill-jwt.ts` cycle.)

A blank (empty/whitespace) `jwtDir` value is treated as unset and falls back to the default — under no circumstances may it resolve to the bot process cwd itself, which would silently scatter JWT/pointer files into the application root instead of failing fast.

All 4 sites call the helper, so reader (agent env) and writers (pool, orchestrator, bootstrap) get the identical absolute path resolved against the same process cwd.

### D3: Resolve pool data dirs inside `agent-factory.ts` + `ensureSharedDirs`

Pool-branch values become `resolve(join(dataRoot, ...))` for `TMPDIR`, `XDG_DATA_HOME`, and `cwdOverride`. `AgentProcessPool.ensureSharedDirs()` resolves the same way (`resolve(join(dataRoot, sub, poolKey))` for `Deno.mkdir`): mkdir from the bot cwd already lands in the same directory, and resolving makes the created directory string byte-identical to the absolute values exported into the agent process env. The absolute-ness requirement applies to anything crossing into the agent process env.

Per-spawn mode values are already absolute (`workingDir` is `workspace.path`) — leave untouched.

### D4: No config-schema or deployment change

`config.yaml` may keep relative `repoPath`/`jwtDir`; they stay "relative to the bot process cwd" (unchanged documented semantics). Helm/container configs, `.env.example`, `config.example.yaml` need no edits.

## Risks / trade-offs

- Tests asserting the literal relative strings (e.g. `assertEquals(env.SKILL_JWT_DIR, "data/skill-jwt")`) will fail — update expectations to `resolve("data/skill-jwt")`. Confine churn to test files.
- Log output now shows absolute paths (e.g. bootstrap's "JWT directory ready at …", FileHandler redaction keyed on workspace root) — acceptable; the redactor matches on the workspace root which was already absolute.
- Symlinked `/app` deployment (cwd itself a symlink): lexical resolve keeps the symlinked prefix consistently on both read and write sides, so no new asymmetry is introduced.

## Migration

None required (pre-1.0, zero external users). Behavior for per-spawn deployments is a no-op.
