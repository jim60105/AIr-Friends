## Context

GIF images are currently excluded from ACP agent image prompts (the `att.mimeType !== "image/gif"` filter in `buildPromptContent()`). The agent only sees a text URL description for GIFs. ImageMagick (`convert`) is already installed in the container and can convert GIF to WebP. The workspace `$TMPDIR` is auto-cleaned at session teardown via `cleanupWorkspaceTmp()`, which removes it when no other active sessions share the workspace.

The conversion step fits naturally into the existing `buildPromptContent()` method, right after the image download and before the base64 encoding.

## Goals / Non-Goals

**Goals:**

- Convert GIF images to static WebP so the agent can process their visual content
- Use ImageMagick `convert` already available in the container
- Store converted files in workspace `$TMPDIR` for automatic cleanup
- Gracefully fall back to text-description-only if conversion fails

**Non-Goals:**

- Converting other animated formats (APNG, animated WebP)
- Preserving GIF animation frames (only first frame / static conversion)
- Adding ImageMagick as a new dependency (it's already in the container)
- Configurable conversion parameters

## Decisions

### Decision 1: Conversion tool

**Choice**: ImageMagick `convert` via `Deno.Command`.

**Alternatives considered**:
- *Sharp/libvips via npm*: Would add a native dependency; ImageMagick is already installed.
- *Deno FFI to libwebp*: Complex, fragile, unnecessary when CLI tool is available.
- *ffmpeg*: Also installed in container but ImageMagick is simpler for single-frame image conversion.

**Rationale**: Zero new dependencies. `convert input.gif[0] output.webp` extracts the first frame and converts to WebP in one command.

### Decision 2: Conversion location in code

**Choice**: Inside `buildPromptContent()`, after downloading the GIF and before base64 encoding. Instead of skipping GIFs, download them, convert, then read the converted WebP file.

**Rationale**: Keeps all image processing in one method. The GIF filter condition (`att.mimeType !== "image/gif"`) is replaced with a conversion branch.

### Decision 3: Temp file naming

**Choice**: Use `${tmpDir}/${att.id}.webp` where `tmpDir` is the workspace tmp path.

**Rationale**: `att.id` is unique per attachment. The workspace tmp is auto-cleaned at session teardown.

### Decision 4: Error handling

**Choice**: If `convert` fails (non-zero exit, missing binary, etc.), log a warning and skip the image (fall back to text-description-only, same as current behavior).

**Rationale**: Conversion failure should never crash the session. The text description with URL is already in context.

## Risks / Trade-offs

- **[Risk] ImageMagick not available outside container** → Mitigation: Conversion is best-effort; falls back gracefully. Development environments without ImageMagick will behave like current GIF filtering.
- **[Risk] Large GIF files slow down conversion** → Mitigation: The existing 20MB size limit and 10s download timeout apply before conversion. Conversion of a single frame is fast (sub-second for typical GIFs).
- **[Risk] `convert` command name conflicts with Windows** → Mitigation: Container is Linux-only. Use `magick convert` as fallback if needed in the future.
- **[Trade-off] Only first frame is preserved** → Acceptable; the agent needs visual context, not animation.
