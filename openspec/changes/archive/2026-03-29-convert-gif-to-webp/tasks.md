## 1. Core Implementation

- [x] 1.1 Remove `att.mimeType !== "image/gif"` filter and add GIF-to-WebP conversion branch in `buildPromptContent()` in `src/core/session-orchestrator.ts`
- [x] 1.2 Implement `convertGifToWebp()` helper method: download GIF → save to tmpDir → run `convert input.gif[0] output.webp` via `Deno.Command` → read converted file → return base64 and `image/webp` mimeType
- [x] 1.3 Add error handling: if conversion fails, log warning and skip image (fall back to text-description-only)

## 2. Testing

- [x] 2.1 Update existing GIF exclusion test to verify GIF is now converted and sent as WebP ContentBlock (mock Deno.Command)
- [x] 2.2 Add unit test: GIF conversion failure falls back to string prompt gracefully
- [x] 2.3 Verify existing multimedia message tests still pass
