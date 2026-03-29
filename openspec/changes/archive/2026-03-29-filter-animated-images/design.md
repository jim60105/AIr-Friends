## Context

The multimedia message system currently downloads all image attachments (any MIME type starting with `image/`) and sends them as base64-encoded `ContentBlock::Image` to the ACP agent. Animated images — primarily GIFs (`image/gif`) — cause the agent to crash silently with no error message or response. The agent subprocess simply stops, leaving the session hanging until idle timeout.

The fix is a one-line change: add `&& att.mimeType !== "image/gif"` to the existing filter condition in `buildPromptContent()` in `session-orchestrator.ts` (line ~2480). Text descriptions with URLs are already included separately in context-assembler.ts, so filtered GIFs remain visible to the agent as URLs.

## Goals / Non-Goals

**Goals:**

- Prevent agent crashes caused by animated GIF images
- Filter `image/gif` by MIME type before download (zero wasted bandwidth)
- Keep the change minimal — one additional condition in the existing filter

**Non-Goals:**

- Detecting animation by inspecting image bytes
- Filtering other animated formats (WebP, APNG) — separate concern if needed later
- Changing how non-image attachments or text descriptions are handled

## Decisions

### Decision 1: Inline condition vs. constant/set

**Choice**: Add `att.mimeType !== "image/gif"` directly in the filter condition.

**Alternatives considered**:
- *`ANIMATED_IMAGE_MIME_TYPES` Set constant*: Over-engineering for a single value. Can be introduced later if more types are added.
- *Allowlist of supported types*: Overly restrictive — would reject valid formats like `image/bmp`, `image/avif`.

**Rationale**: GIF is the only confirmed problematic format. A single inline comparison is the simplest, most readable approach.

### Decision 2: Filter location

**Choice**: Add to the existing filter in `buildPromptContent()` at the `imageAttachments` filter step, alongside `isImage` and size checks.

**Rationale**: Single code path, minimal change, prevents unnecessary network requests.

## Risks / Trade-offs

- **[Risk] WebP can be animated** → Not blocked initially; most chat WebPs are static. Extend if needed.
- **[Risk] APNG uses `image/png` MIME** → Cannot filter by MIME alone. APNG is rare; out of scope.
- **[Trade-off] GIF senders lose image analysis** → Agent still sees the URL in text context.
