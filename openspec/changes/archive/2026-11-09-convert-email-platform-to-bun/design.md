# Design

## Context

See `proposal.md`. This change follows the standard step 4 procedure, design D6 of `add-bun-conversion-codemod`, copied into `migration/bun/convert/README.md` with the rewrite table (D3), the high-risk symbol owners (D4) and the manual guide (D5). Read that file before starting.

Observed in this slice: 849 `Deno.` matches. Manual hotspots:

- File handles: `src/platforms/email/durable-files.ts` (`Deno.open` 3, `Deno.FsFile` 4), `mail-service.ts` (1, 2), `message-store.ts` (1, 1); `tests/platforms/email/durable-files.test.ts` (`Deno.open` 8, plus `Deno.Command` 2 and `Deno.exit` 2 for a crash child), `mailbox-store.test.ts` (1).
- `Deno.build.os !== "windows"` guards in `durable-files.ts` (6), `mail-service.ts`, `message-store.ts` become `runtimeOs() !== "windows"` through the codemod.
- Stats properties: `durable-files.ts` (16), `mail-service.ts` (1), `tests/platforms/email/durable-files.test.ts` (1).
- Test-side `Deno.serve`: `tests/core/email-privacy.test.ts`, `tests/core/email-reminder-threads.test.ts`.
- `@std/yaml` `stringify`: `tests/core/email-destination-grants-runtime.test.ts`. `FakeTime`: `tests/core/email-destination-preflight.test.ts`.
- `tests/helpers/email-imap-service.ts` and `email-smtp-service.ts` were converted by `convert-utils-platforms-and-test-support-to-bun`.

## Goals / Non-Goals

**Goals:** every file in D1 runs under Bun with the conventions of `migration/bun/convert/README.md`; every baseline test of the D1 test files has a passing or deferred Bun counterpart.

**Non-Goals:**

- No change to test names, assertions, test intent or production behavior. A test that cannot keep its name gets a `parity-exceptions.json` entry with a reason, never a silent rename.
- No edit to any file outside D1 except `migration/bun/baseline/parity-exceptions.json`.
- No port of a high-risk symbol owned by a step 5 or step 6 change (README D4). Calls to those symbols stay, and the tests that reach them fail with `ReferenceError: Deno is not defined` until the owner lands.
- No change to the email journal, receipt or durable-file formats or to their fsync ordering.

## Decisions

### D1. File list

58 files: 23 production or script files, 35 test files and 0 test helpers.

```text
src/core/email-intent-runtime.ts
src/core/email-intent-preflight.ts
src/core/email-response-accounting.ts
src/core/email-tool-policy.ts
src/platforms/email/email-identity.ts
src/platforms/email/mailbox-store.ts
src/platforms/email/submission-store.ts
src/platforms/email/incoming-mime.ts
src/platforms/email/incoming-auth.ts
src/platforms/email/imap-client.ts
src/platforms/email/smtp-client.ts
src/platforms/email/session-receipts.ts
src/platforms/email/spontaneous-store.ts
src/platforms/email/outgoing-mime.ts
src/platforms/email/mail-service.ts
src/platforms/email/mailbox-poller.ts
src/platforms/email/attachment-materializer.ts
src/platforms/email/attachment-preparation.ts
src/platforms/email/durable-files.ts
src/platforms/email/activation.ts
src/platforms/email/email-adapter.ts
src/platforms/email/message-store.ts
src/platforms/email/reply-eligibility.ts
tests/core/email-session-receipts.test.ts
tests/core/email-spontaneous-occurrences.test.ts
tests/core/email-destination-grants-runtime.test.ts
tests/core/email-destination-preflight.test.ts
tests/core/email-response-accounting.test.ts
tests/core/email-privacy.test.ts
tests/core/email-spontaneous-smoke.test.ts
tests/core/email-spontaneous.test.ts
tests/core/email-tool-guidance.test.ts
tests/core/email-bootstrap.test.ts
tests/core/email-reminder-threads.test.ts
tests/platforms/email/email-identity.test.ts
tests/platforms/email/durable-files.test.ts
tests/platforms/email/mailbox-smoke.test.ts
tests/platforms/email/mailbox-store.test.ts
tests/platforms/email/submission-smoke.test.ts
tests/platforms/email/submission-store.test.ts
tests/platforms/email/message-smoke.test.ts
tests/platforms/email/message-store.test.ts
tests/platforms/email/incoming-mime-smoke.test.ts
tests/platforms/email/incoming-mime.test.ts
tests/platforms/email/incoming-auth-smoke.test.ts
tests/platforms/email/incoming-auth.test.ts
tests/platforms/email/imap-client.test.ts
tests/platforms/email/mailbox-poller.test.ts
tests/platforms/email/outgoing-mime-smoke.test.ts
tests/platforms/email/outgoing-mime.test.ts
tests/platforms/email/smtp-client.test.ts
tests/platforms/email/smtp-transport-smoke.test.ts
tests/platforms/email/mail-service.test.ts
tests/platforms/email/submission-service-smoke.test.ts
tests/platforms/email/attachment-materializer.test.ts
tests/platforms/email/attachment-preparation.test.ts
tests/platforms/email/email-adapter.test.ts
tests/integration/email-platform.integration.test.ts
```

### D2. File handle mapping

| Deno | Bun |
| --- | --- |
| `await Deno.open(p, { write: true, createNew: true, mode })` | `await fsp.open(p, "wx", mode)` |
| `await Deno.open(p, { write: true, create: true, truncate: true, mode })` | `await fsp.open(p, "w", mode)` |
| `await Deno.open(p, { append: true, create: true })` | `await fsp.open(p, "a")` |
| `await Deno.open(p)` / `{ read: true }` | `await fsp.open(p, "r")` |
| `await Deno.open(dir)` used only for `syncSync`/`sync` of a directory | `await fsp.open(dir, "r")` then `await handle.sync()` |
| `file.write(bytes)` loop until all bytes written | `await handle.write(bytes)` (writes all bytes or throws) |
| `file.sync()` / `file.syncData()` | `handle.sync()` / `handle.datasync()` |
| `file.close()` | `await handle.close()` (keep it in the same `finally`) |
| `file.stat()` | `handle.stat()` |
| `Deno.FsFile` type | `FileHandle` from `node:fs/promises` (type import) |

Read each call site's option object and map it to the row with the same flags; any option combination not in the table is a stop-and-report.

### D3. Crash child in `durable-files.test.ts`

The test spawns a child that exits mid-write. Spawn it with `spawnSync(process.execPath, ["run", "--no-env-file", <child script>, ...args])`, and convert the child's `Deno.exit` to `process.exit`. Keep the exit codes.

### D4. Observed mappings added at apply time

The D2 table does not spell out every option combination these files use. These are
the mappings applied, each one preserving the Deno semantics exactly:

| Deno | Bun |
| --- | --- |
| `await Deno.open(p, { create: true, write: true })` on a fresh temp path (no `truncate` flag) | `await fsp.open(p, "w")` |
| `await Deno.writeFile(P, D, { create: true, mode })` | `await fsp.writeFile(P, D, { mode })` (`Deno.writeFile` already truncates; `create: true` is its default) |
| A byte array read by `fsp.readFile` and returned through a `Uint8Array` contract | `new Uint8Array(await fsp.readFile(P))` — Node returns a `Buffer`, whose runtime type is observable (JSON, deep equality) |
| `assertRejects(fn, Deno.errors.NotFound)` | `const error = await assertRejects(fn); assertEquals(isNotFoundError(error), true);` |

`FileHandle.write()` can complete partially, so the write-all loop and its
zero-progress guard are retained instead of replacing the loop with a single
`await handle.write(bytes)` as D2's one-line row suggests.

The crash child keeps the inline `-e` form already used by the other converted test
children (`spawnSync(process.execPath, ["--no-env-file", "-e", code], { cwd,
encoding: "utf8" })`) rather than a separate child script file: the child code
imports the module under test by a path relative to the repository root, so a
script outside the repository would need a rewritten import path. `--no-env-file`
keeps the child from loading dotenv files the original Deno evaluation never read.

## Design deviations (apply time)

Every edit below is outside D1 and was either pre-authorized by the standing
instructions or explicitly authorized by the supervisor.

| File | Change | Owner / authority |
| --- | --- | --- |
| `tests/helpers/email-imap-service.ts` | `getOrCreateFixtureCert` writes the key and certificate to two files under one `mkdtemp` directory (`-keyout`, `-out`) instead of `-keyout /dev/stdout`, reads both back and removes the directory in `finally`. Bun gives every child a socketpair for stdio, and opening `/dev/stdout` on a socket fails with ENXIO; Deno used pipes, which is why the Deno baseline passed. `GeneratedTlsCert` parsing and output are unchanged. | Supervisor-authorized permanent fix; the owning change `convert-utils-platforms-and-test-support-to-bun` is already archived, so no later step owns this file. |
| `src/acp/agent-factory.ts` | Swallowed-Deno class: the mechanical `Deno.*` → `node:*` sites the scoped tests reach in the email-intent profile path — `lstatSync`, `realPathSync`, `readDirSync`, `mkdirSync`, `chmodSync`, `writeTextFileSync`, `readTextFileSync`, `readLinkSync`, `symlinkSync`, `renameSync`, `Deno.env.get`, `Deno.pid`, `Deno.FileInfo` (→ `Stats`) and the `isSymlink`/`isDirectory` methods. The env/stat/readDir sites were already converted by the previous change. | `convert-acp-client-and-factory-to-bun` |
| `src/core/agent-process-pool.ts` | Swallowed-Deno class: `ensureSharedDirs`' two `Deno.mkdir` calls and `clearActivePointer`'s `Deno.readTextFile`. Without them the pool catches `ReferenceError: Deno is not defined` and reports a failed session, turning the receipt assertions into a non-deferrable failure. | `port-process-lifecycle-and-pool-to-bun` |

## Risks / Trade-offs

- [A converted test now fails for a reason other than a deferred symbol] → Fix the conversion, not the assertion. If the failure is a real Bun behavior difference, stop and report it with the failing test name; do not add an exception for a failing test.
- [A `FileHandle` is garbage-collected unclosed and Bun warns] → Every handle is closed in `finally`, as the Deno code did with `close()`.
