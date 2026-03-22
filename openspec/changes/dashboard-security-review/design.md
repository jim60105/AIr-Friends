# Design: Dashboard Security Review

**Change**: `dashboard-security-review`
**Proposal**: [proposal.md](./proposal.md)

## Context

The web dashboard (`src/dashboard/`) exposes authentication, workspace browsing, agent chat (SSE), session monitoring, and process restart over HTTP. A security review against OWASP Top 10 identified 12 vulnerabilities spanning missing security headers, brute-force exposure on login, session tokens that never expire, multiple XSS vectors in client-side JS, timing leaks in passphrase validation, and insufficient input validation on server-side lookups. This design covers the minimal changes needed to address each finding.

## Goals / Non-Goals

### Goals

- Harden the dashboard against the 12 identified vulnerabilities
- Keep changes surgical — modify existing files, avoid new abstractions where possible
- Maintain backward compatibility (no config-breaking changes)

### Non-Goals

- Full CSRF token implementation (SameSite=Strict provides adequate mitigation for this single-origin dashboard)
- Adding a WAF or reverse-proxy-level protections
- Rewriting the auth system (e.g., switching to OAuth or JWT)
- Adding HTTPS termination (expected to be handled by reverse proxy or container orchestrator)

## Decisions

### D1: Security Headers — Global Middleware in `handleRequest()`

Add a `withSecurityHeaders(response)` helper called at the end of `handleRequest()` that sets headers on every response:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
```

**Rationale**: A single wrapper function in `server.ts` is simpler than per-route middleware and ensures no endpoint is missed. CSP `script-src 'self'` blocks inline script injection. `'unsafe-inline'` for `style-src` is needed because Tailwind utility classes are used inline.

### D2: Login Rate Limiting — In-Memory Sliding Window

Add a lightweight `LoginRateLimiter` class in `src/dashboard/auth.ts` using an in-memory sliding window per source IP:

- **Window**: 60 seconds
- **Max attempts**: 5 per window
- **Lockout**: After exceeding the limit, reject with `429 Too Many Requests` for the remainder of the window
- Track timestamps in a `Map<string, number[]>`, prune expired entries on each check

Extract client IP from `req.headers.get("x-forwarded-for")` or fall back to the remote address. No external dependencies needed.

**Rationale**: The dashboard is single-instance with low traffic; an in-memory approach is sufficient. A sliding window is simple and doesn't require timers. No config fields are added — the defaults are reasonable and can be made configurable later if needed.

### D3: Session Token Expiration — `maxAgeMs` in `SessionTokenStore`

Extend `SessionTokenStore` to accept a `maxAgeMs` constructor parameter (default: 24 hours). Modify `has()` to check `Date.now() - createdAt > maxAgeMs` and auto-delete expired tokens. Also add a `lastAccessedAt` field updated on each `has()` call for idle expiration consideration in the future.

The cookie's `Max-Age` attribute will be set to match (`maxAgeMs / 1000`), so browsers also discard the cookie on expiry.

**Rationale**: This is the smallest change to prevent indefinite token validity. A 24-hour default is practical for an admin dashboard. No new cleanup timer is needed — lazy expiration on access is sufficient given the small token count.

### D4: Timing-Safe Passphrase Comparison — `crypto.subtle.timingSafeEqual`

Replace the manual XOR loop in `validatePassphrase()` with `crypto.subtle.timingSafeEqual()` (available in Deno's Web Crypto API). Encode both strings to `Uint8Array` via `TextEncoder`, pad the shorter one to equal length before comparison, and return `false` if original lengths differ.

```typescript
export async function validatePassphrase(input: string, configured: string): Promise<boolean> {
  const enc = new TextEncoder();
  const a = enc.encode(input);
  const b = enc.encode(configured);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}
```

**Note**: This makes `validatePassphrase` async. The call site in `handleLogin()` already uses `await`, so this is a minimal change. The length check still leaks length information, but this is acceptable — an attacker learning the passphrase length is far less useful than learning character-by-character match results.

### D5: XSS Prevention — DOMPurify for Markdown Rendering

Add DOMPurify as a vendored file at `src/dashboard/public/vendor/purify.min.js` (MIT-licensed, ~15KB). Update `workspace.js` to sanitize `marked.parse()` output:

```javascript
rendered.innerHTML = DOMPurify.sanitize(marked.parse(data.content));
```

The existing `marked.use({ renderer: { html: () => "" } })` config strips raw HTML at the parser level; DOMPurify adds defense-in-depth on the rendered output.

**Rationale**: Vendored rather than CDN to respect CSP `default-src 'self'` and avoid external network dependency. The `marked` raw HTML renderer override is kept as first-line defense.

### D6: XSS Fix — Model Name Escaping in `chat.js`

The datalist population uses `innerHTML` with unescaped model names:

```javascript
datalist.innerHTML = models.map((m) => `<option value="${m}"></option>`).join("");
```

Fix by escaping with the existing `esc()` helper:

```javascript
datalist.innerHTML = models.map((m) => `<option value="${esc(m)}"></option>`).join("");
```

### D7: XSS Fix — `onclick` Attribute Injection in `workspace.js` and `sessions.js`

**workspace.js**: The `onclick="loadFile('${esc(node.path)}')"` pattern is vulnerable if `esc()` doesn't escape single quotes in attribute context. Replace with `data-path` attribute + delegated event listener:

```javascript
// In renderTree():
return `<div class="..." data-file-path="${esc(node.path)}">...`;

// Delegated listener on container:
container.addEventListener("click", (e) => {
  const target = e.target.closest("[data-file-path]");
  if (target) loadFile(target.dataset.filePath);
});
```

**sessions.js**: Same pattern for `onclick="toggleAudit(this, '${esc(s.auditSessionId || s.id)}')"`. Replace with `data-audit-id` attribute + delegated click handler on the table body.

**Rationale**: Delegated event listeners eliminate inline `onclick` entirely, removing the injection surface regardless of how `esc()` handles special characters.

### D8: SessionId Format Validation in Audit Lookups

Add a UUID format check at the top of `handleSessionAudit()`:

```typescript
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(sessionId)) {
  return this.json({ error: "Invalid session ID" }, 400);
}
```

This prevents path traversal via the `sessionId` parameter (e.g., `../../etc/passwd`) before it reaches `findAuditFile()`.

### D9: Workspace Tree Depth and Count Limits

Add `maxDepth` (default: 10) and `maxEntries` (default: 1000) parameters to `buildDirectoryTree()`. Track current depth and a mutable counter object. Stop recursion when either limit is reached.

```typescript
private async buildDirectoryTree(
  rootPath: string, currentPath: string,
  depth = 0, counter = { count: 0 },
): Promise<Record<string, unknown>> {
  if (depth > 10 || counter.count > 1000) {
    return { name: "…", path: "/", type: "truncated" };
  }
  counter.count++;
  // ... existing logic, pass depth + 1 to recursive calls
}
```

**Rationale**: Prevents DoS via deeply nested or very large workspace directories. Hardcoded limits are acceptable — the agent workspace is small by design.

### D10: Secure Cookie Flag

Modify `createSessionCookie()` to accept an optional `secure` parameter. When the dashboard is accessed over HTTPS (detectable from `req.headers.get("x-forwarded-proto") === "https"` or config), add `; Secure` to the cookie string.

Add a `dashboard.secureCookies` config field (default: `false`), overridable via `DASHBOARD_SECURE_COOKIES` env var. When `true`, the `Secure` flag is always set.

**Rationale**: The dashboard typically runs behind a reverse proxy that terminates TLS. A config flag is more reliable than request-header sniffing since the proxy may not always set `x-forwarded-proto`.

### D11: Error Message Sanitization

In the top-level `catch` block of `handleRequest()`, the response already returns a generic `"Internal server error"`. Audit all other error responses to ensure:

- `handleChatConnect` error: change `"Failed to connect to agent"` — already safe, keep as-is
- `handleStats` error: change `"Failed to fetch metrics"` — already safe
- `handleSessionAudit` re-throws on non-NotFound errors — wrap in generic `"Internal server error"` instead
- SSE error events in `handleChatMessage`: replace `error.message` with generic `"Agent processing error"`

```typescript
// In the prompt background task error handler:
this.sendSSE(session.sseController, "error", {
  message: "Agent processing error",
});
```

**Rationale**: Internal error details (stack traces, file paths) should never reach the client. Specific error messages are logged server-side for debugging.

### D12: CSRF — No Additional Action

SameSite=Strict cookies prevent cross-origin request forgery for all endpoints. The dashboard is a same-origin SPA that only makes same-origin fetch calls. Adding a CSRF token would add complexity without meaningful security improvement for this threat model.

**Documented as accepted risk**: If the cookie policy is ever relaxed from `SameSite=Strict`, CSRF tokens must be added.

## Risks / Trade-offs

| Risk | Impact | Mitigation |
|------|--------|------------|
| Rate limiter is in-memory; resets on restart | Attacker can retry after restart | Acceptable — dashboard restarts are rare; passphrase entropy is the primary defense |
| DOMPurify vendored copy may become outdated | Future sanitization bypasses not patched | Document the version and include update instructions; Dependabot cannot track vendored files |
| `validatePassphrase` length check leaks passphrase length | Minor information disclosure | Acceptable trade-off vs. complexity of fixed-length hashing; passphrase should be long enough that length alone is not useful |
| CSP `'unsafe-inline'` for styles | Weakened style injection protection | Required for Tailwind inline utilities; moving to external stylesheets is out of scope |
| Hardcoded rate limit / tree traversal constants | Not configurable without code change | These are conservative defaults for an admin-only dashboard; can be made configurable if needed later |
| Making `validatePassphrase` async | Minor API change | Only one call site (`handleLogin`), already async — no ripple effect |
