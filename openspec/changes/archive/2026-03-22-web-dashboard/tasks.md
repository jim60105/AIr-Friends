# Web Dashboard — Tasks

## 1. Configuration & Types

- [x] 1.1 Add `DashboardConfig` interface to `src/types/config.ts` (`enabled`, `port`, `passphrase`)
- [x] 1.2 Add `dashboard` field to `Config` interface in `src/types/config.ts`
- [x] 1.3 Add `DASHBOARD_ENABLED`, `DASHBOARD_PORT`, `DASHBOARD_PASSPHRASE` entries to `ENV_MAPPINGS` in `src/utils/env.ts`
- [x] 1.4 Add dashboard config defaults and validation in `src/core/config-loader.ts` (defaults: `enabled=false`, `port=8090`, `passphrase=""`; reject enabled + empty passphrase with `ConfigError`)
- [x] 1.5 Add dashboard section to `config.example.yaml`
- [x] 1.6 Add `DASHBOARD_ENABLED`, `DASHBOARD_PORT`, `DASHBOARD_PASSPHRASE` to `.env.example`

## 2. Dashboard Server Infrastructure

- [x] 2.1 Create `src/dashboard/auth.ts` — passphrase validation, session token generation (crypto.randomUUID), server-side token `Map<string, { createdAt: number }>`, cookie parsing/setting helpers (HttpOnly, SameSite=Strict)
- [x] 2.2 Create `src/dashboard/server.ts` — `DashboardServer` class with `Deno.serve()` on configured port; request router dispatching to auth, API, and static file routes; auth middleware for all routes except `POST /api/auth/login` and static login page
- [x] 2.3 Implement auth endpoints in server: `POST /api/auth/login` (validate passphrase, set cookie), `POST /api/auth/logout` (clear cookie, invalidate token), `GET /api/auth/status` (check cookie validity)
- [x] 2.4 Implement static file serving — serve `src/dashboard/public/` files at root paths; `GET /` returns `index.html`; unknown paths return 404
- [x] 2.5 Integrate dashboard server start in `src/bootstrap.ts` — start `DashboardServer` when `dashboard.enabled && dashboard.passphrase` is non-empty
- [x] 2.6 Integrate dashboard server stop in `src/shutdown.ts` — call `dashboardServer.stop()` during graceful shutdown

## 3. Session Monitor APIs

- [x] 3.1 Implement `GET /api/sessions/active` route — read from `SessionRegistry`, return JSON array with `id`, `type`, `platform`, `userId`, `channelId`, `startTime`, `status`
- [x] 3.2 Create `src/dashboard/completed-session-store.ts` — `CompletedSessionStore` class with in-memory ring buffer (max 100), `add()` and `getAll()` methods
- [x] 3.3 Hook `CompletedSessionStore.add()` in `SessionOrchestrator` at end of each session flow (capture `id`, `type`, `platform`, `userId`, `startedAt`, `endedAt`, `status`, `durationMs`)
- [x] 3.4 Implement `GET /api/sessions/history` route — return `completedSessionStore.getAll()` as JSON
- [x] 3.5 Implement `GET /api/stats` route — call `metricsRegistry.getMetricsAsJSON()`, transform to simplified JSON with `sessions_total`, `active_sessions`, `replies_sent_total`, `messages_received_total`, `memory_operations_total`, `skill_api_calls_total`
- [x] 3.6 Implement `GET /api/sessions/:id/audit` route — find and read audit JSONL file from `data/audit/`, parse lines, return JSON array; return 404 if file not found or audit disabled

## 4. Agent Workspace Browser APIs

- [x] 4.1 Implement `GET /api/workspace/tree` route — recursively walk `data/agent-workspace/`, return nested JSON tree with `name`, `path`, `type` (`file`/`directory`), `size`
- [x] 4.2 Implement `GET /api/workspace/file?path=<relative>` route — read file content; restrict to `.md` and `.txt` extensions (return 400 otherwise); return `{ path, content, size }`
- [x] 4.3 Implement path traversal protection — resolve requested path, verify it starts with canonical agent workspace path; reject absolute paths, `..` sequences, and encoded traversal (`%2F..`) with 400

## 5. Chat APIs & ACP Integration

- [x] 5.1 Implement `POST /api/chat/connect` — validate `agentType` (copilot/gemini/opencode) and `model`; create `AgentConnector`, call `connect()`, `createSession()`, `setSessionModel()`; store active chat session state; return `{ chatSessionId }`; reject if another chat session already active (409)
- [x] 5.2 Implement `POST /api/chat/message` — validate `chatSessionId`; on first message, render `system_web_chat.md` and prepend to prompt; call `connector.prompt(sessionId, content)`; return 200; return 404 for invalid session, 410 for disconnected session
- [x] 5.3 Implement `GET /api/chat/stream?chatSessionId=<id>` — SSE endpoint; stream `sessionUpdate` callbacks from `ChatbotClient` as SSE events (text content, `<think>` blocks); send `done` event on agent turn completion; send `error` event on agent failure
- [x] 5.4 Implement `POST /api/chat/disconnect` — disconnect `AgentConnector`; clear chat session state; send `disconnect` SSE event; idempotent if already disconnected
- [x] 5.5 Implement idle timeout — 10-minute `setTimeout` reset on each `POST /api/chat/message`; on fire: disconnect agent, send SSE `disconnect` event with reason `idle_timeout`, invalidate session
- [x] 5.6 Handle `navigator.sendBeacon` disconnect — ensure `POST /api/chat/disconnect` works with beacon requests (no response body expected, handle `Content-Type: text/plain` from sendBeacon)

## 6. Restart API

- [x] 6.1 Implement `POST /api/restart` — require `confirm` field in body; if `confirm: false`, return `{ activeSessionCount, warning }`; if `confirm: true`, call `Deno.kill(Deno.pid, "SIGTERM")`; return 400 if `confirm` field missing

## 7. Prompt Template

- [x] 7.1 Create `prompts/system_web_chat.md` — derive from `system_reply.md`; include character personality (`character_info.md`); include memory skill instructions; include agent workspace access; exclude recent message history, emoji guidance, and `send-reply`/`send-file`/`react-message` skill usage; set `platform` to `"web"`, `isDm` to `true`

## 8. Frontend — Layout & Auth

- [x] 8.1 Create `src/dashboard/public/index.html` — HTML shell with Tailwind CDN (`<script src="https://cdn.tailwindcss.com">`); responsive layout; tab-based navigation (Sessions, Stats, Workspace, Chat)
- [x] 8.2 Create `src/dashboard/public/style.css` — minimal custom styles beyond Tailwind utilities
- [x] 8.3 Implement login page/modal in `index.html` — passphrase input, submit to `POST /api/auth/login`, store auth state, redirect to dashboard on success
- [x] 8.4 Implement tab navigation — client-side view switching for Sessions, Stats, Workspace, Chat sections; highlight active tab

## 9. Frontend — Session Monitor & Stats

- [x] 9.1 Implement active sessions list — fetch `GET /api/sessions/active` on interval (5-10s); render table with session fields; pause polling when `document.hidden`
- [x] 9.2 Implement session history table — fetch `GET /api/sessions/history`; render table with expandable rows; clicking a row fetches `GET /api/sessions/:id/audit` and displays audit entries inline
- [x] 9.3 Implement stats dashboard — fetch `GET /api/stats` on interval; display counters and gauges (sessions total, active sessions, replies sent, messages received, memory ops, skill API calls)

## 10. Frontend — Agent Workspace Browser

- [x] 10.1 Implement directory tree view — fetch `GET /api/workspace/tree`; render collapsible tree with folder/file icons; clicking a file loads its content
- [x] 10.2 Implement file content viewer — fetch `GET /api/workspace/file?path=<path>`; display raw text content in a preformatted block

## 11. Frontend — Chat View

- [x] 11.1 Implement agent type selector (dropdown: copilot/gemini/opencode) and model input (freeform text input with datalist suggestions)
- [x] 11.2 Implement connect/disconnect buttons — Connect calls `POST /api/chat/connect`, opens `EventSource` to `/api/chat/stream`; Disconnect calls `POST /api/chat/disconnect`; update button states based on connection status
- [x] 11.3 Implement message display — render user messages and agent responses; render `<think>` blocks in a collapsible/styled container
- [x] 11.4 Implement SSE listener — `EventSource` on `/api/chat/stream?chatSessionId=<id>`; handle `message`, `done`, `error`, `disconnect` event types; append streaming text to current agent response
- [x] 11.5 Implement post-disconnect state — disable message input and send button; keep chat history visible; show "New Connection" button that clears history and returns to connect form
- [x] 11.6 Implement idle timeout notification — on SSE `disconnect` event with reason `idle_timeout`, display notification to user
- [x] 11.7 Implement `beforeunload` handler — call `navigator.sendBeacon('/api/chat/disconnect', JSON.stringify({ chatSessionId }))` if a chat session is active

## 12. Helm Chart & Container Updates

- [x] 12.1 Add `DASHBOARD_ENABLED`, `DASHBOARD_PORT`, `DASHBOARD_PASSPHRASE` to `helm/values.yaml` under `env:` section
- [x] 12.2 Create or update Helm Secret template — store `DASHBOARD_PASSPHRASE` as a Kubernetes Secret; reference via `secretKeyRef` in deployment env vars
- [x] 12.3 Update Helm deployment template — mount dashboard passphrase secret; add dashboard port to container ports
- [x] 12.4 Add `EXPOSE 8090` directive to `Containerfile` for the dashboard port

## 13. Tests

- [x] 13.1 Unit tests for `src/dashboard/auth.ts` — passphrase validation, token generation, cookie parsing, session expiry, HttpOnly/SameSite flags
- [x] 13.2 Unit tests for session monitor API routes — `GET /api/sessions/active` (empty, with sessions, requires auth), `GET /api/sessions/history` (empty, with entries, requires auth), `GET /api/stats` (returns metrics, requires auth), `GET /api/sessions/:id/audit` (valid, not found, audit disabled, requires auth)
- [x] 13.3 Unit tests for workspace browser — `GET /api/workspace/tree` (returns tree, empty workspace, requires auth), `GET /api/workspace/file` (valid file, disallowed extension returns 400, missing file returns 404, requires auth); path traversal protection (`../`, absolute paths, encoded sequences all return 400)
- [x] 13.4 Unit tests for chat session management — `POST /api/chat/connect` (success, reject duplicate, invalid agent type, requires auth), `POST /api/chat/message` (success, invalid session 404, disconnected session 410, requires auth), `POST /api/chat/disconnect` (success, idempotent, requires auth), idle timeout triggers disconnect
- [x] 13.5 Unit tests for restart API — `POST /api/restart` with `confirm: true` (sends SIGTERM), `confirm: false` (returns warning + count), missing `confirm` (returns 400), requires auth
- [x] 13.6 Unit tests for `CompletedSessionStore` — `add()` stores entries, `getAll()` returns copies, ring buffer evicts oldest at 101 entries
- [x] 13.7 Integration test for login → API access flow — login with correct passphrase, access protected endpoint with cookie, logout, verify cookie invalidated
- [x] 13.8 Config validation tests — dashboard defaults applied when section missing, reject `enabled: true` with empty passphrase, env var overrides for `DASHBOARD_ENABLED`/`DASHBOARD_PORT`/`DASHBOARD_PASSPHRASE`
