# Design

## Context

Normal agent-config/opencode.json build profile explicitly allows reads, skill discovery and network tools. Denying ACP callbacks alone cannot stop those native tools.

The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Goals / Non-Goals

**Goals:** implement only the concrete complete prerequisite below and its acceptance scenarios.

**Non-Goals:** no ordinary backend policy redesign, public mode/config workflow, new mail sending path or model-proof interpretation claim.

## Decisions

Create an internal executionProfile=email-intent factory branch, never a user-selectable dashboard mode. Use an authored unique primary email-intent agent with permission {"*":"deny"} plus explicit deny keys for every shipped native read/edit/glob/grep/list/bash/task/external_directory/webfetch/websearch/lsp/skill/question/todo surface; no permissive overrides. Native denial applies before dispatch. Launch with a fresh private HOME/XDG roots and empty cwd outside any repository ancestry. Provision only the selected backend provider/model configuration (provider options/catalog and the required model API key), excluding agents, plugin, MCP, skills, instruction discovery and previous auth/session data. Use OPENCODE_CONFIG_CONTENT for the authored deny-all agent plus provider-only snapshot as the final application override. No email credentials or Skill API material exist in this profile. Confirm active ACP mode is email-intent; mismatch fails closed.

### Owned interfaces and consumers

Own createEmailIntentAgentConfig(opencode,providerSelection,temporaryRoots)->AgentConfig with profile identity, runtime mounts and deny-all client options. Add the authored asset to Containerfile next to existing OpenCode config and resolve repository/image paths explicitly; never mutate deployed ordinary config. Use official OpenCode permission/config controls documented at https://opencode.ai/docs/agents/ and https://opencode.ai/docs/config/. Only provider API authentication needed for interpretation is permitted; the no-credentials promise means no mailbox/skill credentials, not absence of model-provider authentication.

Targets: `agent-config/email-intent-opencode.json`, `src/acp/agent-factory.ts`, `src/acp/types.ts`, `Containerfile`, `tests/acp/email-opencode-profile.test.ts`, `tests/integration/email-intent/opencode-native.test.ts`. The factory/profile API is consumed by email-intent-runtime; occurrence API is consumed by email-spontaneous-targets and final activation. Only the relevant consumer applies to this change.

### Predecessors

`email-config-identity` supplies: Own EmailConfig, normalizeEmailMailbox(address)->{canonicalAddress,userId}; email channel normalization; Platform union/VALID_PLATFORMS. EmailConfig is optional at the TypeScript boundary and materialized disabled in loaded config so existing fixtures and consumers remain valid. Enabled email is rejected as activation-unavailable until the final activation change replaces that production guard, including email-only startup. No adapter or scheduler registration here. Update generic platform iteration with an absent-email guard in the same change; expanding the union must remain type-correct without rewriting existing config fixtures.

| platforms.email field                     | Environment override                          | Default / validation               |
| ----------------------------------------- | --------------------------------------------- | ---------------------------------- |
| `enabled`                                 | `EMAIL_ENABLED`                               | false                              |
| `address`                                 | `EMAIL_ADDRESS`                               | required when enabled              |
| `imap.host`                               | `EMAIL_IMAP_HOST`                             | required                           |
| `imap.port`                               | `EMAIL_IMAP_PORT`                             | 993 (tls), 143 (starttls)          |
| `imap.tlsMode`                            | `EMAIL_IMAP_TLS_MODE`                         | tls; tls or starttls only          |
| `imap.username`                           | `EMAIL_IMAP_USERNAME`                         | required                           |
| `imap.password`                           | `EMAIL_IMAP_PASSWORD`                         | required secret reference          |
| `smtp.host`                               | `EMAIL_SMTP_HOST`                             | required                           |
| `smtp.port`                               | `EMAIL_SMTP_PORT`                             | 465 (tls), 587 (starttls)          |
| `smtp.tlsMode`                            | `EMAIL_SMTP_TLS_MODE`                         | tls; tls or starttls only          |
| `smtp.username`                           | `EMAIL_SMTP_USERNAME`                         | required                           |
| `smtp.password`                           | `EMAIL_SMTP_PASSWORD`                         | required distinct secret reference |
| `incomingFolder`                          | `EMAIL_INCOMING_FOLDER`                       | INBOX                              |
| `sentFolder`                              | `EMAIL_SENT_FOLDER`                           | Sent                               |
| `pollIntervalMs`                          | `EMAIL_POLL_INTERVAL_MS`                      | 300000; positive integer           |
| `receivingAuth.authservId`                | `EMAIL_AUTHSERV_ID`                           | required trusted receiver identity |
| `receivingAuth.attestedStripping`         | `EMAIL_AUTH_HEADER_STRIPPING_ATTESTED`        | false; required true when enabled  |
| `maxMessageBytes`                         | `EMAIL_MAX_MESSAGE_BYTES`                     | 26214400                           |
| `maxIncomingAttachments`                  | `EMAIL_MAX_INCOMING_ATTACHMENTS`              | 10                                 |
| `signature`                               | `EMAIL_SIGNATURE`                             | empty; literal multiline text      |
| `spontaneousPost.enabled`                 | `EMAIL_SPONTANEOUS_ENABLED`                   | false                              |
| `spontaneousPost.minIntervalMs`           | `EMAIL_SPONTANEOUS_MIN_INTERVAL_MS`           | 10800000                           |
| `spontaneousPost.maxIntervalMs`           | `EMAIL_SPONTANEOUS_MAX_INTERVAL_MS`           | 43200000                           |
| `spontaneousPost.contextFetchProbability` | `EMAIL_SPONTANEOUS_CONTEXT_FETCH_PROBABILITY` | 0.5                                |

Only credential values use existing ${ENV_VAR} references. Signature is taken literally after YAML decoding; generic expansion MUST exclude this field. EMAIL_SIGNATURE supplies actual newlines, not a filename/template. Ports default by selected mode. Outbound attachments additionally use existing sendFile limits; no new credential/global allowlist is introduced.

### Alternatives

Prompt-only tool restrictions and ACP-only denial miss native pre-dispatch calls. Best-effort timestamps or freshly generated tick IDs cannot authorize deduplicated restarted mail. Use the existing native enforcement and durable-file mechanisms with these narrowly defined extensions instead of introducing another runtime service or database.

## Risks / Trade-offs

- Native evidence requires the selected installed executable; unavailable prerequisites are an explicit unverified/failed required gate, never a mock success claim. Model interpretation remains fallible.
- Preserve ordinary backend/scheduling behavior and isolate email-only changes. Shared factory, Containerfile and scheduler edits are serialized by the batch conflict matrix.
- The bounded estimate includes implementation plus test/smoke/docs; invalidated assumptions require rescoping before apply without hidden activation work.

## Verification design

Reuse existing OpenCode ACP lifecycle patterns and a loopback scripted provider, no paid model. Native profile acceptance must use the real installed executable and fail explicitly when mandatory prerequisites are unavailable; mocks are labeled separately.

No runtime evidence is claimed by these planning artifacts.

## Documentation

Document internal profile selection, model-provider-only provisioning and stock/development assets without adding public configuration fields. Add its owned section in docs/email-platform.md and a scoped CHANGELOG Unreleased entry during implementation.

## Migration Plan

No migrations. Apply dependencies and this complete implementation before its consumers. No predecessor enables production email; only email-activation removes the enabled-email guard. Rollback keeps email unavailable and retains private durable state for review.
