## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands. Note that `--args "--no-sandbox"` is needed for your environment.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
5. ALWAYS `agent-browser close` when done to release threads and cleanup caches

**Multi-command rule:** You may chain multiple `agent-browser` commands in ONE bash call with `;`, `&&`, or `||` only when every command is individually allowed (e.g. `agent-browser open <url> 2>&1; agent-browser get text 2>&1`). The whole call is rejected if any command is disallowed. Pipes `|`, backgrounding `&`, `2>/dev/null`, `> file`, and newline separators are always rejected — run commands separately instead.

**webfetch fallback:** If `webfetch` returns 403 or 429 (bot protection / rate limiting), switch to `agent-browser` immediately (one command per call, or `;`/`&&`/`||`-chained individually-allowed commands).
