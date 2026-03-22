# Tasks: Dashboard Security Review

## 1. Security Headers Middleware

- [x] 1.1 Implement `withSecurityHeaders(response)` helper in `src/dashboard/server.ts` that sets CSP, X-Frame-Options, X-Content-Type-Options, and Referrer-Policy on every response
- [x] 1.2 Call `withSecurityHeaders()` at the end of `handleRequest()` so all routes (static, API, error) include the headers
- [x] 1.3 Add tests verifying all four security headers are present on static file, API, and error responses

## 2. Login Rate Limiting

- [x] 2.1 Implement `LoginRateLimiter` class in `src/dashboard/auth.ts` with sliding window per IP (5 attempts / 60s), extracting client IP from `x-forwarded-for` or remote address
- [x] 2.2 Integrate rate limiter check into `POST /api/auth/login` handler in `server.ts`, returning 429 with `Retry-After` header when exceeded
- [x] 2.3 Add tests: requests within limit processed normally, 6th request returns 429, window slides over time, per-IP isolation, non-login endpoints unaffected

## 3. Session Token Expiration

- [x] 3.1 Extend `SessionTokenStore` to store `createdAt` and `lastAccessedAt` per token, add `maxAgeMs` (default 24h) and `idleTimeoutMs` constructor parameters
- [x] 3.2 Modify `has()` to check max lifetime and idle timeout, auto-delete expired tokens, and update `lastAccessedAt` on valid access
- [x] 3.3 Set cookie `Max-Age` attribute in `createSessionCookie()` to match `maxAgeMs / 1000`
- [x] 3.4 Add tests: token expires after max lifetime, token expires after idle timeout, active usage extends idle timeout, max lifetime not extended by activity

## 4. Timing-Safe Passphrase Validation

- [x] 4.1 Replace passphrase comparison in `validatePassphrase()` with `crypto.subtle.timingSafeEqual` using `TextEncoder`, returning `false` for length mismatch
- [x] 4.2 Update `validatePassphrase` signature to async and verify call site in `handleLogin()` uses `await`
- [x] 4.3 Add tests: correct passphrase accepted, wrong passphrase rejected, different-length passphrases rejected

## 5. Secure Cookie Flag

- [x] 5.1 Add `dashboard.secureCookies` config field (default `false`) with `DASHBOARD_SECURE_COOKIES` env var override
- [x] 5.2 Modify `createSessionCookie()` to append `; Secure` when `secureCookies` is true or `x-forwarded-proto` is `https`
- [x] 5.3 Add tests: Secure flag set when config enabled or x-forwarded-proto is https, not set for plain HTTP

## 6. Error Response Sanitization

- [x] 6.1 Audit all error responses in `server.ts` and replace internal details with generic messages (especially `handleSessionAudit` re-throws and SSE error events in `handleChatMessage`)
- [x] 6.2 Replace `error.message` in SSE error events with `"Agent processing error"` or `"Connection error"`
- [x] 6.3 Add tests: 500 errors return generic message without stack traces, 401 errors do not reveal passphrase existence

## 7. SessionId Format Validation

- [x] 7.1 Add `sess_` prefix + alphanumeric regex validation (`^sess_[a-zA-Z0-9]+$`) at the top of `handleSessionAudit()` in `server.ts`, returning 400 for invalid format
- [x] 7.2 Add tests: valid `sess_abc123` accepted, path traversal rejected, slash characters rejected, missing prefix rejected, empty ID rejected

## 8. XSS Prevention — DOMPurify for Markdown

- [x] 8.1 Vendor DOMPurify (`purify.min.js`) into `src/dashboard/public/vendor/` and add `<script>` tag to workspace HTML page
- [x] 8.2 Update `workspace.js` to pass `marked.parse()` output through `DOMPurify.sanitize()` before DOM insertion
- [x] 8.3 Update CSP `script-src` to allow the vendored DOMPurify file if needed
- [x] 8.4 Add tests: script tags stripped, event handler attributes stripped, safe markdown elements preserved, javascript: URLs neutralized

## 9. XSS Prevention — Model Name Escaping in Chat

- [x] 9.1 Apply `esc()` helper to model names in datalist `innerHTML` population in `chat.js`
- [x] 9.2 Ensure SSE error messages are rendered as `textContent` (not `innerHTML`) in the chat UI
- [x] 9.3 Add tests: model name with angle brackets escaped, model name with quotes escaped, normal names render correctly

## 10. XSS Prevention — Inline onclick Removal

- [x] 10.1 Replace `onclick="loadFile('${esc(...)}')"` in `workspace.js` with `data-file-path` attribute and delegated event listener on the container
- [x] 10.2 Replace `onclick="toggleAudit(this, '${esc(...)}')"` in `sessions.js` with `data-audit-id` attribute and delegated click handler on the table body
- [x] 10.3 Verify both refactors maintain existing functionality with manual or integration testing

## 11. Workspace Tree Traversal Limits

- [x] 11.1 Add `maxDepth` (default 10) and `maxEntries` (default 1000) parameters to `buildDirectoryTree()`, stop recursion when either limit is reached
- [x] 11.2 Add tests: traversal stops at max depth, traversal stops at max entry count, normal workspace within limits returns complete tree
