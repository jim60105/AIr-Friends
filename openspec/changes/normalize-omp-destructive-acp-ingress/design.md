# Design

## Context

Observed source: `ChatbotClient.requestPermission()` at `src/acp/client.ts:690` routes destructive requests before ordinary writes, but `requestDestructivePermission()` derives `nativeTool` from `kind` only. Missing-kind OMP titles consequently become unsupported `edit`. `src/acp/destructive-policy.ts` already owns decode, completeness and all-target authorization; its types currently live in OMP's governance ledger.

Pinned native evidence: [ACP permission gate](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/session/acp-permission-gate.ts) exposes `getPermissionIntent()` with `Delete <path>` and `Move <from> to <to>` titles and move alias precedence `oldPath`, `path`, `from` / `newPath`, `to`, `destination`. Embedded edit inspection reports the first destructive operation only. [ACP bridge](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/modes/acp/acp-client-bridge.ts) preserves optional kind and rawInput. This is source evidence, not native execution evidence.

## Goals / Non-Goals

Normalize genuine OMP single delete/move inputs before existing shared authorization. Preserve diagnostic originals, locations, session isolation, YOLO early approval and every OpenCode decoder outcome. No extension-side session authorization API, command-parser changes, patch grammar expansion or target inference from titles.

## Decisions

1. Add `agentType?: AgentType` to `ClientConfig` as internal connector context. `AgentConnector.connect()` supplies its configured `options.agentType` after spreading client config, so request fields cannot select the decoder. Existing direct client fixtures omit the field and retain the legacy/OpenCode path. This avoids a fifth constructor overload and leaves default selection unchanged.
2. Move `DestructiveIntentInput` and `DestructiveOperation` declarations to the shared `destructive-policy.ts` owner. Update every current consumer import in the same task and remove the old declarations without a re-export. The old compatibility validators remain working until the native cutover removes their final consumers.
3. Add `normalizeOmpDestructivePermissionInput(toolCall)` in `src/acp/omp/destructive-ingress.ts`. This pure helper returns a shared intent or an unchanged unsupported/incomplete shape. The helper may use native `kind` or a case-insensitive word-boundary Delete/Move title to identify the operation, never to find a path. The string input form is parsed once if valid JSON; malformed JSON keeps the shared unparseable result. Canonical delete payload is `{path}`. Canonical move payload is `{source,destination}`. Select aliases with native nullish precedence before path validation; do not skip a present invalid higher-precedence value to grant a lower one.
4. Accept only the native single-operation field vocabulary (`path` for delete; the documented move aliases for move). Fields representing `edits`, `operations`, patch text or further operations remain unsupported even under a Delete/Move title. Do not discard unknown mutation-bearing fields to turn a larger request into a single operation. Native raw inputs carrying unsupported extras retain the shared denial.
5. Serialize the canonical payload once and use that identical string as both `rawInput` and `executionInputBinding`; no request-supplied `operations` or parser-provenance field is accepted. Pass original ACP locations to the existing session path expansion, `normalizeDestructiveIntent()` and all-target authorization. No location is added for a missing endpoint.
6. Original request values stay in logging/audit diagnostics. Canonical intent is used only for policy decoding and binding. OpenCode and omitted-type clients continue the existing exact decode path, including unsupported edit/apply_patch outcomes.

## Risks / Trade-offs

First-operation native edit titles can resemble single delete/move requests. The complete raw-field guard avoids accepting a partial patch. Native locations are absolute while arguments can be relative; the existing shared session resolver supplies matching spellings. Permanent tests exercise permission responses and absence of rejected mutation, rather than serialized helper output alone.

## Migration Plan

Deploy source and fixtures together. This proposal is independently useful for ACP permission requests even while the old extension remains; it does not claim that old extension admission is fixed. No data migration or compatibility shim. Reverting this unit restores its previous decoder without changing configuration.
