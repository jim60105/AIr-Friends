## Context

The dashboard's Workspace page provides a read-only file browser for the agent workspace directory (`data/agent-workspace/`). Currently, both `.md` and `.txt` files are displayed as plain text in a `<pre>` block. The agent workspace is primarily markdown-based (notes, journals, index files), so rendering markdown as formatted HTML significantly improves readability.

The dashboard is a vanilla HTML/JS application using Tailwind CSS via CDN. There are no frontend build tools or bundlers — all JS is loaded directly via `<script>` tags.

## Goals / Non-Goals

**Goals:**

- Render `.md` files as formatted HTML with proper styling (headings, lists, code blocks, links, etc.)
- Keep `.txt` files displayed as plain text in the existing `<pre>` block
- Maintain the current UI layout and visual consistency with the dark theme
- Zero backend changes — markdown rendering is purely client-side

**Non-Goals:**

- Server-side markdown rendering
- Markdown editing capabilities
- Syntax highlighting for code blocks (basic `<code>` styling is sufficient)
- Support for advanced markdown extensions (e.g., math, diagrams)
- Changes to the file tree or directory listing behavior

## Decisions

### Decision 1: Use `marked` library via CDN

**Choice:** Load `marked` (lightweight markdown parser) via CDN `<script>` tag.

**Rationale:** `marked` is a well-established, fast, pure-JavaScript markdown parser (~8KB gzipped). It requires no build step, which aligns with the dashboard's vanilla JS architecture. Alternatives considered:
- `markdown-it`: More extensible but larger (~30KB), extensibility not needed here
- `showdown`: Similar to marked but less actively maintained
- Custom parser: Unnecessary complexity for standard markdown rendering

### Decision 2: Dual content containers — `<pre>` for text, `<div>` for markdown

**Choice:** Add a new `<div id="file-content-rendered">` alongside the existing `<pre id="file-content">`. Toggle visibility based on file extension and user preference. For `.md` files, add a toggle button in the file header to switch between rendered and raw views.

**Rationale:** This cleanly separates the two display modes without complex DOM manipulation. The `<pre>` retains its monospace plain-text behavior for `.txt` files and serves as the raw view for `.md` files, while the `<div>` provides proper block-level rendering for markdown HTML output. The toggle button allows users to inspect raw markdown when rendering produces unexpected results. Using `innerHTML` on the `<div>` is acceptable here because:
- Content comes from the trusted agent workspace (files written by the bot itself)
- The dashboard is already behind authentication
- `marked` provides basic sanitization by default

### Decision 3: CSS class `prose` for markdown styling

**Choice:** Use a custom `prose`-like CSS class with styles for common markdown elements (h1-h4, p, ul, ol, code, pre, blockquote, a, hr, table).

**Rationale:** The dashboard uses a dark theme with specific color tokens. Rather than importing a full Tailwind Typography plugin (which would require build tooling), a focused set of CSS rules targeting markdown output elements provides consistent styling with minimal code.

## Risks / Trade-offs

- **[XSS from markdown content]** → Mitigated by: content is from trusted agent workspace (bot-authored files), dashboard requires authentication, and `marked` sanitizes by default. No user-uploaded content is rendered.
- **[CDN availability]** → If CDN is unreachable, markdown files fall back to plain text display. The `loadFile()` function checks if `marked` is available before attempting to render.
- **[Large file rendering performance]** → Agent workspace files are typically small markdown notes. No pagination or lazy rendering needed for the expected content size.
