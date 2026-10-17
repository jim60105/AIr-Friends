# Tasks

## 1. Connect session-owned materialization

- [ ] 1.1 Wire the existing email store/materializer through activation/core composition as a session-bound preparation capability; use the authenticated workspace owner and existing canonical staging-directory helper, including Skill-API-disabled fallback.
- [ ] 1.2 Prepare session-local trigger and fetched history metadata before context formatting/budgeting and both production buildPromptContent paths; assign sessionPath only after successful staging and avoid shared-event or adapter mutation.
- [ ] 1.3 Pass the same capability through host Skill API context and stage email attachments before fetch-context/get-message serialization, including any supported search results; preserve owner/thread retrieval checks and explicit content-free failure results.

## 2. Focused regression coverage

- [ ] 2.1 Add production-path tests for attachment-only trigger, included history and both prompt paths, asserting actual staged bytes, current-session paths and trigger-only image blocks under existing size/capability policy.
- [ ] 2.2 Cover alternate retrieval, two sessions retrieving the same source, concurrent owner isolation, hostile filenames/symlink destinations, missing attachments and staging failure without opaque usable-file claims or private diagnostic leakage.
- [ ] 2.3 Cover canonical Skill API session staging and disabled-API fallback, tmp cleanup preserving archive bytes, and unchanged server-side forwarding retrieval.

## 3. Documentation and verification

- [ ] 3.1 Update docs/email-platform.md to describe production staging, alternate retrieval, trigger-only images and explicit failures while preserving archive/forwarding behavior.
- [ ] 3.2 During apply, run repository formatting, linting/type checks and the focused email/context/skill regressions; record results and validate this change strictly. Do not run implementation checks during proposal creation.
