## 1. Dependency bump

- [x] 1.1 In `deno.json`, bump `"misskey-js": "npm:misskey-js@2025.12.2"` to `"npm:misskey-js@2026.10.0"` and refresh the lockfile/cache; verify `deno info npm:misskey-js@2026.10.0` resolves and `deno task check` runs.

## 2. Typed request boundary

- [x] 2.1 Re-shape `MisskeyClient.request()` in `src/platforms/misskey/misskey-client.ts` to be generic over misskey-js endpoint keys with typed params and default response inference; delete the `endpoint as any` / `params as any` casts and the `deno-lint-ignore` pragmas; keep the existing non-JSON → `PLATFORM_CONNECTION_FAILED` translation; verify by grepping that no `as any` remains in `src/platforms/misskey/`.
- [x] 2.2 Fix compile fallout at every `client.request(...)` call site in `src/platforms/misskey/misskey-adapter.ts` (parameter field names, response shapes), replacing locally declared response interfaces with SDK response types where assignment-compatible; verify `deno task check` passes with zero `as any` in the Misskey platform directory.
- [x] 2.3 Add a compile-fail guard: a type test (or commented-out negative fixture documented in the test file) showing a misspelled request field (e.g. `includeReplies`) on `users/notes` does not type-check; verify by temporarily introducing the typo and confirming `deno task check` errors, then removing it. (Shipped as a live `@ts-expect-error` fixture in `tests/platforms/misskey/misskey-client.test.ts`, enforced by the type check `deno test` performs — `deno task check` only reads `src/main.ts`; the temporary-typo experiment against `deno task check` was run and the typo removed.)

## 3. SDK-owned upload

- [x] 3.1 Replace the manual multipart `fetch` implementation of `MisskeyClient.uploadFile()` with the SDK's typed `drive/files/create` call (FormData handled by the SDK); delete the outdated "only supports JSON bodies" comment; verify with the existing `send-file`/upload tests that uploads still return `{ id, url }` and attach to notes and chat messages.

## 4. Verification

- [x] 4.1 Run `deno task check`, lint, and the full test suite; verify all pass, with particular attention to Misskey adapter, upload, and streaming-handler tests (2026.10.0 streaming type changes must not affect `main.mention` / `main.newChatMessage` handlers).
