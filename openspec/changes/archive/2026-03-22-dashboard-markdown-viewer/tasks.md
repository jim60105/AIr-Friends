## 1. HTML Setup

- [x] 1.1 Add `marked` library CDN `<script>` tag to `src/dashboard/public/index.html`
- [x] 1.2 Add `<div id="file-content-rendered">` container alongside the existing `<pre id="file-content">` in the workspace file viewer area
- [x] 1.3 Add a toggle button element in the file header area for switching between rendered and raw markdown views

## 2. Markdown Rendering Logic

- [x] 2.1 Update `loadFile()` in `src/dashboard/public/js/workspace.js` to detect `.md` file extension and render content as HTML using `marked.parse()`, falling back to plain text if `marked` is unavailable
- [x] 2.2 Implement container switching: show `<div id="file-content-rendered">` and hide `<pre id="file-content">` for `.md` files, and vice versa for `.txt` files
- [x] 2.3 Implement toggle button logic: clicking toggles between rendered markdown and raw text views for `.md` files; hide toggle for `.txt` files; reset to rendered view when loading a new file

## 3. Markdown Styles

- [x] 3.1 Add CSS rules in `src/dashboard/public/style.css` for rendered markdown content (headings, paragraphs, lists, code blocks, blockquotes, links, tables, horizontal rules) consistent with the dark theme

## 4. Testing

- [x] 4.1 Verify `.md` files render as formatted HTML with proper styling by default
- [x] 4.2 Verify `.txt` files still display as plain text in monospace `<pre>` block
- [x] 4.3 Verify switching between `.md` and `.txt` files toggles containers correctly
- [x] 4.4 Verify toggle button switches between rendered and raw views for `.md` files
- [x] 4.5 Verify toggle button is hidden for `.txt` files
- [x] 4.6 Verify toggle resets to rendered view when loading a new `.md` file
- [x] 4.7 Verify fallback to plain text when `marked` library is unavailable
