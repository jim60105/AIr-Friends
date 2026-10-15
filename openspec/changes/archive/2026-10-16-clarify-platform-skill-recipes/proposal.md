# Proposal

## Why

The reaction skill names `useAsReaction` yet illustrates only Misskey syntax, while Discord supplies `name:id`. The file skill lacks a session-staged image example, leaving agents to reconsider valid nested paths or copy files to the workspace root.

## What Changes

- Document copying the exact platform-provided reaction value, including the rendered `<r>` field, with separate Discord and Misskey examples and unchanged Unicode usage.
- Show an existing `tmp/<sessionId>/file.png` passed directly to `--file-paths`, distinguish attachment paths from absolute caption-payload paths, and state that root-level copies are unnecessary.
- Remove the stale `stop_bash` name from bundled skill instructions and the summary template. Use tool-neutral cancellation wording without introducing aliases or repeating OMP shell guidance.
- Add documentation contract tests tied to current adapter values, nested workspace resolution and the published instruction surfaces.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `skills-and-reply`: Actionable skill-owned reaction and attachment recipes, plus portable cancellation instructions.

## Impact

One engineer-day of documentation and focused tests. Primary owners are `skills/react-message/SKILL.md` and `skills/send-file/SKILL.md`; the cancellation-name sweep also covers existing `stop_bash` occurrences in other `skills/*/SKILL.md` files and `prompts/system_summary.md`. Adapters, file validation, quotas and script arguments remain unchanged. Existing OMP shell guidance in `prompts/agent_permissions.md` remains the sole owner of OMP execution parameters.

## Batch:

No prerequisite changes.

Code-conflict notes: `clarify-delivery-recovery-guidance` also edits send-reply/send-file instructions and documentation tests, so apply it after this change. The gathering and OMP logging changes have no planned code conflict with this change.
