## 1. Core Implementation

- [x] 1.1 Add `&& att.mimeType !== "image/gif"` to the `imageAttachments` filter condition in `buildPromptContent()` in `src/core/session-orchestrator.ts`

## 2. Testing

- [x] 2.1 Add unit test: GIF attachment is excluded from image content blocks
- [x] 2.2 Add unit test: PNG/JPEG attachments still produce image content blocks
- [x] 2.3 Verify existing multimedia message tests still pass
