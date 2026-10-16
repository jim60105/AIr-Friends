## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands. Note that `--args "--no-sandbox"` is needed for your environment.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
5. ALWAYS `agent-browser close` when done to release threads and cleanup caches

{{ if !yolo -}}
**Multi-command rule:** You may chain multiple `agent-browser` commands in ONE bash call with `;`, `&&`, or `||` only when every command is individually allowed (e.g. `agent-browser open <url> 2>&1; agent-browser get text 2>&1`). The whole call is rejected if any command is disallowed, so running each command in its own call is the simplest recipe. Pipes `|`, backgrounding `&`, file redirects (`> file`, `2>/dev/null`), and newline separators are always rejected; redirecting one standard stream into another (`2>&1`, `1>&2`) writes no file and is tolerated.
{{- /if }}

**webfetch fallback:** If `webfetch` returns 403 or 429 (bot protection / rate limiting), switch to `agent-browser` immediately (one command per call, or chained `agent-browser` commands).
