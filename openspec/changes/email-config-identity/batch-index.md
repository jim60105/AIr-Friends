# Email proposal batch index

Complete planning batch for the approved design at `docs/superpowers/specs/2026-10-17-email-platform-design.md` (commit `12f1169`). No implementation or runtime acceptance has occurred. The source document is preserved unchanged. This index lives inside the first change so every planning commit stays strictly within one `openspec/changes/<change>/` directory.

## Apply order and estimates

All rows are separate complete changes estimated at no more than 7 hours each. Totals include implementation, tests, smoke verification, documentation and explicit contingency. They are estimates, not guarantees. Total batch estimate is 175.75 engineering hours. Applying in row order is a conservative serial topological schedule that also avoids every shared-file conflict; independent nonconflicting rows may be queued concurrently by the supervisor. No predecessor enables production email.

| Order | Change | Hours | Semantic dependencies | Capability deltas |
|---|---|---:|---|---|
| 01 | `email-config-identity` | 6.75 | none | email-identity, platform-abstraction, configuration-and-deployment |
| 02 | `email-durable-files` | 6.5 | email-config-identity | email-durable-files |
| 03 | `email-mailbox-journal` | 6.5 | email-durable-files | email-mailbox-state |
| 04 | `email-submission-journal` | 6.75 | email-durable-files | email-submission-state |
| 05 | `email-message-history` | 7 | email-config-identity, email-durable-files | email-history |
| 06 | `email-incoming-mime` | 7 | email-message-history | email-incoming-content |
| 07 | `email-incoming-auth` | 6.5 | email-config-identity, email-incoming-mime | email-incoming-authentication |
| 08 | `email-local-attachments` | 7 | email-message-history, email-incoming-mime | multimedia-messages, platform-abstraction |
| 09 | `email-imap-transport` | 7 | email-config-identity | email-imap-transport |
| 10 | `email-poll-recovery` | 7 | email-mailbox-journal, email-message-history, email-incoming-auth, email-imap-transport | email-mailbox-polling |
| 11 | `email-mime-signature` | 6.5 | email-config-identity, email-message-history, email-submission-journal | email-message-construction |
| 12 | `email-smtp-transport` | 6.75 | email-config-identity | email-smtp-transport |
| 13 | `email-submission-service` | 7 | email-submission-journal, email-mime-signature, email-smtp-transport, email-imap-transport | email-submission |
| 14 | `email-session-receipts` | 6.5 | email-mailbox-journal, email-poll-recovery | session-lifecycle |
| 15 | `email-adapter` | 7 | email-message-history, email-local-attachments, email-submission-service, email-session-receipts | platform-abstraction |
| 16 | `email-intent-runtime` | 6.75 | email-session-receipts | email-intent-runtime |
| 17 | `email-destination-grants` | 7 | email-incoming-auth, email-session-receipts, email-intent-runtime | email-destination-authorization |
| 18 | `email-compose-skill` | 6.75 | email-destination-grants, email-submission-service, email-adapter | email-outbound-composition |
| 19 | `email-forward-skill` | 6.75 | email-compose-skill, email-message-history | email-forwarding |
| 20 | `email-response-accounting` | 7 | email-forward-skill, email-submission-service, email-session-receipts | skills-and-reply |
| 21 | `email-reminder-threads` | 7 | email-adapter, email-response-accounting | scheduled-reminders |
| 22 | `email-spontaneous-targets` | 6.25 | email-adapter, email-response-accounting | spontaneous-posting |
| 23 | `email-private-observability` | 6.75 | email-response-accounting | session-audit-log |
| 24 | `email-platform-surfaces` | 6.75 | email-config-identity, email-message-history | email-platform-integration |
| 25 | `email-tool-guidance` | 6.25 | email-forward-skill, email-response-accounting, email-reminder-threads, email-spontaneous-targets | email-tool-guidance |
| 26 | `email-activation` | 6.75 | email-poll-recovery, email-submission-service, email-adapter, email-destination-grants, email-compose-skill, email-forward-skill, email-response-accounting, email-reminder-threads, email-spontaneous-targets, email-private-observability, email-platform-surfaces, email-tool-guidance | email-platform-activation |

Artifact path for every row is `openspec/changes/<change>/`, containing `.openspec.yaml`, `proposal.md`, `design.md`, `tasks.md`, and one `specs/<capability>/spec.md` for each capability shown. The apply workflow cuts its feature branch later; proposals remain shared primary-branch context. No archive or apply is part of this assignment.

## Coverage of every approved design paragraph

| Design section/lines | Owning change | Supporting completed slices | Acceptance contract |
|---|---|---|---|
| Purpose and scope L6-12 | email-activation | email-incoming-auth, email-reminder-threads, email-spontaneous-targets | one configured private mailbox; no history import, database/OAuth/multi-account/group/reply-all; existing platforms unchanged |
| Selected approach L14-20 | email-adapter | email-submission-service, email-message-history, email-compose-skill | adapter/service/store independently testable; generic reply API remains destination-free |
| Identity L24-26 | email-config-identity | email-message-history | safe canonical domain-only identity; local case/plus/dots distinct; per-user workspace |
| Thread and history L28 | email-message-history | email-adapter | wire reference relationships, unresolved references, no subject merge, conflicting IDs, owner+thread fetch |
| Ownership L30 | email-destination-grants | email-forward-skill | third-party operation retains initiating owner; routing refs confer no authority |
| Allowlist and DMARC L34-36 | email-incoming-auth | email-config-identity | enabled account independent of reply policy; attested MTA header exclusion; DMARC domain-only limitation |
| Automatic/self/failure mail L38 | email-incoming-auth | email-mime-signature | silent ignore; Auto-Submitted on outgoing |
| Reply destination L40 | email-adapter | email-incoming-auth | verified original sender only; never Reply-To/Cc/Bcc or reply-all |
| Third-party payloads L44 | email-compose-skill | email-forward-skill | explicit destination/subject/body in contained request file, source/attachments IDs |
| Authored authorization L46 | email-destination-grants | email-incoming-mime, email-intent-runtime | only current authored text; ambiguous text/address/action asks clarification |
| Session grant L48 | email-destination-grants | email-compose-skill, email-forward-skill | host-created immutable session/work/action/recipient/source grant; sender tool cannot expand |
| Accepted model risk L50 | email-destination-grants | email-intent-runtime, email-tool-guidance | model interpretation remains fallible; no model-proof security promise |
| Complete forward and minimal compose L52 | email-forward-skill | email-compose-skill, email-message-history | original body/all attachments unchanged; no automatic memory/history attachment; recipient gets no incoming permission |
| First/restart progress L56 | email-mailbox-journal | email-poll-recovery, email-imap-transport | persist first UID boundary; read-independent downtime discovery |
| UID and reconciliation L58 | email-poll-recovery | email-mailbox-journal, email-message-history | UIDVALIDITY+UID; serialized rounds; digest/identity reconciliation; ambiguous entries reviewed |
| Durable acceptance/failure L60 | email-mailbox-journal | email-poll-recovery | accept before checkpoint; isolated malformed terminal; transient connections retry next round |
| Receive crash L62 | email-session-receipts | email-mailbox-journal | unstarted resumes; agent/delivery uncertainty reviewed; no exactly-once promise |
| Bodies/provenance L66 | email-incoming-mime | email-destination-grants | plain preferred; inert HTML; ambiguous quoted source never grants |
| Limits L68 | email-incoming-mime | email-imap-transport, email-compose-skill, email-forward-skill, email-submission-service | 25 MiB raw and ten incoming parts before bytes; existing outgoing count/size limits; provider rejection explicit, no partial forward |
| Attachment/source/privacy L70 | email-local-attachments | email-message-history, email-private-observability | internal IDs; filenames metadata; permanent archive outside tmp; session-contained copies; attachment-only accepted |
| Capabilities L72 | email-adapter | email-tool-guidance | replies/files supported; edit/reaction/typing unsupported explicitly |
| Submission intent/repeated calls L76 | email-submission-journal | email-submission-service, email-response-accounting | durable host logical operation before SMTP; response loss cannot create another operation |
| Submission outcomes L78 | email-submission-service | email-smtp-transport, email-private-observability | submitted/failed/unknown distinct; unknown never auto-retries; opaque operator correlation |
| Sent copy L80 | email-submission-service | email-imap-transport, email-message-history | APPEND identical constructed MIME; failure never resends; local signed history retained/recoverable |
| Response accounting L82 | email-response-accounting | email-private-observability | third-party submission satisfies response without anchor mutation; uncertainty suppresses retry and error fallback |
| Spontaneous L86 | email-spontaneous-targets | email-config-identity | platform default off plus permitted-account opt-in; new owner thread each durable tick |
| Reminders L88 | email-reminder-threads | email-response-accounting | persist origin/anchor; current allowlist recheck; old Discord/Misskey records unchanged |
| No autonomous grants L90 | email-destination-grants | email-reminder-threads, email-spontaneous-targets | earlier grant cannot authorize reminders/spontaneous destinations |
| Signature configuration L94 | email-config-identity | email-mime-signature | literal startup multiline config; blank disables; restart required; no watcher/file |
| Signature on all paths L96 | email-mime-signature | email-adapter, email-compose-skill, email-reminder-threads, email-spontaneous-targets | central after cleanup, before MIME, newline plus standard -- SPACE separator |
| Forward/recovery signature L98 | email-mime-signature | email-forward-skill, email-submission-service | signature before original section; original signatures/bytes intact; copies/recovery reuse constructed MIME |
| Model/history signature L100 | email-tool-guidance | email-message-history, email-platform-surfaces | model does not add signature; no heuristic deletion; actual signed history/backup |
| File-only storage L104 | email-durable-files | email-mailbox-journal, email-submission-journal | JSON/JSONL and ordinary files only, no database |
| Atomic serialized durability L106 | email-durable-files | email-mailbox-journal, email-submission-journal | data/email; sibling-temp rename; flush before external effects/checkpoints; single owner |
| Journals/archive/backup L108 | email-message-history | email-mailbox-journal, email-submission-journal, email-platform-surfaces | append-only transitions, per-user archives, rebuilt memory indexes, private backups |
| Corrupt persistence L110 | email-durable-files | email-submission-journal, email-mailbox-journal | torn final line invalid; no silent intent erasure; interior/missing evidence blocks affected lane; no content logs |
| Fields/credentials L114 | email-config-identity | email-imap-transport, email-smtp-transport | disabled section and exact config table; distinct IMAP/SMTP password refs; no OAuth |
| Secure startup L116 | email-activation | email-config-identity, email-incoming-auth, email-imap-transport, email-smtp-transport | validated TLS/mandatory STARTTLS, no downgrade/verify-disable; missing authoritative config fails startup |
| Channels/config parity L118 | email-config-identity | email-private-observability | existing channels authorization separate from transport; all fields/overrides across config trio; no prompt/log secrets |
| Platform integration L120 | email-platform-surfaces | email-activation, email-private-observability, email-tool-guidance | startup/shutdown/status/validation/routing/workspace/maintenance/metrics/audit/selectors; no dashboard workflow |
| Controlled protocol verification L124 | email-imap-transport | email-smtp-transport, email-activation | real protocol-library local IMAP/SMTP smoke; deterministic credentials/ports and isolated data |
| Final implementation gate L141 | email-activation | all slices | format/lint/type/relevant regressions after complete implementation; planning runs artifact validation only |

## Consumer acceptance matrix

Each acceptance row has one accountable owner and named supporting test owners. Final activation reuses these tests and supplies only the bounded production-wiring smoke; it does not defer missing safety implementation or initial tests.

| Acceptance row | Accountable owner | Supporting changes | Required evidence |
|---|---|---|---|
| A1 L128 | email-poll-recovery | email-mailbox-journal | first activation/downtime/Seen local IMAP matrix |
| A2 L129 | email-incoming-auth | email-adapter | allowed threaded output, unauthorized/spoof/auto/self zero session and zero rejection |
| A3 L130 | email-message-history | email-local-attachments, email-adapter | subject separation, shared per-user memory, recent history isolation, forged refs |
| A4 L131 | email-destination-grants | email-compose-skill, email-forward-skill, email-intent-runtime | grant before tool, source-only destinations denied, no added recipients, clarify ambiguity |
| A5 L132 | email-forward-skill | email-local-attachments, email-incoming-mime | byte equality, filename containment, combined limits and no partial success |
| A6 L133 | email-reminder-threads | email-spontaneous-targets | restart origin anchor, allowlist recheck, opt-in/new-thread fixture |
| A7 L134 | email-response-accounting | email-submission-journal | third-party response separate anchors; retry/error dispatcher/recovery suppress duplicates |
| A8 L135 | email-submission-service | email-smtp-transport, email-submission-journal | reject/lost ACK/crash/APPEND distinct; DATA call count remains one |
| A9 L136 | email-poll-recovery | email-durable-files, email-message-history, email-submission-journal | replacement/duplicate/malformed/corrupt evidence fixtures, no replay/intent loss |
| A10 L137 | email-mime-signature | email-adapter, email-compose-skill, email-forward-skill, email-reminder-threads, email-spontaneous-targets | empty/multiline signature once for every path, original bytes/signatures intact |
| A11 L138 | email-activation | email-private-observability, email-incoming-auth, email-imap-transport, email-smtp-transport | TLS/trust fail closed; all log/audit modes contain no private sentinel |
| A12 L139 | email-platform-surfaces | email-reminder-threads, email-response-accounting | existing Discord/Misskey behavior and persisted reminders regression suite |

## Exact shared interfaces and ownership

The producer/owner below defines each interface; consumers must use it rather than a second authority. Full signatures, types and paths are repeated in each relevant design. Internal opaque IDs are never raw addresses, Message-IDs or filenames.

| Contract | Owner | Consumers and invariant |
|---|---|---|
| EmailConfig / canonical identity / channel account normalization | email-config-identity | all; e_ + SHA-256(canonical mailbox); domain lowercase only; optional config boundary, loaded disabled default |
| appendDurable / replaceSnapshot / readJournal integrity | email-durable-files | mailbox/submission/history; flush before action; damaged append prohibited, never erase evidence |
| MailboxKey / ProcessingState / accepted work | email-mailbox-journal | poller/session receipts; cursor is discovery coverage, never agent completion |
| EmailOperationKey / EmailSubmission result metadata | email-submission-journal | service/adapter/API/accounting/schedulers; host-derived slots independent of model parameters and restarted session IDs |
| EmailMessageStore / mail:<owner>:<thread> | email-message-history | parser/adapter/materializer/forward; lookup always owner+thread, source IDs internal |
| ParsedEmail / provenance authored|quoted|forwarded + ambiguity | email-incoming-mime | auth/poller/grants; whole source retained, only current unambiguous authored text may grant |
| verifiedSender / admission reason enum | email-incoming-auth | poller/adapter/grants; allowlist separate from DMARC receiver provenance |
| Local-email Attachment variant / materializeEmailAttachment | email-local-attachments | context/prompt/ACP; internal owner ref to current-session copies, network URLs keep safeFetch |
| EmailImapClient bounded UID API and appendSent | email-imap-transport | poller/service; 30s timeout, 50 UID batch, Seen irrelevant, validated TLS |
| IncomingWork / poller start-stop | email-poll-recovery | adapter/session receipts; accepted source persisted before cursor |
| EmailDraft / construct -> fixed MIME bytes,digest,historyBody | email-mime-signature | mail service; signature once, explicit envelope, original source unchanged |
| EmailSmtpClient.submit -> submitted|failed|unknown | email-smtp-transport | mail service only; no retries/delivery guarantee |
| EmailMailService.send / lookup / recover | email-submission-service | all outgoing paths; same immutable MIME for SMTP/history/APPEND, allowlist before user-target send |
| workId / durable start-completion receipt | email-session-receipts | AgentCore/orchestrator/API; started before agent prompt or side effects, explicit completion |
| EmailSendContext / adapter reply-history-file capability | email-adapter | ReplyHandler/FileHandler/dispatcher/schedulers; host context only, missing context refuses send |
| EmailIntentRuntime.interpret bounded no-tools profile | email-intent-runtime | grant producer only; both ACP backends isolated and tool-denied, no logs/credentials/history |
| DestinationGrant immutable owner/session/work/action/to/source | email-destination-grants | send-email; host producer separate from sending model, no API grant mutation |
| send-email compose request-file endpoint | email-compose-skill | forward extension and API accounting; JWT/fence, all free text incl subject/recipient in staged JSON |
| forward action/sourceRecordId | email-forward-skill | compose handler/builder; all source bytes/attachments or explicit failure |
| Email response classification / fallback suppression | email-response-accounting | all API/session/recovery/dispatcher paths; submitted responds, unknown stops retry, third-party never changes user anchor |
| ReminderEntry.origin / reminder:<id> operation | email-reminder-threads | store/handler/scheduler; owner thread+record anchor survives restart, no old grant |
| EmailSpontaneousTarget / durable tick identity | email-spontaneous-targets | adapter/scheduler/orchestrator; selected target owner/new thread, one send per tick |
| email_operation audit / sensitive execution context | email-private-observability | ACP/API/logger/operator audit; safe metadata regardless of hashContent |
| Remaining platform-union consumer inventory | email-platform-surfaces | workspace/routing/maintenance/metrics/admin/backup; no dashboard mail workflow |
| Email tool/prompt availability | email-tool-guidance | both ACP backends/modes; hidden tools still denied server-side, signature not rendered |
| Production composition / activation guard removal | email-activation | bootstrap/registry/AgentCore; all dependencies complete, recover/cleanup before ingress |

### Configuration contract

All fields below belong to `email-config-identity`; all appear in config.example.yaml, .env.example and helm/values.yaml with the same names and defaults. Credentials use existing environment/secret injection, are distinct per protocol and are excluded from agent subprocess environment. Account authorization uses existing `channels` email/account entries, never a transport credential field. `receivingAuth.attestedStripping` records operator-established MTA behavior and is not proof from header text.

| platforms.email field | Environment override | Default / validation |
|---|---|---|
| `enabled` | `EMAIL_ENABLED` | false |
| `address` | `EMAIL_ADDRESS` | required when enabled |
| `imap.host` | `EMAIL_IMAP_HOST` | required |
| `imap.port` | `EMAIL_IMAP_PORT` | 993 (tls), 143 (starttls) |
| `imap.tlsMode` | `EMAIL_IMAP_TLS_MODE` | tls; tls or starttls only |
| `imap.username` | `EMAIL_IMAP_USERNAME` | required |
| `imap.password` | `EMAIL_IMAP_PASSWORD` | required secret reference |
| `smtp.host` | `EMAIL_SMTP_HOST` | required |
| `smtp.port` | `EMAIL_SMTP_PORT` | 465 (tls), 587 (starttls) |
| `smtp.tlsMode` | `EMAIL_SMTP_TLS_MODE` | tls; tls or starttls only |
| `smtp.username` | `EMAIL_SMTP_USERNAME` | required |
| `smtp.password` | `EMAIL_SMTP_PASSWORD` | required distinct secret reference |
| `incomingFolder` | `EMAIL_INCOMING_FOLDER` | INBOX |
| `sentFolder` | `EMAIL_SENT_FOLDER` | Sent |
| `pollIntervalMs` | `EMAIL_POLL_INTERVAL_MS` | 300000; positive integer |
| `receivingAuth.authservId` | `EMAIL_AUTHSERV_ID` | required trusted receiver identity |
| `receivingAuth.attestedStripping` | `EMAIL_AUTH_HEADER_STRIPPING_ATTESTED` | false; required true when enabled |
| `maxMessageBytes` | `EMAIL_MAX_MESSAGE_BYTES` | 26214400 |
| `maxIncomingAttachments` | `EMAIL_MAX_INCOMING_ATTACHMENTS` | 10 |
| `signature` | `EMAIL_SIGNATURE` | empty; literal multiline text |
| `spontaneousPost.enabled` | `EMAIL_SPONTANEOUS_ENABLED` | false |
| `spontaneousPost.minIntervalMs` | `EMAIL_SPONTANEOUS_MIN_INTERVAL_MS` | 10800000 |
| `spontaneousPost.maxIntervalMs` | `EMAIL_SPONTANEOUS_MAX_INTERVAL_MS` | 43200000 |
| `spontaneousPost.contextFetchProbability` | `EMAIL_SPONTANEOUS_CONTEXT_FETCH_PROBABILITY` | 0.5 |

Signature is literal decoded YAML text; generic `${...}` expansion does not apply. EMAIL_SIGNATURE contains actual multiline text. No signature filename/template/watcher is added. No setting permits disabled certificate verification, plaintext authentication or opportunistic STARTTLS.

## Dependency and file-conflict matrix

Semantic dependencies appear in the order table and machine-readable `depends-on:` lines in each proposal. Shared files below are code conflicts even when changes are semantically independent. Rows absent here have no identified exact-path overlap; directory-level overlap in prompts/src/dashboard remains conservatively serialized. All implementation changes also touch their own section of `docs/email-platform.md` and CHANGELOG.md, so documentation hunks are serialized and must preserve each other. Delta requirements in the same capability require ordered reconciliation; none silently replaces another slice contract.

| Shared file/capability | Changes requiring serialization |
|---|---|
| `deno.json` | email-incoming-mime, email-imap-transport, email-mime-signature, email-smtp-transport |
| `deno.lock` | email-incoming-mime, email-imap-transport, email-mime-signature, email-smtp-transport |
| `skills/send-email/SKILL.md` | email-compose-skill, email-forward-skill, email-tool-guidance |
| `skills/send-email/scripts/send-email.ts` | email-compose-skill, email-forward-skill |
| `src/acp/client.ts` | email-intent-runtime, email-private-observability |
| `src/bootstrap.ts` | email-reminder-threads, email-activation |
| `src/core/agent-core.ts` | email-session-receipts, email-response-accounting, email-activation |
| `src/core/config-loader.ts` | email-config-identity, email-activation |
| `src/core/session-orchestrator.ts` | email-local-attachments, email-session-receipts, email-destination-grants, email-response-accounting, email-reminder-threads, email-spontaneous-targets, email-tool-guidance |
| `src/core/spontaneous-scheduler.ts` | email-config-identity, email-spontaneous-targets |
| `src/platforms/email/email-adapter.ts` | email-adapter, email-spontaneous-targets |
| `src/skill-api/server.ts` | email-compose-skill, email-response-accounting, email-private-observability |
| `src/skill-api/session-registry.ts` | email-destination-grants, email-response-accounting |
| `src/skills/email-handler.ts` | email-compose-skill, email-forward-skill |
| `src/skills/file-handler.ts` | email-adapter, email-response-accounting, email-private-observability |
| `src/skills/reply-handler.ts` | email-adapter, email-response-accounting |
| `src/skills/types.ts` | email-submission-journal, email-compose-skill |
| `src/types/events.ts` | email-config-identity, email-local-attachments |
| `src/types/platform.ts` | email-submission-journal, email-adapter |
| `tests/core/session-orchestrator.test.ts` | email-local-attachments, email-response-accounting |
| spec `platform-abstraction` | email-config-identity, email-local-attachments, email-adapter |

## Activation and uncertainty safety

Only email-activation removes the production enabled-email guard. It directly depends on every feature/safety leaf and transitively every row. Library classes are real and testable before activation; no placeholder adapter is registered. SMTP operations never retry unknown outcomes; torn or corrupt journals cannot become evidence of absence. Generic fallback dispatcher is part of the response-accounting cutover. Reminders and spontaneous activity recheck current account permission and never inherit third-party grants.

## Honest residual risks and evidence

DMARC verifies aligned domain control and cannot prove exclusive control of an allowlisted local-part. Receiver header exclusion is a real deployment prerequisite checked with a controlled forged-header injection before operator attestation. Model-authored-text interpretation can still misclassify intent or generate inappropriate content despite isolated preflight and immutable recipient grants. SMTP accepted is not delivered; exactly-once is excluded. Unknown/corrupt evidence requires manual operator review, with no automatic resend or new dashboard workflow. Deno compatibility of selected npm protocol/MIME libraries is exercised in their owning slices with real local services; implementation must rescope if that bounded choice fails rather than add an unfinished fallback.

Planning evidence consists only of artifact status, strict OpenSpec validation, artifact formatting and one whole-batch blocking duck review. Application builds/lints/tests and actual mailbox verification have not run during planning.
