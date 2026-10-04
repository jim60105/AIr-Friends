## Why

The static review (`tmp/misskey-api-issue.md`) recommends aligning `misskey-js` with the reviewed Misskey server (2026.10.0; repo pins `npm:misskey-js@2025.12.2` in `deno.json`) and removing the `endpoint as any` / `params as any` casts in `MisskeyClient.request()`. The casts are what let the `includeReplies` typo (finding 1) survive compile-time checking: with typed endpoint dispatch, misskey-js's own endpoint parameter types reject misspelled or nonexistent request fields at build time, preventing the whole class of defect.

## What Changes

- Upgrade the `misskey-js` dependency from `npm:misskey-js@2025.12.2` to `npm:misskey-js@2026.10.0` in `deno.json`.
- Narrow `MisskeyClient.request()` from `(endpoint: string, params: Record<string, any>)` to misskey-js's typed endpoint dispatch (`api.request<endpoint, params>` generics or the typed `apis` surface), eliminating the `endpoint as any` / `params as any` casts; call sites that pass invalid parameter names or read nonexistent response fields SHALL fail type-checking.
- Replace the hand-rolled multipart `drive/files/create` upload with the SDK's own typed request now that `APIClient.request()` builds `FormData` for `requireFile` endpoints (the in-code comment claiming JSON-only support is outdated for this version), removing the duplicate request/error-handling path.

## Capabilities

### New Capabilities

（none）

### Modified Capabilities

（none — this change adds no spec-level behavior delta. All three code changes are implementation-level: a dependency version bump, type-level strictness in `MisskeyClient.request()`, and replacing the manual multipart upload with an SDK-typed call that preserves identical observable upload behavior (same endpoint, same token passing, same returned file id/url). The change's `.openspec.yaml` sets `skip_specs: true` accordingly.)

## Non-goals

- No behavior changes: parameter renames, limit clamping, DM history, thread semantics, and reaction verification belong to the other batch changes and are already merged when this lands.
- No adoption of new 2026.10.0 SDK features (chat pagination, streaming types) beyond what compiling requires.

## Batch

- depends-on: fix-misskey-api-param-correctness
- depends-on: fix-misskey-dm-history
- depends-on: fix-misskey-thread-and-reaction-semantics

Code conflicts:
- `src/platforms/misskey/misskey-client.ts` (typed `request()` + upload replacement) and `src/platforms/misskey/misskey-adapter.ts` (every `client.request(...)` call site gains typing pressure). This change MUST queue last: its typing payoff overlaps finding 1's param-name fix in `misskey-adapter.ts` (the `withReplies` rename must exist before strict typing can validate it), and it rewrites `users/notes` / reaction / emoji call sites the other three changes edit.
- `deno.json`: no other batch member touches it.
