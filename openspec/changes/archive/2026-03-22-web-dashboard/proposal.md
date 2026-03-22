## Why

AIr-Friends currently lacks a visual interface for operators to monitor bot activity, inspect sessions, browse agent workspace files, and interact with the agent directly. Operators must rely on logs, Prometheus metrics scraping, and CLI tools. A built-in web dashboard provides real-time visibility, operational control, and a direct chat interface to the ACP agent — all behind a simple passphrase-based login.

## What Changes

- Add a new web dashboard HTTP server (`Deno.serve()`) with configurable port and passphrase authentication
- Add a dashboard overview page showing active sessions (live) and finished session history (secondary view)
- Display aggregated statistics sourced from the existing `prom-client` Prometheus metrics registry (sessions total, replies sent, memory operations, active sessions, etc.)
- Add a read-only file browser for `/app/data/agent-workspace` with click-to-open file viewing
- Add a restart button that performs a graceful process restart
- Add a passphrase-based login gate configured via `dashboard.passphrase` config / `DASHBOARD_PASSPHRASE` env var, stored as a Kubernetes Secret in the Helm chart
- Add a web chat view that connects to an ACP agent, allowing operators to select agent type and model, exchange messages in a persistent session, view `<think>` blocks, and auto-disconnects after 10 minutes of inactivity or browser close
- Create `prompts/system_web_chat.md` — a variant of the reply prompt without message history/emojis and with guidance to avoid `send-reply`/`send-file`/`react-message` skills
- All frontend built with pure JavaScript (ES6+) and Tailwind CSS, responsive and mobile-friendly

## Capabilities

### New Capabilities
- `web-dashboard-server`: HTTP server lifecycle, port configuration, static file serving, and passphrase-based authentication middleware
- `web-dashboard-session-monitor`: Real-time active session display, finished session history browsing, and statistics from Prometheus metrics
- `web-dashboard-agent-workspace-browser`: Read-only file browser for agent workspace directory with file content viewing
- `web-dashboard-chat`: Interactive chat view with ACP agent connection management, model/agent-type selection, message exchange, think-block rendering, idle timeout, and session lifecycle UI
- `web-dashboard-restart`: Graceful process restart triggered from the dashboard

### Modified Capabilities
- `configuration-and-deployment`: Add `dashboard` config section (enabled, port, passphrase) with env var overrides and Helm chart Secret for passphrase

## Impact

- **New files**: `src/dashboard/` directory (server, routes, auth middleware, static assets), `prompts/system_web_chat.md`
- **Modified files**: `src/types/config.ts` (add `DashboardConfig`), `src/utils/env.ts` (env overrides), `src/core/config-loader.ts` (validation), `src/bootstrap.ts` (start dashboard server), `src/shutdown.ts` (stop dashboard server), `config.example.yaml`, `.env.example`, `helm/values.yaml`, `helm/templates/` (Secret + env injection)
- **Dependencies**: No new npm/deno dependencies — uses built-in `Deno.serve()`, existing `prom-client` registry, and existing ACP SDK
- **Network**: One additional HTTP port (default `8090`) exposed from the container
- **Security**: Passphrase auth via cookie-based session tokens; all dashboard APIs require authentication; agent workspace browser is read-only; follows OWASP API security guidelines
