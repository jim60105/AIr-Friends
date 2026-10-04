## Context

See proposal.md - Why. `MisskeyClient.request()` currently erases types (`endpoint as any`, `params as any`, generic `T` for the response), so every adapter call site is stringly-typed. The review verified `api.ts`/`streaming.ts` core implementations are equivalent between misskey-js 2025.12.2 and 2026.10.0, and that AIr-Friends' streaming usage (`main.mention`, `main.newChatMessage`) is unaffected by the `streaming.types.ts` deltas (Reversi `log` payloads, `NoteUpdatedEvent` reaction typing). misskey-js has built `FormData` for `requireFile` endpoints since well before 2025.12.2, making the manual multipart `drive/files/create` implementation in `misskey-client.ts` redundant duplication.

## Goals / Non-Goals

- Goals: zero `as any` in the Misskey request path; compile-time rejection of invalid endpoint names and request fields; SDK-owned upload path; dependency aligned with the reviewed server baseline.
- Non-Goals: response-side model narrowing (call sites keep their local `MisskeyNote`/`ChatMessageLite` shapes where SDK types would force unrelated churn — narrowing response types to SDK exports is pursued where it is free); behavior changes of any kind.

## Decisions

**D1: Typed generic dispatch at the wrapper boundary.** Re-shape `MisskeyClient.request()` to be generic over misskey-js's `MisskeyApi.Endpoints` keys (e.g. `request<E extends keyof MisskeyApi.Endpoints>(endpoint: E, params: MisskeyApi.Request<E>)`), forwarding to `this.api.request` without casts, and deriving the default response type from `MisskeyApi.Response<E>`. Alternative: delete the wrapper and call `client.getApi().request(...)` directly at adapter sites — rejected because the wrapper owns non-JSON/network error translation to `PlatformError` (logging + `PLATFORM_CONNECTION_FAILED`), which the adapter depends on.

**D2: Call-site response types from SDK where already compatible.** Where an adapter passes an explicit `T` (e.g. `request<MisskeyNote[]>`), keep the local interface if the SDK type would force refactors, but drop the explicit `T` where the inferred SDK response is assignment-compatible. The `myReaction` extension introduced by `fix-misskey-thread-and-reaction-semantics` maps onto the SDK's `myReaction` on `notes/show` responses, reducing custom-type surface.

**D3: SDK upload replaces manual multipart.** `MisskeyClient.uploadFile()` delegates to the SDK's typed `drive/files/create` request with a `Blob`/`File` payload; the manual `fetch` + `FormData` + `i` token implementation and its outdated "APIClient.request() only supports JSON bodies" comment are deleted. Rollback risk is low: token passing, endpoint, and returned `{ id, url }` are identical, and `send-file` behavior is spec-locked elsewhere.

**D4: Exact-version pin preserved.** Keep the pin style exact (`npm:misskey-js@2026.10.0`), matching the current exact pin of `2025.12.2`, to keep supply-chain reproducibility.

## Risks / Trade-offs

- [Typed dispatch surfaces latent type errors across ~20 adapter call sites] → That is the point; each is fixed by correcting the field or adding a narrow response mapping. Budgeted within one engineer-day because the review enumerated every call site.
- [2026.10.0 SDK streaming typing changes could break `main` channel handlers] → Review confirmed the two AIr-Friends events are unchanged; compile check is the gate.
- [SDK upload error shape differs from the manual fetch's] → Wrapper-level `PlatformError` translation is retained; `send-file` tests pin observable behavior.

## Migration Plan

1. Bump the pin, run `deno install` equivalent (`deno cache deno.json`).
2. Fix compile fallout at call sites (mechanical, guided by the compiler).
3. Replace upload implementation, run `deno task check` + full test suite.
Rollback = revert single commit (pin + code move together).

## Open Questions

（none）
