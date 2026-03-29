## Why

GIF images are currently filtered out entirely from ACP agent prompts because animated GIFs cause the agent to crash. This means the agent cannot analyze or understand GIF images at all — it only sees a URL. By converting GIFs to static WebP at runtime using ImageMagick (already installed in the container), the agent can process the visual content of GIF attachments without crashing.

## What Changes

- Replace the `image/gif` exclusion filter with a GIF-to-WebP conversion step in `buildPromptContent()`
- Download the GIF, convert it to WebP using ImageMagick (`convert` CLI), save the result to `$TMPDIR`
- Send the converted WebP image as a `ContentBlock::Image` with `image/webp` MIME type
- The converted file is automatically cleaned up when the workspace tmp directory is cleared at session teardown
- If conversion fails, fall back to text-description-only (same as current GIF behavior)

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `multimedia-messages`: Replace GIF exclusion with GIF-to-WebP conversion before sending to agent

## Impact

- `src/core/session-orchestrator.ts` — `buildPromptContent()`: replace GIF filter with conversion logic
- Relies on `convert` (ImageMagick) being available in PATH (already in container)
- Converted files written to workspace `$TMPDIR` (auto-cleaned)
- No new dependencies — uses `Deno.Command` to shell out to ImageMagick
- No API changes, no breaking changes
