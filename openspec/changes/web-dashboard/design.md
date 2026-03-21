# Web Dashboard — Design

## Context

AIr-Friends is an ACP Client bot that currently has no visual UI for operators to monitor sessions, browse agent workspace files, or interact with the agent directly. Operators rely on log output, Prometheus metric scraping, and CLI tools.

Two HTTP servers already exist in the codebase:

- **HealthCheckServer** (`src/healthcheck.ts`) — Listens on port 8080, serves `/health`, `/healthz`, `/ready`, `/readyz`, and optionally `/metrics` (Prometheus exposition format). Uses `Deno.serve()` with a simple `handleRequest(request)` dispatch pattern. Designed to stay lightweight for Kubernetes liveness/readiness probes.
- **SkillAPIServer** (`src/skill-api/server.ts`) — Listens on `localhost:3001`, handles `POST /api/skill/{skill-name}` requests from shell-based skills executing inside ACP agent subprocesses. Uses session-based authentication via `SessionRegistry`.

Rich Prometheus metrics are already available via a dedicated `prom-client` Registry (`src/utils/metrics.ts`), exposing counters (sessions total, messages received, replies sent, memory operations, skill API calls, rate limit rejections, audit entries, idle timeouts), histograms (session duration), and gauges (active sessions, skill readiness).

The `SessionRegistry` (`src/skill-api/session-registry.ts`) tracks all active ACP sessions in-memory with metadata including platform, channel, user, workspace, start time, reply state, and audit writer references.

The agent workspace lives at `data/agent-workspace/` and contains markdown-based knowledge notes and daily journal entries that the agent maintains autonomously.

## Goals / Non-Goals

### Goals

- Provide a web UI for **real-time session monitoring** (active sessions) and **historical session browsing** (recently completed sessions)
- Display **aggregated statistics** sourced from the existing `prom-client` Prometheus metrics registry (sessions total, replies sent, memory operations, active sessions, etc.)
- **Browse agent workspace files** (read-only) — view directory tree and file contents for `data/agent-workspace/`
- **Interactive chat with ACP agent** — full session lifecycle: connect, exchange messages, view `<think>` blocks, disconnect, with agent type and model selection
- **Simple passphrase-based authentication** — single passphrase configured via YAML config or environment variable
- **Process restart capability** — graceful restart via SIGTERM to self, relying on container orchestrator for respawn
- **Responsive frontend** built with pure JavaScript (ES6+) and Tailwind CSS via CDN — no build step, no SPA framework

### Non-Goals

- User management / multi-user RBAC — single-operator use case only
- Persistent chat history across server restarts — in-memory only for v1
- Modifying agent workspace files from the dashboard — read-only browsing
- Replacing Prometheus/Grafana for detailed metrics analysis — dashboard shows summary stats only
- WebSocket for real-time updates — use polling initially; SSE only for chat streaming

## Decisions

### 1. Separate HTTP server on dedicated port (default 8090)

**Decision**: Create a new `DashboardServer` class on its own port rather than extending `HealthCheckServer`.

**Rationale**:
- Separation of concerns — healthcheck stays lightweight and purpose-built for Kubernetes liveness/readiness probes
- Dashboard can be independently enabled/disabled without affecting health checks
- Auth middleware is only needed on dashboard; healthcheck must remain unauthenticated for k8s probe access
- Follows the existing pattern: HealthCheckServer (port 8080) and SkillAPIServer (port 3001) are already separate servers

**Alternative rejected**: Extend HealthCheckServer with dashboard routes — rejected because it would add auth middleware complexity to a server that k8s probes depend on being simple and unauthenticated.

### 2. Server-side rendered HTML + Tailwind CDN + vanilla JS

**Decision**: Serve HTML pages with inline or co-located JavaScript. Use Tailwind CSS via CDN play script tag. No SPA framework, no build step.

**Rationale**:
- Matches the project's no-framework, no-build-step philosophy
- Simple deployment: HTML/JS/CSS served directly by `Deno.serve()` from `src/dashboard/public/` directory
- Tailwind CDN play script (`<script src="https://cdn.tailwindcss.com">`) provides full utility class support with zero build configuration
- Vanilla JS with `fetch()` for API calls and DOM manipulation for UI updates
- Single-page app behavior achieved via client-side routing with `history.pushState()` or simple tab navigation

**File structure**:
```
src/dashboard/
├── server.ts              # DashboardServer class (Deno.serve, routing, auth middleware)
├── auth.ts                # Passphrase validation, session token management
├── routes/
│   ├── api.ts             # REST API route handlers
│   └── pages.ts           # HTML page serving
└── public/
    ├── index.html         # Main dashboard shell (tab-based SPA)
    ├── app.js             # Client-side JavaScript (fetch, DOM, polling)
    └── style.css          # Custom styles (minimal, most via Tailwind)
```

### 3. Cookie-based session auth with passphrase

**Decision**: Use a single passphrase for authentication, stored in config/env. On successful login, set an `httpOnly` session cookie with a random token.

**Rationale**:
- Simplest auth model for a single-operator dashboard
- `httpOnly` cookie prevents XSS token theft
- No JWT library dependency needed — just a random token stored server-side in a `Map<string, { createdAt: number }>`
- Passphrase configured via `dashboard.passphrase` in `config.yaml` or `DASHBOARD_PASSPHRASE` env var
- Helm chart stores passphrase as a Kubernetes Secret for encryption at rest

**Endpoints**:
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Validate passphrase → set `httpOnly` cookie with session token |
| POST | `/api/auth/logout` | Clear cookie, invalidate server-side token |
| GET | `/api/auth/status` | Check if current cookie is valid (for client-side auth state) |

**Auth middleware**: All `/api/*` routes (except `/api/auth/login`) and all page routes require a valid session cookie. Unauthenticated requests to pages redirect to a login page; unauthenticated API requests return `401`.

### 4. Chat via SSE for agent responses + POST for user messages

**Decision**: Use Server-Sent Events (SSE) for streaming agent responses back to the browser. User messages are sent via standard POST requests.

**Rationale**:
- SSE provides a natural fit for streaming agent output (session updates arrive incrementally from the ACP agent)
- Simpler than WebSocket — unidirectional server→client stream, works through proxies, automatic reconnection built into `EventSource` API
- Chat session lifecycle managed via REST endpoints; SSE is only for the response stream

**Endpoints**:
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat/connect` | Start a new ACP session. Body: `{ agentType, model }`. Returns `{ sessionId }` |
| POST | `/api/chat/message` | Send user message. Body: `{ sessionId, message }`. Returns `202 Accepted` |
| GET | `/api/chat/stream?sessionId=...` | SSE endpoint. Streams `sessionUpdate` events, agent text output, and `<think>` blocks |
| POST | `/api/chat/disconnect` | End ACP session. Body: `{ sessionId }`. Disconnects agent connector |

**Chat session lifecycle**:
1. User selects agent type + model, clicks "Connect" → `POST /api/chat/connect`
2. Server spawns `AgentConnector`, creates ACP session, returns `sessionId`
3. Client opens `EventSource` to `/api/chat/stream?sessionId=...`
4. User types message → `POST /api/chat/message` → server calls `connector.prompt()`
5. Agent responses stream back via SSE as `ChatbotClient` receives `sessionUpdate` callbacks
6. User clicks "Disconnect" or idle timeout (10 min) → `POST /api/chat/disconnect` → `connector.disconnect()`
7. Browser `beforeunload` event sends `navigator.sendBeacon()` to disconnect endpoint

**Chat-specific behavior**:
- Dashboard chat does NOT use `send-reply` skill — agent responses are captured directly from ACP prompt response and `sessionUpdate` callbacks
- A dedicated prompt template `prompts/system_web_chat.md` instructs the agent to respond conversationally without platform skills
- Chat sessions use a dedicated workspace (`data/workspaces/dashboard/web-chat/`) separate from platform user workspaces
- Only one chat session at a time per dashboard instance (enforced server-side)

### 5. Polling for session list and stats (every 5–10 seconds)

**Decision**: Use `setInterval` + `fetch()` polling from the client for session and stats data. No SSE/WebSocket for these views.

**Rationale**:
- Session list and stats change infrequently (seconds scale) — polling is adequate
- Simpler implementation than maintaining additional SSE connections
- Client controls polling frequency; can pause when tab is hidden (`document.hidden`)

**Endpoints**:
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions/active` | Active sessions from `SessionRegistry`. Returns `Array<{ id, platform, channelId, userId, startedAt, replySent }>` |
| GET | `/api/sessions/history` | Completed sessions from in-memory ring buffer. Returns `Array<{ id, type, platform, userId, startedAt, endedAt, status, durationMs }>` |
| GET | `/api/stats` | Parsed metrics from `prom-client` registry. Returns `{ sessionsTotal, repliesSent, memoryOps, activeSessions, uptime, ... }` |

**Stats endpoint implementation**: Calls `metricsRegistry.getMetricsAsJSON()` from `prom-client`, transforms the raw metric objects into a simplified JSON structure suitable for dashboard display. Avoids re-parsing Prometheus text format.

### 6. Agent workspace file browser via REST API

**Decision**: Provide read-only REST endpoints for browsing the agent workspace directory tree and viewing file contents.

**Rationale**:
- Agent workspace contains non-private knowledge notes and journal entries that operators may want to inspect
- Read-only access is sufficient — workspace modifications are the agent's responsibility
- File type restricted to `.md` and `.txt` to prevent serving binary or sensitive files

**Endpoints**:
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspace/tree` | Directory listing of `data/agent-workspace/`. Returns nested `{ name, type, children? }` tree |
| GET | `/api/workspace/file?path=notes/topic.md` | File content (read-only). Returns `{ path, content, size }` |

**Security**:
- Path traversal protection: resolve requested path with `resolve()` and verify it starts with the canonical agent workspace path
- Only serve files with `.md` or `.txt` extensions; reject all others with `403`
- Agent workspace path sourced from `config.workspace.repoPath + "/agent-workspace/"` (same as `agentWorkspacePath` used by `SessionOrchestrator`)

### 7. Restart via SIGTERM to self

**Decision**: `POST /api/restart` sends `SIGTERM` to the current process via `Deno.kill(Deno.pid, "SIGTERM")`. The container orchestrator (Docker restart policy / Kubernetes deployment) handles respawning.

**Rationale**:
- Reuses the existing `ShutdownHandler` graceful shutdown flow (stop schedulers → stop agent core → disconnect platforms → exit)
- No custom restart logic needed — delegates to the orchestrator, which is the standard pattern for containerized services
- Safer than `Deno.exit()` because SIGTERM triggers the registered signal handler for graceful cleanup

**Alternative rejected**: `Deno.exit()` — rejected because it bypasses the `ShutdownHandler` signal listener, potentially skipping graceful cleanup (git backup, platform disconnect, etc.).

**UI requirement**: Confirmation dialog in the frontend showing "Are you sure? N active sessions will be terminated." before triggering restart.

### 8. Dashboard configuration

**Decision**: Add a `dashboard` section to `Config` interface and `config.yaml`.

```yaml
dashboard:
  enabled: false          # Enable web dashboard (default: false)
  port: 8090              # Dashboard HTTP port (default: 8090)
  passphrase: ""          # Required when enabled; login passphrase
```

**Environment variable overrides**:
| Environment Variable | Config Path | Type |
|---------------------|-------------|------|
| `DASHBOARD_ENABLED` | `dashboard.enabled` | `"true"` / `"false"` |
| `DASHBOARD_PORT` | `dashboard.port` | Integer string |
| `DASHBOARD_PASSPHRASE` | `dashboard.passphrase` | String |

**Config type** (added to `src/types/config.ts`):
```typescript
export interface DashboardConfig {
  /** Enable web dashboard (default: false) */
  enabled: boolean;
  /** Dashboard HTTP port (default: 8090) */
  port: number;
  /** Login passphrase (required when enabled) */
  passphrase: string;
}
```

**Config interface change** (in `Config`):
```typescript
/** Web dashboard configuration (optional) */
dashboard?: DashboardConfig;
```

**Validation** (in `config-loader.ts`): When `dashboard.enabled` is `true`, `dashboard.passphrase` must be non-empty; throw `ConfigError` otherwise.

### 9. Chat prompt template

**Decision**: Create `prompts/system_web_chat.md` — a variant of the reply system prompt tailored for web dashboard chat.

**Differences from `system_reply.md`**:
- No recent message history section (chat context is managed client-side)
- No emoji guidance (no platform reactions)
- Explicitly instructs the agent to NOT use `send-reply`, `send-file`, `react-message` skills — responses are returned directly through ACP prompt response
- Includes character personality (via `{{ include "./character_info.md" }}`)
- Includes memory access instructions (agent can use `memory-save`, `memory-search`, `memory-patch`, `memory-stats`)
- Includes agent workspace access (read-only unless `canWriteAgentWorkspace` is true)
- Sets `platform` to `"web"` and `isDm` to `true` in template variables

**Template variables used**: `sessionId`, `agentType`, `model`, `yolo`, `canWriteAgentWorkspace`, `isDm` (always `true`), `platform` (always `"web"`).

### 10. Session history tracking

**Decision**: Add a `CompletedSessionStore` — an in-memory ring buffer that captures session metadata when sessions complete.

**Implementation**:
```typescript
// src/dashboard/completed-session-store.ts

export interface CompletedSession {
  id: string;
  type: SessionType;       // "message" | "spontaneous" | "self-research" | etc.
  platform: string;
  userId: string;
  startedAt: string;       // ISO 8601
  endedAt: string;         // ISO 8601
  status: "success" | "failure";
  durationMs: number;
}

export class CompletedSessionStore {
  private buffer: CompletedSession[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  add(session: CompletedSession): void {
    this.buffer.push(session);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  getAll(): CompletedSession[] {
    return [...this.buffer];
  }
}
```

**Integration point**: `SessionOrchestrator` calls `completedSessionStore.add()` at the end of each session flow (after agent disconnect, regardless of success/failure). The store is created during bootstrap and passed to `SessionOrchestrator` and `DashboardServer`.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| **Passphrase in config/env is not enterprise-grade auth** | Acceptable for single-operator use case. Document as a limitation. Helm chart stores passphrase as a Kubernetes Secret (encryption at rest). Dashboard is disabled by default. |
| **In-memory session history lost on restart** | Acceptable for v1. Audit logs (`data/audit/`) provide persistent session history for forensic needs. File-based persistence can be added later if needed. |
| **SSE connection for chat holds a Deno connection open** | Mitigated by limiting to one chat session at a time. 10-minute idle timeout prevents connection leaks. `beforeunload` cleanup reduces orphaned connections. |
| **Restart kills all active sessions** | UI shows confirmation dialog with active session count warning. Restart follows existing graceful shutdown flow (SIGTERM → `ShutdownHandler`). |
| **Tailwind CDN requires internet on first load** | Document this requirement. For air-gapped environments, users can vendor the Tailwind CSS file and mount it into the container. The CDN script is cached by browsers after first load. |
| **Agent workspace browser could expose sensitive notes** | Dashboard itself is auth-gated. Agent workspace is designed to be non-private by policy (private data goes to per-user `memory.private.jsonl`). File extension whitelist (`.md`, `.txt`) prevents serving unexpected file types. |

## Open Questions

1. **Should we support multiple concurrent chat sessions or limit to one at a time?**
   - Recommendation: Limit to one at a time for v1. Each chat session spawns an ACP agent subprocess which consumes significant resources. Multiple sessions add complexity to the UI and connection management.

2. **Should completed session history be persisted to disk?**
   - Recommendation: No for v1. The in-memory ring buffer (last 100 sessions) is sufficient for operational monitoring. Audit logs provide persistent history when enabled. Disk persistence can be added as a follow-up if operators need history across restarts.
