# Migrate Skill Installer to npx

## Context

External Agent Skills are auto-installed during bootstrap via `src/core/skill-installer.ts`,
which spawns `deno x -y skills add <repo> -a universal -s <skill> -g -y`. This `skills`
command is the vercel-labs/skills npm CLI ("the open agent skills ecosystem"), which is
primarily distributed and documented through npm. Invoking an npm-distributed CLI through
`deno x` works, but it is an indirect path: `deno x` downloads and runs the npm binary in a
wrapper rather than through Node's native package runner.

The project is pre-release with zero production users, so a migration of this integration
point carries no backward-compatibility cost. The container image already installs
`nodejs npm` (Containerfile line 19), so `npx` is available at runtime with no image changes.

## Goals / Non-Goals

**Goals:**
- Replace `deno x` with `npx` as the runner for the external skill installer.
- Preserve the exact CLI invocation semantics (`skills add <repo> -a universal -s <skill> -g -y`).
- Keep all existing behaviors identical: sequential install, per-skill failure isolation,
  non-blocking startup, logging of stdout/stderr.
- Update all documentation and spec references from `deno x` to `npx`.

**Non-Goals:**
- Changing the `skills` package itself or its flags.
- Changing the config schema (`ExternalSkillConfig`, `agent.externalSkills`).
- Migrating any other `deno x` usages in the project.
- Changing install-path behavior or the OpenCode allow-list (unaffected by the runner swap, see D2).

## Decisions

### D1: Use `npx --yes --package=skills` as the runner

Replace `deno x -y skills add ...` with `npx --yes --package=skills skills add ...`.

- `--yes` on `npx` auto-confirms package download/install without prompting, mirroring `deno x -y`.
- `--package=skills` pins the package identity explicitly. This guards against two edge cases:
  a local `skills` binary in `node_modules/.bin` being preferred by `npx`, and any name
  collision with an unrelated npm package.
- The remaining arguments (`skills add <repo> -a universal -s <skill> -g -y`) are unchanged.
- `npx` resolves the `skills` package from the npm registry, which is its canonical
  distribution channel.

**Alternatives considered:**
- **Keep `deno x`**: No functional benefit; npm CLI running through a non-native runner is
  slower and less aligned with ecosystem defaults.
- **Pin via `npm install -g skills` in the container**: Heavier footprint and bypasses `npx`'s
  cache/cleanup model; unnecessary since `npx` handles fetching on demand.
- **`npx -y skills` without `--package`**: Works in this repo today (no local `skills` binary
  exists), but is less defensive. The explicit `--package` form is adopted as the safer default.

### D2: Keep the exact flag set identical

The flags `-a universal`, `-s <skill>`, `-g`, `-y` are preserved verbatim. `-a universal`
targets the universal skill directory. Verified against the vercel-labs/skills source
(`src/installer.ts` `getAgentBaseDir()`): for `universal` agents the skills directory is
always the canonical `~/.agents/skills/`, regardless of the `-g` flag — the
`~/.config/agents/skills` XDG path only applies to non-universal agents. This matches the
OpenCode `external_directory` allow-list, so agent skill discovery is unchanged by the
runner swap. Changing any flag would alter where skills land and is out of scope.

### D3: No changes to the runtime dependencies

`npx` is available because `npm` ships with the `nodejs npm` packages already installed in the
container (Containerfile line 19) and on developer machines with Node. No Containerfile edits,
no new packages, and no environment-var changes are required.

### D4: Make the command constructible and testable

Extract the `Deno.Command` construction into a small pure helper
`buildSkillInstallCommand(skill): { cmd: string; args: string[] }` so tests can assert the exact
runner (`npx`) and argument list without spawning a subprocess. This locks in the migration:
the existing tests only exercised empty-array and graceful-failure paths and would not catch a
wrong runner or missing `x` argument.

`installExternalSkills` also accepts an optional `SkillInstallExecutor` (a minimal subprocess
abstraction defaulting to `Deno.Command`). Tests inject a mock executor so unit tests do not
hit the network or write to `~/.agents/skills/`, and can assert real failure handling:
non-zero exit codes are logged and remaining skills are still attempted; spawn errors are
caught and non-fatal.

## Risks / Trade-offs

- [Requires Node/npm at runtime] → Already satisfied: the container installs `nodejs npm`, and
  `npx` is used elsewhere in the project (e.g., MCP servers in `.env.example`). No new risk.
- [npx first-run download latency] → Same as `deno x` first-run behavior; acceptable for a
  one-time bootstrap install and mitigated by `npx`'s on-disk cache on subsequent runs.
- [Unpinned upstream `skills` CLI version] → Both `deno x` and `npx` fetch the latest published
  version, so behavior parity is preserved. Pinning a specific version is a follow-up hardening
  opportunity, out of scope for the runner migration.
- [Hanging install could block startup] → `await command.output()` has no timeout. This is
  pre-existing behavior shared with the `deno x` implementation; adding a per-skill timeout is
  a separate hardening item and not part of this migration.
