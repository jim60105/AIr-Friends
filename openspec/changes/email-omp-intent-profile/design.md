# Design

## Context

Normal OMP YAML allows mapped native read/search tools; capability callback returns continue for mapped names. Native OMP loads authored models from HOME and extension from its generated ESM bundle.

The approved source is `docs/superpowers/specs/2026-10-17-email-platform-design.md` at commit `12f1169`. This is planning only. Pre-release, single bot/mailbox owner; no database, migration, OAuth, account linking, reply-all, public mail service or new dashboard workflow. Estimates are engineering estimates, not delivery guarantees. All implementation/tests/docs for this responsibility are included below; named predecessors supply their completed concrete contracts.

## Goals / Non-Goals

**Goals:** implement only the concrete complete prerequisite below and its acceptance scenarios.

**Non-Goals:** no ordinary backend policy redesign, public mode/config workflow, new mail sending path or model-proof interpretation claim.

## Decisions

Add authored email-intent.yml with skills disabled, native exact-name deny entries for known tools and no normal restricted allow entries. Use the existing pinned synchronous api.on("tool_call") hook to unconditionally return {block:true,reason:safeCode} for every name under a host-only intent-profile flag fixed by the factory; ordinary restricted callback remains unchanged. This closes known and unknown native dispatch even without an ACP permission callback. Reuse the existing generated ESM entry and frozen bundler; no second bundle, generated OMP YAML or runtime fallback. Factory selects --config resolved email-intent.yml and --trusted-extension existing generated entry, with intent flag, private HOME/XDG/cwd and no user mounts/Skill JWT directory. Copy only deployment-authored models.yml bytes into isolated HOME and pass the selected provider API credential; do not copy auth databases, agents/skills/extensions or mailbox credentials.

### Owned interfaces and consumers

Own createEmailIntentAgentConfig(omp,providerSelection,temporaryRoots)->AgentConfig and deny-all extension branch. Use existing resolveOmpConfigPath and COPY the new authored YAML into /opt/air/omp/config; missing generated extension/settings/model prerequisites fail before launch. Private HOME model-file copy preserves authored bytes and provider catalog rather than generating or rewriting YAML. Internal execution profile is separate from normal restricted/native-yolo permission modes. Reuse native runtime payload provisioning from the normal factory. The flag is host-generated, never a prompt/tool request or public ENV_MAPPINGS field.

Targets: `agent-config/omp/email-intent.yml`, `src/acp/agent-factory.ts`, `src/acp/types.ts`, `src/acp/omp/extension/index.ts`, `src/acp/omp/extension/native-registration.ts`, `src/utils/omp-paths.ts`, `Containerfile`, `tests/acp/email-omp-profile.test.ts`, `tests/integration/email-intent/omp-native.test.ts`. The factory/profile API is consumed by email-intent-runtime; occurrence API is consumed by email-spontaneous-targets and final activation. Only the relevant consumer applies to this change.

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

Reuse tests/integration/omp-native-runtime native executable, authored fixture models and loopback scripted provider, including a malicious tool exposure fixture. Assert actual native tool-result denial and unchanged filesystem/network sentinels, not only callback mocks.

No runtime evidence is claimed by these planning artifacts.

## Documentation

Document the internal intent flag/profile and required authored model/settings/generated bundle deployment without a new public setting. Add its owned section in docs/email-platform.md and a scoped CHANGELOG Unreleased entry during implementation.

## Migration Plan

No migrations. Apply dependencies and this complete implementation before its consumers. No predecessor enables production email; only email-activation removes the enabled-email guard. Rollback keeps email unavailable and retains private durable state for review.
