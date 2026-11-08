# Design

## Context

See `proposal.md`. Observed facts:

- 16 scripts plus `skills/lib/client.ts` carry `#!/usr/bin/env -S deno run --allow-net --allow-env [--allow-read] [--allow-write]`. `skills/lib/payload.ts` has no shebang.
- Imports from outside `skills/`: 13 × `jsr:@std/flags@^0.224.0`, 1 × `jsr:@std/path@^1.0.0`. Deno use in `skills/`: `Deno.args` 36, `Deno.exit` 16, `Deno.env` 8, `Deno.readTextFileSync` 3, `Deno.readTextFile`, `Deno.realPath`, `Deno.realPathSync`, `Deno.remove`, `Deno.cwd` once each.
- `parse` options in use: `string`, `boolean`, `alias`, `default` (`fetch-context` `limit: 20`, `memory-export` `format`/`importance`/`enabled-only`, `memory-search` `limit: 10`), `collect` (`send-file` `file-paths`). `@std/flags` turns an undeclared `--x 5` into the number `5`; `node:util` `parseArgs` with `strict: false` turns an undeclared `--x` into `true` and leaves `5` positional.
- `skills/lib/client.ts` `parseBaseArgs(args)` parses `--session-id`/`-s` and `--api-url`/`-a`; `skills/lib/payload.ts` `readPayloadArg(args, name, ...)` reads `--<name>-file` and resolves it with `Deno.realPath` before a containment check.
- PoC fixture `migration/bun/poc/fixtures/skills/poc-skill/scripts/report.ts` uses the exact shebang and `parseArgs` from `node:util`.
- Go record observation `injection-noconfig`: with `/opt/air/skill-bunfig.toml` absent, both invocation forms exit 1 with `ENOENT: /opt/air/skill-bunfig.toml`.

## Goals / Non-Goals

**Goals:** Bun skills with identical argument semantics and the hardened shebang; a dev/CI way to create the trusted config file.

**Non-Goals:**

- No change to the approval grammar, `agent-config/opencode.json` or `src/acp/skill-inventory.ts` (`enforce-bun-skill-approval-grammar`).
- No change to skill HTTP payloads, `SKILL.md` usage text other than a `deno run` mention, or exit codes.
- No compiled skills (`bun build --compile` reads `.env` by default, section 3).

## Decisions

### D1. Shebang

Exactly `#!/usr/bin/env -S bun run --no-env-file --no-install --config=/opt/air/skill-bunfig.toml` as line 1 of each executable script and `skills/lib/client.ts`. File modes stay as they are; in particular `skills/lib/client.ts` and `skills/lib/payload.ts` are libraries and must not be made executable.

### D2. Arguments

For each `parse(Deno.args, opts)` call, declare in `parseArgs` every key the script reads afterwards:

```ts
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { "session-id": { type: "string", short: "s" }, limit: { type: "string" }, "file-paths": { type: "string", multiple: true }, ... },
  strict: false,
  allowPositionals: true,
});
```

- A key `@std/flags` would return as a number (undeclared, or a declared `default` number) is declared `type: "string"` and converted with `Number(values.x ?? <default>)` at the read site.
- A `default` becomes `?? <default>` at the read site; `boolean` keys become `type: "boolean"`; `collect` keys become `multiple: true`; `alias` entries become `short` when the alias is one letter.
- `parseBaseArgs` in `skills/lib/client.ts` follows the same rules.
- `tests/skills/skill-args.test.ts` (new): for each script, a table of argv vectors covering its aliases, defaults, repeated and numeric flags, asserting the parsed values. The scripts export nothing today, so add an exported `parse<Name>Args(argv: string[])` function to each script and guard the script body with `if (import.meta.main)`; the test imports these functions.

### D3. Other APIs

Run the codemod with `--no-src-helpers` on `skills/lib/*.ts` and `skills/*/scripts/*.ts`, then hand-convert: `Deno.args` → `process.argv.slice(2)`, `Deno.exit` → `process.exit`, `Deno.remove(p)` → `fs.promises.unlink(p)` (it removes a payload file), `jsr:@std/path` → `node:path`, `instanceof Deno.errors.NotFound` → `(error as NodeJS.ErrnoException)?.code === "ENOENT"`. Skills keep importing only `node:*` and `skills/lib/`.

### D4. Trusted config on hosts

`scripts/install-skill-bunfig.sh` (POSIX `sh`, `set -eu`): `sudo install -d -m 0755 -o root -g root /opt/air && sudo install -m 0444 -o root -g root /dev/null /opt/air/skill-bunfig.toml`, idempotent, and prints the resulting `ls -l` line. CI calls it (`migrate-ci-and-docs-to-bun`).

### D5. Tests

Convert the five test files with the codemod and README. Tests that executed a skill with `deno run <flags> <script>` execute it directly (`spawnSync(scriptPath, args)`, relying on the shebang) unless the test is about the literal invocation, in which case it uses the exact literal `bun run --no-env-file --no-install --config=/opt/air/skill-bunfig.toml <script>`. Test names stay unchanged.

## Risks / Trade-offs

- [A flag that a script reads is missed in `options`] → It parses as `true` and the argument tests or `scripts.test.ts` fail; D2's table per script is the guard.
- [Developers without `sudo`] → Skill-executing tests fail with the `ENOENT` message, which names the missing file; the fix is D4.
