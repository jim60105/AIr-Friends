# Design

## Context

See `proposal.md`. Observed facts:

- `deno.json` imports: `@std/assert`, `@std/crypto`, `@std/path`, `@std/testing`, `@std/yaml`, `@std/dotenv`, `@std/fs`, `@std/json`, `@std/flags`, nine npm packages, Vento from a jsDelivr URL, and six `@x/` aliases into `src/`.
- Real use (grep of `src/` and `tests/`): `src/` imports only `@std/path`, `@std/yaml`, `@std/fs`, `@std/flags` and `ventojs` (`ventojs` and `ventojs/core/environment.ts` in `src/core/template-renderer.ts`). `tests/` also imports `@std/assert` (198 files) and `@std/testing/time` (4 files). `@std/crypto`, `@std/dotenv` and `@std/json` have no importer and are dropped.
- `deno.lock` resolved versions: `discord.js` 14.26.4, `html-to-text` 9.0.5, `mailparser` 3.9.39, `misskey-js` 2026.10.0, `imapflow` 1.7.8, `@agentclientprotocol/sdk` 0.14.1 (with `zod` 4.4.3), `@node-rs/jieba` 2.0.3, `nodemailer` 7.0.13, `prom-client` 15.1.3, `@std/assert` 1.0.19, `@std/testing` 1.0.18.
- npm `ventojs@2.2.0` exports `.` and `./core/environment.js` (types `./types/core/environment.d.ts`); it has no `./core/environment.ts` export. Step 4 changes the type import specifier.
- JSR serves npm-compatible tarballs at `https://npm.jsr.io` under the `@jsr` scope (`@jsr/std__assert` latest is 1.0.19).
- Bun 1.4.2 is installed locally (`bun --version`). The Go record pins Bun 1.4.2, revision `744846f84`.
- `.gitignore` already ignores `node_modules/`, `coverage` and `build/omp-extension/`.
- `bun test` discovers `*.spec.ts` as well as `*.test.ts`, so a bare `bun test` at the root would also run `migration/bun/**/*.spec.ts`.

## Goals / Non-Goals

**Goals:** a frozen, exact Bun dependency graph; aliases that resolve for Bun and `tsc`; scripts that replace the `deno task` entries; P0-9 x86_64 evidence for `@node-rs/jieba`.

**Non-Goals:**

- No edit to `src/`, `tests/`, `scripts/`, `skills/`, `migration/`, `Containerfile` or CI.
- No deletion of `deno.json` or `deno.lock` (deleted by `migrate-ci-and-docs-to-bun`).
- No formatter, linter or `typescript` dependency (added by `adopt-dprint-oxlint-and-tsc`).
- No attempt to make `bun test` or `tsc` pass; the tree is still Deno code.

## Decisions

### D1. `package.json`

```json
{
  "name": "air-friends",
  "version": "0.36.1",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.4.2",
  "engines": { "bun": "1.4.2" },
  "scripts": { "...": "see D4" },
  "dependencies": {
    "@agentclientprotocol/sdk": "0.14.1",
    "@node-rs/jieba": "2.0.3",
    "discord.js": "14.26.4",
    "html-to-text": "9.0.5",
    "imapflow": "1.7.8",
    "mailparser": "3.9.39",
    "misskey-js": "2026.10.0",
    "nodemailer": "7.0.13",
    "prom-client": "15.1.3",
    "ventojs": "2.2.0",
    "yaml": "<exact latest 2.x at install time>",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@std/assert": "npm:@jsr/std__assert@1.0.19",
    "@std/testing": "npm:@jsr/std__testing@1.0.18",
    "@types/bun": "<exact version matching Bun 1.4.2, else the newest 1.4.x>"
  }
}
```

`zod` is pinned because `deno.lock` resolves the SDK peer to 4.4.3 and a floating peer would change the ACP schema validation. The `@std/*` aliases keep the existing `@std/assert` and `@std/testing/time` import specifiers working unchanged (design section 6). Alternative rejected: rewriting 198 assertion imports to `bun:test` `expect`, which section 6 rules out.

### D2. `bunfig.toml`

```toml
[install]
exact = true

[install.scopes]
"@jsr" = "https://npm.jsr.io"

[test]
root = "tests"
```

`root = "tests"` keeps `migration/bun/**/*.spec.ts` out of a bare `bun test`. The 120 s timeout is passed on the command line (D4), because Bun's default is 5 s and Deno has none.

### D3. `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "types": ["bun"],
    "paths": {
      "@core/*": ["./src/core/*"],
      "@platforms/*": ["./src/platforms/*"],
      "@skills/*": ["./src/skills/*"],
      "@types/*": ["./src/types/*"],
      "@utils/*": ["./src/utils/*"],
      "@acp/*": ["./src/acp/*"]
    }
  },
  "include": ["src", "tests", "scripts", "skills"],
  "exclude": ["src/dashboard/public", "node_modules", "migration"]
}
```

The four strictness options are copied from `deno.json` `compilerOptions`. `"types": ["bun"]` is resolved through `typeRoots`, not `paths`, so the `@types/*` alias does not hide `@types/bun`; the `@types/errors.ts` scenario checks the runtime side.

### D4. Scripts

| Script | Command |
| --- | --- |
| `start` | `bun run --no-env-file --config=./bunfig.toml src/main.ts` |
| `start:config` | `bun run --no-env-file --config=./bunfig.toml src/main.ts --config` |
| `dev` | `bun run --watch --no-env-file --config=./bunfig.toml src/main.ts` |
| `test` | `bun test --timeout=120000 tests/` |
| `test:unit` | `bun test --timeout=120000 tests/acp tests/core tests/dashboard tests/platforms tests/scripts tests/skill-api tests/skills tests/types tests/utils tests/main.test.ts tests/healthcheck.test.ts` |
| `test:integration` | `bun test --timeout=120000 tests/integration` |
| `test:coverage` | `bun test --timeout=120000 --coverage --coverage-reporter=text --coverage-reporter=lcov --coverage-dir=coverage tests/` |

`--no-env-file` stops a working-directory `.env` load that Deno never performed (design section 4.5). Bun runs test files one after another in one process by default; no `--concurrent` flag is used, matching the current non-`--parallel` Deno setup. `test:unit` lists directories because Bun 1.4.2 has no `--ignore` flag; it must name every top-level entry of `tests/` except `integration`, `helpers`, `mocks` and `fixtures`. Formatting, lint, check and bundle scripts belong to later step 3 changes.

## Risks / Trade-offs

- [`@types/bun` 1.4.2 is not published] → Use the newest 1.4.x and record the version in the task report.
- [A transitive dependency resolves differently from `deno.lock`] → Only direct versions are pinned. The step 4 tests are the check; a behavior difference is fixed in the owning conversion change.
- [`--config=./bunfig.toml` is relative to the working directory] → The scripts always run from the repository root; the container uses an absolute path (`package-bun-container-image`).
