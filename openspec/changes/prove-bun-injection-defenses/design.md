# Design

## Context

See `proposal.md` for motivation. Observed facts:

- `src/acp/skill-inventory.ts` cannot load under Bun yet: it imports aliased modules. `src/acp/command-syntax.ts` has no imports and no `Deno` use, so the production tokenizer can be imported directly.
- `resolveScriptEntrypoint` treats a first token that is not an interpreter as a direct entrypoint. `BUN_OPTIONS=... <script>` therefore becomes an entrypoint token that fails exact membership, which is the denial this grammar must keep.
- Throwaway probes on host Bun 1.4.2 (feasibility only, satisfying no criterion): `--config=<missing>` printed `ENOENT ... while reading config` and exited 1 with neither skill nor cwd preload running. `.bunfig.toml` in `$HOME` or `$XDG_CONFIG_HOME` did not run its preload, with or without `--config`.
- `run-suite.sh injection-noconfig` mounts an empty tmpfs on `/opt/air`, so the real shebang path is absent while the image stays the same. The suites run as UID 1000 against root-owned fixture files.
- The design's `BUN_OPTIONS` rule has two halves: skill behavior must not change, and the gate must deny the prefix. Flags cannot neutralize an environment variable that reaches Bun, so the gate is the defense. The suite records what the variable does when it does reach Bun (`bunOptionsEffective`) as a fact for the later plan.

## Goals / Non-Goals

**Goals:** prove criteria INJ-01 to INJ-08 and answer the missing-file question with a recorded fact.

**Non-Goals:**

- No edit to `src/acp/skill-inventory.ts`, `agent-config/opencode.json`, `skills/` or any product file.
- No identity or `ctime` matching in the prototype; that logic is unchanged and stays in production.
- No end-to-end run through a real agent's permission flow.
- No change to `gate/` or `Containerfile`, and none to `run-suite.sh` beyond the recorded deviation below.

Recorded deviation: `run-suite.sh`'s `injection-noconfig` tmpfs option gains `notmpcopyup`. Podman copies the image's `/opt/air` content into a `--tmpfs` by default, which would keep `skill-bunfig.toml` present and defeat this suite's precondition. Nothing else in that file changes.

## Decisions

### D1. Fixture skill

`migration/bun/poc/fixtures/skills/poc-skill/scripts/report.ts`, git mode 0755, first line verbatim:

```text
#!/usr/bin/env -S bun run --no-env-file --no-install --config=/opt/air/skill-bunfig.toml
```

It imports `./helper.ts` and `parseArgs` from `node:util`, tries `const bare = await import("poc-bare-probe").then(() => "found", () => "absent")`, and prints one line of JSON:

```ts
console.log(JSON.stringify({
  marker: "SKILL-RAN",
  args: parseArgs({ args: process.argv.slice(2), options: { flag: { type: "string" } } }).values,
  helper: helperValue,             // constant string from helper.ts
  bare,                            // "absent" unless a lookup was hijacked
  attackerEnv: Object.keys(process.env).filter((k) => k.startsWith("AIR_POC_ATTACKER")),
}));
```

### D2. Attacker directory and invocation helpers

`migration/bun/poc/injection/attacker-dir.ts`:

```ts
export const SKILL_PATH = "/repo/migration/bun/poc/fixtures/skills/poc-skill/scripts/report.ts";
export const LITERAL_BUN_RUN = ["bun", "run", "--no-env-file", "--no-install", "--config=/opt/air/skill-bunfig.toml"] as const;
export type AttackFile = "dotenv" | "bunfig" | "project" | "symlink";
export function makeAttackerDir(files: readonly AttackFile[]): string; // mkdtemp under /tmp; contains evil-preload.ts
export function pwned(dir: string): boolean;                           // <dir>/PWNED exists
export interface SkillRun { exitCode: number; stdout: string; stderr: string }
export function runDirect(cwd: string, env: Record<string, string>, path?: string): SkillRun;
export function runLiteral(cwd: string, env: Record<string, string>, path?: string): SkillRun;
export function runPlain(cwd: string, env: Record<string, string>, path?: string): SkillRun;
```

`evil-preload.ts` writes `PWNED` beside itself and prints `EVIL`. Files per `AttackFile`:

- `dotenv`: `.env` with `AIR_POC_ATTACKER_ENV=1`; `.env.local` with `AIR_POC_ATTACKER_LOCAL=1`.
- `bunfig`: `bunfig.toml` with `preload = ["./evil-preload.ts"]`.
- `project`: `tsconfig.json` with `compilerOptions.paths` mapping `poc-bare-probe` to `./evil-preload.ts`; `package.json` with a `scripts` entry named `report.ts` running `touch PWNED`; `node_modules/.bin/report.ts`, mode 0755, running `touch PWNED`; `node_modules/poc-bare-probe/index.js` writing `PWNED`. The bare import gives these files a lookup they could really hijack.
- `symlink`: `report.ts` as a symbolic link to `SKILL_PATH`, and `helper.ts` writing `PWNED`. Tests run the spelling `./report.ts` in both forms.

Runs use `spawnSync` with an explicit environment of `PATH` and `HOME`, the latter a fresh `mkdtemp` created by the run helper and removed afterwards unless the caller passes its own. `runDirect` executes the script path. `runLiteral` executes `bun` with `LITERAL_BUN_RUN.slice(1)` plus the path. `runPlain` executes plain `bun run <path>`, the unhardened form the positive controls need. All three pass the skill argument `--flag v`. Each test compares a control run from an empty `mkdtemp` against the attack run: equal `exitCode`, equal `stdout`, `pwned` false, and `"marker":"SKILL-RAN"` present, with the skill argument parsed and no attacker variable visible. Each test runs both forms, with the absolute path and with `relative(cwd, SKILL_PATH)` prefixed by `./` when needed, each spelling relative to its own run's directory.

### D3. Approval grammar prototype

`migration/bun/poc/injection/approval-grammar.ts`:

```ts
export function matchTrustedInvocation(
  segment: string,
  grants: ReadonlySet<string>,   // canonical script paths
  cwd: string,
): string | undefined;           // canonical path of the granted script, or undefined
```

Steps:

1. Return `undefined` when `containsShellOperators(commandWithoutFdRedirects(segment))`.
2. Tokenize with `tokenizeShellCommand`, drop empty tokens and tokens matching `FD_REDIRECT_TOKEN_PATTERN`, and decode the tokens up to and including the script spelling with `decodeLiteralToken`. Return `undefined` when any of those decoded tokens is `undefined`. Tokens after the script are skill arguments and are not decoded, because production's `resolveScriptEntrypoint` does not inspect them either.
3. If the first token equals `bun`: the first five tokens must equal `LITERAL_BUN_RUN` exactly, the sixth must exist, must not start with `-` and must contain `/`, and it is the spelling. The slash rule is stricter than today's `deno run` grammar, because `bun run <name>` looks up `package.json` scripts before files.
4. Otherwise the first token is the spelling and it must contain `/`.
5. Return `undefined` when the spelling contains NUL. Join a relative spelling to `cwd`, `realpathSync` it inside a `try`. If the spelling has a `..` component and `lexicallyNormalize(candidate)` differs from the real path, return `undefined`, as production's B1 guard does. Return the real path only if it is in `grants`. Tokens after the script are skill arguments and are not inspected, as today.

`decodeLiteralToken` and `lexicallyNormalize` are copied verbatim from `src/acp/skill-inventory.ts`, with `containsUnquotedShellExpansion` imported from `command-syntax.ts`, because that file cannot be imported here. A symlink spelling that resolves to a granted script is accepted here, as it is today; INJ-03 shows whether that is safe under Bun.

Because the copy is verbatim, the prototype inherits `containsUnquotedShellExpansion`'s exemption for known environment references (`$HOME`, `$XDG_DATA_HOME`, `$TMPDIR`, …): such a token is not expanded by `decodeLiteralToken` and matches literally. The suite records this as `observe("knownEnvReferenceExempt", …)` instead of asserting it, and step 6 must decide whether the production decoder rejects every unquoted `$` in an entrypoint token.

### D4. Suite method

`suites/injection.spec.ts`:

| ID | Method |
| --- | --- |
| INJ-01 | `makeAttackerDir(["dotenv"])`. Positive control first: plain `bun run <SKILL_PATH>` from that directory must show the attacker variable. Then compare to control in both forms; assert `attackerEnv` is empty. |
| INJ-02 | `makeAttackerDir(["bunfig"])`. Positive control first: plain `bun run <SKILL_PATH>` must create `PWNED`; delete it. Then compare to control in both forms. |
| INJ-03 | `makeAttackerDir(["project"])` compared to control in both forms, with `bare` of `absent`. Then `makeAttackerDir(["symlink"])` with the spelling `./report.ts`, in both forms. |
| INJ-04 | Grammar denies `BUN_OPTIONS=--preload=/tmp/e.ts <skill>`, `BUN_OPTIONS="--preload /tmp/e.ts" <literal form>` and `env BUN_OPTIONS=x <skill>`. Then run the literal form with `BUN_OPTIONS` set to preload an attacker file and call `observe("bunOptionsEffective", pwned(dir))`. This observation does not affect the test result. |
| INJ-05 | Table of the accepted and denied scenarios, including a test per flag named in the spec, plus a removal and a reorder of each element of the literal prefix. |
| INJ-06 | `statSync`: `size` 0, `uid` 0. `openSync(path, "a")` throws `EACCES`. |
| INJ-07 | Fresh `HOME` with `.bunfig.toml` and `XDG_CONFIG_HOME` with `.bunfig.toml`, each preloading an absolute `evil-preload.ts`. Compare to control in both forms. |

`suites/injection-noconfig.spec.ts`, title prefix `INJ-08:`, run with `/opt/air` empty. First assert the path is absent, so a broken run cannot pass. Use `makeAttackerDir(["bunfig"])` and run both forms. Call `observe("missingConfigExit", <codes>)` and `observe("missingConfigStderr", <first stderr line of each form>)`. Classify `fail-stop` when every run has a non-zero exit, a non-empty stderr line, no `SKILL-RAN` and `pwned` false — a spawn failure is not Bun stopping — otherwise `fallback`. Call `observe("missingConfigBehavior", <class>)`. A `fail-stop` run passes the test. For `fallback`, require `injection/skill-launcher.sh` to exist, run it from a fresh attacker directory as below, assert it exits 78 with `SKILL-RAN` absent and `pwned` false, and call `observe("literalFormUnprotected", true)`: a launcher covers the shebang path only, and the literal form is typed by the agent.

### D5. Conditional launcher

Only when the observation is `fallback` (task 3.1), add `migration/bun/poc/injection/skill-launcher.sh`, mode 0755:

```sh
#!/bin/sh
[ -f /opt/air/skill-bunfig.toml ] || { echo "skill config missing" >&2; exit 78; }
exec bun run --no-env-file --no-install --config=/opt/air/skill-bunfig.toml "$@"
```

A `fallback` result changes the shebang and the approval grammar in the later plan, so report it prominently. The record shows the unprotected literal form through its observation. Task 3.1 also reruns INJ-01 to INJ-03 through the launcher.

## Risks / Trade-offs

- [A new implicit config source exists that this list misses] → Bun is pinned exactly. Design section 6 reruns the suite on each upgrade.
- [`bunOptionsEffective` is true] → Expected, and the grammar is the defense. It raises the importance of the spawn allowlist, which excludes the variable today.
- [The prototype differs from the final inventory code] → It is a prototype of the exact design 4.4 rule. Step 6 owns the production change and carries these cases over.
