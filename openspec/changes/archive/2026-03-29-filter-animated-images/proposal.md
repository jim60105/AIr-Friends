## Why

Animated images (GIF) sent as attachments cause the ACP agent to crash silently — the agent stops responding with no error message. This blocks conversations whenever a user shares an animated image. Filtering out animated images before sending them as image content blocks to the agent prevents this crash while preserving the text-description fallback.

## What Changes

- Add MIME type check to exclude `image/gif` from being downloaded and sent as image `ContentBlock` to the ACP agent
- GIF images will still appear as text descriptions with URLs in the prompt context (existing behavior for unsupported attachments)
- Static images continue to be sent as base64-encoded image content blocks unchanged

## Capabilities

### New Capabilities

_(none — this is a refinement of existing multimedia message handling)_

### Modified Capabilities

- `multimedia-messages`: Add animated image filtering to the image download/encode path so only static images are sent as image content blocks

## Impact

- `src/core/session-orchestrator.ts` — `buildPromptContent()` method: add MIME-based filter before image download
- Tests for the new filtering logic
- No API changes, no new dependencies, no breaking changes
