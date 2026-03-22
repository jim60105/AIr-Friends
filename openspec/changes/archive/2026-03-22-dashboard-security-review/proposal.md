## Why

The web dashboard exposes an HTTP server with authentication, file browsing, agent chat (SSE), session management, and process restart capabilities. A security review against OWASP Top 10 and OWASP API Security Top 10 has identified multiple vulnerabilities including missing security headers, no rate limiting on login, session tokens that never expire, XSS risks in client-side rendering, potential timing leaks in passphrase validation, and no CSRF protection. These issues must be addressed to harden the dashboard before broader deployment.

## What Changes

- Add global security response headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- Implement rate limiting on the login endpoint to prevent brute-force attacks
- Add server-side session token expiration (max lifetime + idle timeout)
- Fix timing-safe passphrase comparison using `crypto.subtle.timingSafeEqual`
- Sanitize markdown rendering output with DOMPurify to prevent XSS
- Escape dynamic values in HTML attribute contexts (model names, onclick handlers)
- Validate `sessionId` path parameters as UUID format before file lookups
- Add depth/count limits to workspace tree traversal
- Add `Secure` cookie flag when running behind TLS
- Improve error responses to avoid leaking internal details

## Capabilities

### New Capabilities
- `dashboard-security-hardening`: Security controls for the web dashboard including rate limiting, session expiration, security headers, input validation, and XSS prevention

### Modified Capabilities
- `web-dashboard-server`: Add security headers middleware, rate limiting on login, session expiration, input validation on path parameters, and workspace tree traversal limits
- `web-dashboard-chat`: Escape model names in datalist rendering and sanitize SSE error messages
- `web-dashboard-agent-workspace-browser`: Add DOMPurify sanitization for markdown rendering and depth limits on tree traversal
- `web-dashboard-session-monitor`: Validate sessionId format in audit file lookups

## Impact

- **Server code**: `src/dashboard/server.ts` — security headers middleware, rate limiting, input validation, error sanitization
- **Auth code**: `src/dashboard/auth.ts` — timing-safe comparison, token expiration, secure cookie flag
- **Client JS**: `src/dashboard/public/js/workspace.js`, `chat.js`, `sessions.js` — XSS fixes, DOMPurify integration
- **Dependencies**: Add DOMPurify (client-side CDN or vendored)
- **Tests**: `tests/dashboard/` — new tests for rate limiting, token expiration, input validation
- **Config**: Possible new config fields for rate limit settings and session TTL
