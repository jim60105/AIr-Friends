# Tasks

## 1. Correct and pin existing skill recipes

- [x] 1.1 Update `skills/react-message/SKILL.md` to copy the exact `useAsReaction`/`<r>` value into `--emoji`. Verify separately labeled Discord `name:id` and Misskey `:name:` examples match current adapter fixtures and retain Unicode/once-only optional reaction guidance.
- [x] 1.2 Update `skills/send-file/SKILL.md` with a concrete mapping from `/work/discord/123/tmp/sess_42/file.png` to `--file-paths "tmp/sess_42/file.png"`. Verify the text rejects unnecessary root copies, distinguishes absolute caption paths, and retains nested-output and boundary-safe absolute attachment examples.
- [x] 1.3 Replace the discovered `stop_bash` references in the twelve skill documents listed in design.md and in `prompts/system_summary.md` with concise tool-neutral cancellation wording. Verify no executable stale-name reference remains, non-delivery no-retry rules remain, and no alias or non-delivery guarantee was added.

- [x] 1.4 Extend the existing skill-document gate to assert platform-labeled custom emoji recipes, exact provided-value guidance, staged-file path examples and absence of stale cancellation names. Preserve literal trusted-root/session/staging checks without copying OMP shell parameters into skill docs.
- [x] 1.5 Add a `tmp/sess_42/file.png` case to `tests/skills/file-handler.test.ts` asserting real-handler delivery of the existing nested file with no root copy. Couple reaction documentation expectations to current adapter/reaction fixtures without changing adapter behavior.

## 2. Integration acceptance

- [x] 2.1 Run the focused documentation, file-handler and relevant reaction/adapter tests once after edits. Retain traversal, symlink, quota and caption-payload safeguards, and label mocked platform evidence.
