# Deno-to-Bun conversion codemod

`migration/bun/convert/codemod.ts` is the shared rewrite tool for step 4 of the runtime
migration (design D6). It parses each file with the TypeScript AST, applies only the
exact call shapes in the table below, and prints one JSON line per file:

```json
{"file":"tests/example.test.ts","rewrites":12,"manual":[{"line":40,"text":"Deno.open(path)","reason":"unhandled Deno usage Deno.open"}]}
```

A refused file (name collision, parse error or non-convergence) keeps its original
content and adds a `refused` array; the process then exits `1`.

## Commands

```bash
# Rewrite the given files in place.
bun run --no-env-file migration/bun/convert/codemod.ts <file>...

# Report only; never write. Use this to size a step 4 change.
bun run --no-env-file migration/bun/convert/codemod.ts --check <file>...

# Report helper rewrites instead of importing src/ (for skills/ and other
# files that must not import application code).
bun run --no-env-file migration/bun/convert/codemod.ts --no-src-helpers <file>...

# Tool tests (run from this directory).
bun test ./codemod.spec.ts

# Whole-tree manual-work report.
bun run --no-env-file migration/bun/convert/codemod.ts --check \
  $(git ls-files 'src/*.ts' 'tests/*.ts' | grep -v '^src/dashboard/public/')
```

The exported `convertSource(text, fileName, options)` returns
`{ code, rewrites, manual, refused }`; `codemod.spec.ts` drives every table row and
every delta-spec scenario through it.

## D1. Import convention

Production and test code call `node:fs` and `node:fs/promises` through default imports,
never named imports:

```ts
import fs from "node:fs";
import fsp from "node:fs/promises";
```

Reason: tests replace functions on these shared objects (D-Context, monkeypatching).
Named imports bind at import time and would bypass the stub. Types come from
`import type { Dirent, Stats } from "node:fs";`.

`node:path` keeps named imports, mirroring the existing `@std/path` imports.

## D3. Codemod

`bun run --no-env-file migration/bun/convert/codemod.ts [--check] [--no-src-helpers] <file>...`

- Parses each file with `ts.createSourceFile` (`typescript` from the root `node_modules`). Collects text edits by node span and applies them from the end backwards. Writes the file unless `--check`.
- Prints one JSON line per file: `{ "file", "rewrites": <n>, "manual": [{ "line", "text", "reason" }] }`. Exits 1 if any file was refused (collision or parse error), else 0.
- Import insertion: add `import fs from "node:fs";`, `import fsp from "node:fs/promises";`, `import type { Dirent, Stats } from "node:fs";`, `import { test } from "bun:test";` (or extend an existing `bun:test` import), and helper imports, each only when used. Helper imports use a relative path from the file to `src/utils/fs-compat.ts` or `src/utils/runtime-platform.ts`, with the `.ts` extension. Inserted after the last existing import.
- `--no-src-helpers` (for files that must not import `src/`, such as `skills/`): every rewrite that needs a helper is reported as manual instead.
- Collision: before editing, if the file declares or imports a top-level binding named `fs`, `fsp`, `test`, or a helper it would import (from a different module), refuse the file.

Rewrite table (left: matched call shape; `P`, `D`, `O` are the original argument texts, copied verbatim):

| Deno | Bun |
| --- | --- |
| `Deno.test(N, F)` with `N` a string or template literal | `test(N, F)` |
| `Deno.test(N, { ...opts }, F)` | `test(N, F)`, or `test.skipIf(X)(N, F)` when `opts` has `ignore: X`; `sanitize*` keys dropped; any other key → manual |
| `Deno.test({ name: N, fn: F, ... })` | same as above; a method `fn() {}` / `async fn() {}` becomes `function () {}` / `async function () {}` |
| `Deno.test.ignore(...)` | `test.skip(...)` (same argument handling) |
| `Deno.test` whose function's first parameter is used as `<param>.step(` | manual: `t.step` |
| `Deno.env.get(K)` | `process.env[K]` |
| `Deno.env.set(K, V)` as an expression statement | `process.env[K] = V` |
| `Deno.env.delete(K)` as an expression statement | `delete process.env[K]` |
| `Deno.env.has(K)` | `Object.hasOwn(process.env, K)` |
| `Deno.env.toObject()` | `{ ...process.env }`, plus manual note `env values may be undefined` |
| `Deno.cwd()` / `Deno.execPath()` | `process.cwd()` / `process.execPath` |
| `Deno.readTextFile(P)` / `Deno.readTextFileSync(P)` | `fsp.readFile(P, "utf8")` / `fs.readFileSync(P, "utf8")` |
| `Deno.readFile(P)` / `Deno.readFileSync(P)` | `fsp.readFile(P)` / `fs.readFileSync(P)` |
| `Deno.writeTextFile(P, D)`, `Deno.writeFile(P, D)` (and `Sync`) | `fsp.writeFile(P, D)` / `fs.writeFileSync(P, D)` |
| … with `{ append: true }` only | `fsp.appendFile(P, D)` / `fs.appendFileSync(P, D)` |
| … with `{ mode: M }` only | `fsp.writeFile(P, D, { mode: M })` / sync |
| … with any other options | manual |
| `Deno.mkdir(P[, O])` / `Deno.mkdirSync(P[, O])` | `fsp.mkdir(P[, O])` / `fs.mkdirSync(P[, O])` |
| `Deno.remove(P, { recursive: true })` / `Sync` | `fsp.rm(P, { recursive: true })` / `fs.rmSync(P, { recursive: true })` |
| `Deno.remove(P)` / `Deno.removeSync(P)` | `removePath(P)` / `removePathSync(P)` |
| `Deno.stat`, `Deno.lstat`, `Deno.realPath`, `Deno.readLink`, `Deno.rename`, `Deno.chmod`, `Deno.copyFile`, `Deno.symlink` (two arguments) and their `Sync` forms | `fsp.stat`, `fsp.lstat`, `fsp.realpath`, `fsp.readlink`, `fsp.rename`, `fsp.chmod`, `fsp.copyFile`, `fsp.symlink` / `fs.statSync`, … `fs.symlinkSync` |
| `Deno.symlink(T, P, O)` (third argument) | same as two-argument form; third argument dropped and reported |
| `for await (const E of Deno.readDir(P))` | `for (const E of await fsp.readdir(P, { withFileTypes: true }))` |
| `Deno.readDirSync(P)` | `fs.readdirSync(P, { withFileTypes: true })` |
| `Deno.readDir(P)` anywhere else | manual |
| `Deno.makeTempDir(O)`, `Deno.makeTempDirSync(O)`, `Deno.makeTempFile(O)`, `Deno.makeTempFileSync(O)` | `makeTempDir(O)` … (helpers, same argument) |
| `E instanceof Deno.errors.NotFound` / `.AlreadyExists` / `.PermissionDenied` | `isNotFoundError(E)` / `isAlreadyExistsError(E)` / `isPermissionDeniedError(E)` |
| `Deno.build.os` / `Deno.build.arch` | `runtimeOs()` / `runtimeArch()` |
| type `Deno.FileInfo` / `Deno.DirEntry` | `Stats` / `Dirent` |
| `import { ... } from "@std/path"` | `from "node:path"`, with `SEPARATOR` → `sep as SEPARATOR`, `SEPARATOR_PATTERN` → manual, and `fromFileUrl` / `toFileUrl` moved to `import { fileURLToPath as fromFileUrl, pathToFileURL as toFileUrl } from "node:url"` |
| `import { exists } from "@std/fs"` | `import { pathExists as exists } from "<rel>/src/utils/fs-compat.ts"` |
| `import { parse, stringify } from "@std/yaml"` | `from "yaml"`; report `stringify` uses (output format differs) |
| `"ventojs/core/environment.ts"` | `"ventojs/core/environment.js"` |
| `@std/fs/copy`, `@std/flags`, anything else | manual |

Flagged patterns (reported, not rewritten): a property access `.isFile`, `.isDirectory` or `.isSymlink` not followed by `(` in a file where a `Stats`/`Dirent` rewrite happened (Deno properties become Node methods; `isSymlink` becomes `isSymbolicLink()`); `.mtime`, `.atime`, `.birthtime` compared with `null`; any `Deno.` left.

Implementation guards beyond the table (all reported, never rewritten): a local `test`
binding that would collide with `bun:test` (for example a top-level test wrapper
`function test(...) { Deno.test(...) }`) is reported for manual conversion instead of
refusing the whole file; any other `fs`/`fsp`/helper collision still refuses it. A call
whose target identifier is shadowed in the surrounding scope, a `readDirSync` result
consumed as an iterator (`.next()`), and a spread of a `Stats`/`Dirent` result are also
left for manual conversion.

## D4. High-risk symbol set

The codemod never rewrites these; they are ported by hand in the named change:

| Symbols | Owner |
| --- | --- |
| `Deno.Command`, `Deno.ChildProcess` | `adopt-bun-agent-process-boundary` (`src/acp/agent-connector.ts`), `port-process-lifecycle-and-pool-to-bun` (`src/utils/process-lifecycle.ts`), `port-command-call-sites-and-sandbox-probe-to-bun` (`git-backup-service.ts`, `git-credential-setup.ts`, `session-orchestrator.ts`, `skill-installer.ts`, `omp-version.ts`, `opencode-version.ts`, `sandbox-capabilities.ts`), `port-http-servers-to-bun-serve` (`src/healthcheck.ts`) |
| `Deno.serve`, `Deno.HttpServer`, `Deno.ServeHandlerInfo`, `Deno.kill`, `Deno.pid` in `src/dashboard/server.ts` | `port-http-servers-to-bun-serve` |
| `Deno.addSignalListener`, `Deno.removeSignalListener`, `Deno.exit`, `Deno.args`, `Deno.version` in `src/` | `port-signals-and-entrypoint-to-bun` |
| `Deno.connect`, `Deno.listen`, `Deno.Conn`, `Deno.TcpConn`, `Deno.NetAddr`, `Deno.Listener`, `Deno.resolveDns`, `Deno.listenDatagram`, `Deno.DatagramConn` in `src/` | `port-egress-proxy-and-gelf-to-node-net` |
| `Deno.dlopen`, `Deno.DynamicLibrary`, `Deno.UnsafePointer`, `Deno.UnsafePointerView` | `port-filesystem-ffi-to-bun-ffi` |
| `Deno.args`, `Deno.exit` in `skills/` | `convert-builtin-skills-to-bun` |

Any other high-risk-looking use in a `src/` file that no row above names (`Deno.pid` in `src/acp/agent-factory.ts` and `src/utils/omp-native-cache.ts`; `Deno.open`/`Deno.FsFile` in `src/utils/skill-secret.ts`, `src/skills/email-handler.ts`, `src/platforms/email/durable-files.ts`, `mail-service.ts`, `message-store.ts`) is converted by hand by the step 4 change that owns the file: `Deno.pid` → `process.pid`; `Deno.open` → `fsp.open` with the equivalent flags (`{ createNew: true, write: true }` → `"wx"`, `{ append: true }` → `"a"`, `{ read: true }` → `"r"`, `{ write: true, create: true, truncate: true }` → `"w"`) and the same `mode`; `FsFile` reads, writes, `sync()` and `close()` → the `FileHandle` methods of the same purpose.

In `tests/`, a step 4 change converts every `Deno` use in its test files by hand when the codemod reports it (tests are not high-risk modules), including `Deno.Command` (use `spawnSync`/`execFileSync` from `node:child_process` with the same `env`, `cwd` and `clearEnv` meaning: when `clearEnv: true`, pass exactly the listed `env`; otherwise pass `{ ...process.env, ...env }`).

## D5. Manual guide

Holds D1, the D3 table, D4, and the manual guide below, so step 4 to 6 changes have one reference that exists until cutover.

Manual guide:

- `t.step("x", fn)` inside `Deno.test("P", async (t) => ...)`: becomes `describe("P", () => { test("x", fn); ... })`, keeping shared setup in `beforeAll`/`afterAll` or inside each test. Bun reports the name `P > x`, matching the baseline.
- Stats and Dirent: `info.isFile` → `info.isFile()`, `isSymlink` → `isSymbolicLink()`. `mtime` is never null in Node; keep the null check only if the code also handles other sources.
- `@std/fs/copy` `copy(a, b)` → `fsp.cp(a, b, { recursive: true, force: false, errorOnExist: true })`.
- `Deno.FsFile` with `read`/`write`/`seek` → `fsp.open(path, flags)` `FileHandle` with the same offsets.
- YAML `stringify` from `yaml` quotes and wraps differently from `@std/yaml`; tests that compare exact YAML text compare parsed objects instead, unless the text itself is the behavior.
- `{ createNew: true }` in a write option object is an exclusive-create guard: port it to `fsp.writeFile(P, D, { flag: "wx", mode })` (or `fs.writeFileSync`), never to a plain write.
- A hand-constructed `Deno.errors.*` is replaced by an error carrying the same `code` (`Object.assign(new Error(message), { code: "ENOENT" })`), which is what `isNotFoundError` and friends inspect.

## D6. Standard step 4 procedure (referenced by every `convert-*` change)

1. Run the codemod on the change's file list. Fix each refused file (rename the colliding local) and rerun.
2. Work through each `manual` entry of the report using D5. Do not change test names, assertions or test intent.
3. `bun run fmt`.
4. Residual check: `grep -n 'Deno\.' <test files>` prints only comment lines; `grep -noE 'Deno\.[A-Za-z]+' <src files>` prints only D4 symbols.
5. Parity: `mkdir -p .parity && bun test --timeout=120000 --reporter=junit --reporter-outfile=.parity/junit.xml <test files>`, then `(cd migration/bun/baseline && bun run --no-env-file parity.ts --junit .parity/junit.xml --allow-deferred --scope <test file>...)` exits 0.
