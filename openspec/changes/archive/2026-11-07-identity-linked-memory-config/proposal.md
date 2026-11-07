# Proposal

## Why

One person often talks to the bot from several platform accounts (Discord, Misskey, email), and each account has its own isolated memory workspace. Operators need a way to declare which accounts belong to the same human before any recall path can treat them as one memory population (design: `docs/superpowers/specs/2026-11-07-identity-linked-memory-design.md`, sections 3 and 4.1–4.2). This change delivers only the configuration and the lookup component; no recall path consumes it yet.

## What Changes

- New top-level config key `identities` (default `[]`): a list of `{ id, accounts }` groups.
- Account entries accept workspace keys, `{platform}/account/{id}` channel-style ids, email addresses, `email/<address>` and `email/e_<64 hex>`; all are normalized to the workspace key form `{platform}/{userId}` at load time.
- Fail-fast `ConfigError` validation: malformed shape, empty or duplicate group ids, unknown platforms, channel/timeline ids, unsafe user ids, and any account listed twice (within or across groups). Error messages name the field path and never echo the raw value, so an email address cannot leak.
- New environment override `IDENTITIES` (JSON array), parsed like `CHANNELS`.
- New read-only `IdentityRegistry` module that answers "which group is this workspace in" and "which other workspaces share its group", without touching the filesystem.
- Operator documentation for the new key and variable.

## Capabilities

### New Capabilities

- `identity-groups`: operator-declared groups of platform accounts that belong to one person, their configuration normalization/validation, and the read-only lookup of linked workspaces.

### Modified Capabilities

None. The existing `configuration-and-deployment` requirements are not changed; `identities` is specified in the new capability.

## Impact

- Code: `src/types/config.ts`, `src/core/config-loader.ts`, `src/utils/env.ts`, new `src/core/identity-registry.ts`.
- Tests: `tests/core/config-loader.test.ts`, new `tests/core/identity-registry.test.ts`.
- Docs: `config.example.yaml`, `.env.example`, `helm/values.yaml`, `docs/reference/config-schema.md`, `docs/admin/configuration.md`. Documentation wording is human-reviewed (see design.md, "Review document"); it is not a test-established requirement.
- No runtime behavior change in this change: nothing constructs the registry yet. Pre-release: no migration or compatibility layer.

## Batch:

depends-on: none

Followed by `identity-linked-memory-recall` (depends on this change) and `identity-linked-memory-patch` (depends on both). Code-conflict notes: none with in-flight changes; `src/core/config-loader.ts` and `src/utils/env.ts` are touched only by this change in the batch.
