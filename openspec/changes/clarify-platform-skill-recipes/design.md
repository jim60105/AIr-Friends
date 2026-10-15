# Design

## Context

See [proposal.md](proposal.md) and [the delta](specs/skills-and-reply/spec.md). `DiscordAdapter.fetchEmojis` emits `useAsReaction: name:id` for guild and application emojis, with separate static/animated `useInText` markup. `MisskeyAdapter.fetchEmojis` emits `:name:` for both fields. `ContextAssembler.formatEmojiSection` presents the reaction value inside `<r>`. `ReactionHandler` forwards `params.emoji` unchanged, and Discord calls `message.react(emoji)` directly.

`FileHandler` resolves each attachment as `resolve(context.workspace.path, filePath)`, then applies lexical and real-path containment. Existing absolute attachment paths inside the workspace or agent-workspace are accepted. Caption payloads use the separate session-scoped payload helper. `send-file/SKILL.md` describes relative root paths, but its examples do not show `tmp/<sessionId>/file.png`.

The supplied trace records reaction-format reconsideration at 22:05:48 and 22:17:57, and nested-path reconsideration at 22:16:30 followed by an unnecessary root-level image copy. Both workflows used YOLO. Permission-gate changes would address a different problem.

## Goals / Non-Goals

Keep operation-specific recipes in their existing SKILL.md owners and retain native discovery. Do not add emoji conversion, path rewriting, new flags, file copying, wrappers or global prompt instruction copies. Keep deployment-resolved script roots and literal staging/session values unchanged.

## Decisions

### Illustrate actual adapter inputs

Replace the single unqualified custom emoji example with labeled Discord `wave:123456789012345678` and Misskey `:wave:` examples. Explain that both copy the actual supplied `useAsReaction` or `<r>` value. Keep the Unicode example and optional once-only rule. Platform-provided values avoid asking the model to reconstruct delimiters or IDs; no adapter normalization is needed.

The platform's restrictions and reaction verification behavior remain unchanged. The instructions do not promise that every listed custom emoji can be used by every account.

### Show the attachment and caption paths together

Use one concrete session fixture (`sess_42`) to map `/work/discord/123/tmp/sess_42/file.png` to `--file-paths "tmp/sess_42/file.png"`. State that an existing nested workspace file can be sent in place, without a root-level copy. Use the existing trusted-root placeholder and literal-session instructions for the executable. Preserve a caption example anchored to the rendered absolute staging directory.

Do not replace all examples with tmp paths, which could imply an attachment-staging requirement absent from the handler. Retain a normal nested output example and the current boundary/error instructions. No boundary is relaxed and no accepted absolute form is removed.

### Remove stale cancellation names without creating another tool reference

The discovered `stop_bash` occurrences are in cancel-reminder, fetch-context, list-reminders, memory-export, memory-patch, memory-save, memory-search, memory-stats, react-message, send-file, send-reply and set-reminder documents, plus `system_summary.md`. Replace that name with concise tool-neutral wording for documented running-command cancellation when available. Preserve existing timeout/no-retry clauses on non-delivery operations. Cancellation itself does not establish delivery outcome.

OMP shell parameters already have a canonical owner in `agent_permissions.md`, committed as `101ad6c`. Leave that fragment and the shared system override unchanged. Do not replace `stop_bash` with a guessed alias, process API or broad inline OMP tutorial. The subsequent recovery change owns revisions to send-reply's failure policy.

### Reuse contract-test patterns

Extend `tests/skills/skill-docs-token-gate.test.ts` with targeted documentation assertions instead of adding a new parser framework. Couple the documented Discord/Misskey values to existing adapter/reaction fixtures, and add a nested `tmp/sess_42/file.png` case to `tests/skills/file-handler.test.ts` that invokes the real handler on that file without a root copy. Reuse traversal, symlink, caption-payload and quota coverage rather than duplicating it.

## Risks / Trade-offs

Example IDs can be mistaken for live emoji IDs. Label them as fixtures and direct exact substitution from supplied context. Tool-neutral cancellation wording is less prescriptive, but avoids unsupported tool names on either agent. Documentation tests demonstrate recipe consistency with mocked adapters and real path handling; they do not prove public-platform delivery or model behavior.
