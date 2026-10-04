## Context

See proposal.md - Why. `MisskeyClient.request()` currently erases types (`endpoint as any`, `params as any`, generic `T` for the response), so every adapter call site is stringly-typed. The review verified `api.ts`/`streaming.ts` core implementations are equivalent between misskey-js 2025.12.2 and 2026.10.0, and that AIr-Friends' streaming usage (`main.mention`, `main.newChatMessage`) is unaffected by the `streaming.types.ts` deltas (Reversi `log` payloads, `NoteUpdatedEvent` reaction typing). misskey-js has built `FormData` for `requireFile` endpoints since well before 2025.12.2, making the manual multipart `drive/files/create` implementation in `misskey-client.ts` redundant duplication.

## Goals / Non-Goals

- Goals: zero `as any` in the Misskey request path; compile-time rejection of invalid endpoint names and request fields; SDK-owned upload path; dependency aligned with the reviewed server baseline.
- Non-Goals: response-side model narrowing (call sites keep their local `MisskeyNote`/`ChatMessageLite` shapes where SDK types would force unrelated churn — narrowing response types to SDK exports is pursued where it is free); behavior changes of any kind.

## Decisions

**D1: Typed generic dispatch at the wrapper boundary.** `MisskeyClient.request()` is generic over misskey-js's endpoint keys — `request<E extends keyof Endpoints, P extends Endpoints[E]["req"] = Endpoints[E]["req"]>(endpoint: E, params: StrictParams<E, P>)` returning `SwitchCaseResponseType<E, P>`, with the parameters' shape governing the response type. Parameters stay a required positional, exactly as in the SDK's own overloads, so a required-parameter endpoint cannot be called without them (`request("i", {})` for the endpoints that take none). misskey-js declares `APIClient.request` as one overload per endpoint (no generic form, and no exported generic request type), so the forward to the SDK is made through a single documented assertion of that overload set's generic shape, with `this` bound to the client — the only assertion left in the request path. `StrictParams` intersects the inferred argument type with `Record<Exclude<keyof P, <endpoint request keys>>, never>`: generic inference alone does not excess-property-check a fresh object literal against a type-parameter constraint — which is exactly how the `includeReplies` typo compiled — whereas this form rejects unknown fields and keeps parameter-dependent response inference (`users/show` `{ userId }` → `UserDetailed`, `{ userIds }` → `UserDetailed[]`). Two limits follow from the mechanism and are documented on the type: it validates the set of keys rather than which optional keys belong to one variant of a union request type, and endpoints whose request type carries an index signature (the SDK's `EmptyRequest` for `i`/`emojis`) accept any key by construction. Alternative: delete the wrapper and call `client.getApi().request(...)` directly at adapter sites — rejected because the wrapper owns non-JSON/network error translation to `PlatformError` (logging + `PLATFORM_CONNECTION_FAILED`), which the adapter depends on.

**D2: Call-site response types from SDK where already compatible.** Every explicit `T` (e.g. `request<MisskeyNote[]>`) and dependency-order-typed call site is gone in favor of the inferred SDK response. The `myReaction` extension introduced by `fix-misskey-thread-and-reaction-semantics` maps onto the SDK's `myReaction` on `notes/show` responses, and `entities.Note`/`entities.ChatMessage` remain the aliases for `MisskeyNote`/`MisskeyMessage`. `ChatMessageLite` is now an SDK-derived intersection (`entities.ChatMessageLiteFor1on1` plus the optional `fromUser` the streaming payload carries) instead of a hand-written duplicate of the response shape. The only surviving explicit annotations are where inference cannot work (the ancestor walk's `parent`, whose `noteId` argument is the previous iteration's `parent.replyId`).

**D3: SDK upload replaces manual multipart, keeping status-based error classification.** `MisskeyClient.uploadFile()` delegates to the SDK's typed `drive/files/create` request with a `File` payload; the SDK appends the credential (`i`) itself and builds the multipart body for this `requireFile` endpoint, and the manual `fetch` + `FormData` + `i` token implementation with its outdated "APIClient.request() only supports JSON bodies" comment is deleted. The SDK parses the response body before it looks at the HTTP status, so an upload failure through the plain client would reach callers as a JSON `SyntaxError` or as the server's error object with the status discarded — losing the classification the pre-existing upload/send-file tests pin. Uploads therefore use a second `APIClient` whose injectable `fetch` classifies every status the SDK does not resolve itself (anything other than 200/204): 502–504 → `PLATFORM_CONNECTION_FAILED` (retryable), any other status → `PLATFORM_API_ERROR`, both carrying the status and the body text, exactly as the manual implementation did. Other endpoints keep the plain SDK client and its error shape, because the adapter's `NO_SUCH_ENDPOINT` fork fallback reads the server error body off it. Rollback risk is low: endpoint, token passing, and returned `{ id, url }` are identical, and `send-file` behavior is spec-locked elsewhere.

**D4: Exact-version pin preserved.** Keep the pin style exact (`npm:misskey-js@2026.10.0`), matching the current exact pin of `2025.12.2`, to keep supply-chain reproducibility.

## Risks / Trade-offs

- [Typed dispatch surfaces latent type errors across ~20 adapter call sites] → That is the point; each is fixed by correcting the field or adding a narrow response mapping. Budgeted within one engineer-day because the review enumerated every call site.
- [2026.10.0 SDK streaming typing changes could break `main` channel handlers] → Review confirmed the two AIr-Friends events are unchanged; compile check is the gate.
- [SDK upload error shape differs from the manual fetch's] → The upload client's `fetch` adapter reproduces the manual path's status classification (see D3), so both pre-existing upload tests (`502` → `PLATFORM_CONNECTION_FAILED`/retryable, `400` → `PLATFORM_API_ERROR`/non-retryable) pass unchanged, and a new test pins the actual multipart body (credential, name, file with filename) and the JSON error shape.

## Migration Plan

1. Bump the pin, run `deno install` equivalent (`deno cache deno.json`).
2. Fix compile fallout at call sites (mechanical, guided by the compiler).
3. Replace upload implementation, run `deno task check` + full test suite.
Rollback = revert single commit (pin + code move together).

## Open Questions

（none）
