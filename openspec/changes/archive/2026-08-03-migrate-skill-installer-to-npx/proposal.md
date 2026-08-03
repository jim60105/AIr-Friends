# Migrate Skill Installer to npx

## Why

External Agent Skills are currently installed at startup via `deno x -y skills add`,
which resolves a `skills` package that is published as an npm package (vercel-labs/skills).
Running an npm CLI through `deno x` is indirect, slower, and less standard than invoking it
through its native runtime. The project already ships `nodejs`/`npm` in the container image,
so using `npx` adds no new system dependency while aligning with the ecosystem default.

## What Changes

- **BREAKING**: Replace the install command in `src/core/skill-installer.ts` from
  `deno x -y skills add <repo> -a universal -s <skill> -g -y` to
  `npx --yes --package=skills skills add <repo> -a universal -s <skill> -g -y`.
  The explicit `--package=skills` disambiguates the npm package identity so `npx` cannot
  accidentally pick up a local binary or a differently-named package.
- Update the JSDoc comment in `src/core/skill-installer.ts` and the `ExternalSkillConfig`
  doc comment in `src/types/config.ts` to reference `npx` instead of `deno x`.
- Update documentation references: `config.example.yaml`, `docs/DESIGN.md`, `AGENTS.md`, and
  the `configuration-and-deployment` spec (line 319) to reflect the new command.
- Keep all existing behavior unchanged: sequential installation, per-skill failure
  isolation, graceful non-blocking startup, and identical CLI flags. The `-a universal`
  target installs to the canonical `~/.agents/skills/` directory regardless of `-g`, which
  matches the OpenCode allow-list, so agent skill discovery is unaffected.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `configuration-and-deployment`: The "External Skill Auto-Installation" requirement changes
  the install command from `deno x -y skills add ...` to
  `npx --yes --package=skills skills add ...`.

## Impact

- **Code**: `src/core/skill-installer.ts` (command construction), `src/types/config.ts` (comment),
  `src/bootstrap.ts` (caller — no change).
- **Docs**: `config.example.yaml`, `docs/DESIGN.md`, `AGENTS.md`.
- **Tests**: `tests/core/skill-installer.test.ts` — refactor to make the command constructible
  and assert the exact runner (`npx`) and args, so the migration is locked in by tests. An
  optional injectable `SkillInstallExecutor` lets unit tests mock the subprocess (no network,
  no writes to `~/.agents/skills/`) while asserting non-zero-exit handling and continuation
  across skills.
- **Dependencies**: No new dependencies. `npx` is available via the `nodejs npm` packages already
  installed in the container image.
- **Container**: `Containerfile` — no change required; `npm` is already installed at line 19.
