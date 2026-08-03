## 1. Core Implementation

- [x] 1.1 Update `src/core/skill-installer.ts` to spawn `npx` instead of `deno`, changing the `Deno.Command` args from `["x", "-y", "skills", "add", ...]` to `["--yes", "--package=skills", "skills", "add", ...]` with command name `npx`
- [x] 1.2 Extract a pure helper `buildSkillInstallCommand(skill)` in `src/core/skill-installer.ts` returning `{ cmd, args }` so the command is unit-testable without spawning a subprocess
- [x] 1.3 Update the JSDoc comment in `src/core/skill-installer.ts` to reference `npx --yes --package=skills skills add` instead of `deno x -y skills add`
- [x] 1.4 Update the `ExternalSkillConfig` doc comment in `src/types/config.ts` to reference `npx --yes --package=skills skills add`
- [x] 1.5 Accept an optional `SkillInstallExecutor` in `installExternalSkills` (defaulting to `Deno.Command`) so tests can mock the subprocess without network or filesystem writes

## 2. Tests

- [x] 2.1 Refactor `tests/core/skill-installer.test.ts` to assert via `buildSkillInstallCommand` that the runner is `npx` and the args are `--yes --package=skills skills add <repo> -a universal -s <skill> -g -y`
- [x] 2.2 Keep the existing empty-array test passing; replace the real-spawn failure test with a mock executor that asserts non-zero exit codes are logged, remaining skills are still attempted, and spawn errors are non-fatal

## 3. Documentation

- [x] 3.1 Update `config.example.yaml` to reference `npx --yes --package=skills skills add`
- [x] 3.2 Update `docs/DESIGN.md` (Feature 27 / External Skill Auto-Installation) to reference `npx` instead of `deno x`
- [x] 3.3 Update `AGENTS.md` Feature 27 (External Skill Auto-Installation) to reference `npx` instead of `deno x`

## 4. Verification

- [x] 4.1 Run `deno task test` to confirm installer tests pass
- [x] 4.2 Run `deno fmt src/ tests/` and `deno lint src/ tests/`
- [x] 4.3 Run `deno check src/main.ts`
- [x] 4.4 Run `openspec validate --change "migrate-skill-installer-to-npx"` to confirm the change artifacts are valid
