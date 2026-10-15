# Tasks

## 1. Docsify Site Scaffolding & Site Assets

- [x] 1.1 Create `docs/index.html` with pinned `docsify@5.0.0-rc.4`, core light theme, core dark theme addon, search plugin, copy-code plugin, and Prism syntax highlighting components (bash, yaml, json, ts, python).
- [x] 1.2 Create `docs/.nojekyll` to ensure GitHub Pages serves underscore-prefixed Docsify files.
- [x] 1.3 Create `docs/_navbar.md` with links to repository, release notes, and top-level entrypoints.
- [x] 1.4 Create `docs/_coverpage.md` displaying the project logo/badge, title, tagline, and call-to-action buttons.
- [x] 1.5 Create `docs/_sidebar.md` specifying complete hierarchical navigation across all 9 topical chapters and 30 documentation pages.
- [x] 1.6 Create `docs/README.md` containing the project overview, core architecture, and 3 explicit reader entry paths (End-User, Operator, Developer).

## 2. Legacy Clutter Removal & Active Contract Migration

- [x] 2.1 Extract surviving OMP approval settings, native acceptance commands, and verification criteria from `docs/OMP_*.md` and `docs/USER-RUNTIME-VERIFICATION.md` into staging notes for `docs/agent/` chapters.
- [x] 2.2 Remove obsolete `docs/OMP_*.md` files (`OMP_SPAWN.md`, `OMP_SETTINGS.md`, `OMP_RECOVERY.md`, `OMP_POOL_MODES.md`, `OMP_PACKAGING.md`, `OMP_NETWORK.md`, `OMP_DISCOVERY.md`, `OMP_COMPATIBILITY.md`, `OMP_TOOL_POLICY.md`, `OMP_ENFORCEMENT.md`).
- [x] 2.3 Remove `docs/USER-RUNTIME-VERIFICATION.md` and `docs/CONTAINER_TOOLS.md`.
- [x] 2.4 Delete legacy directories `docs/omp-features/` and `docs/superpowers/specs/`.
- [x] 2.5 Delete `docs/misskey/misskey-open-api.json` and remove obsolete standalone docs superseded by new chapters (`docs/DEVELOPMENT.md`, `docs/DESIGN.md`, `docs/AGENT_PERMISSIONS.md`, `docs/SKILLS_IMPLEMENTATION.md`, `docs/PLATFORM_INTEGRATION.md`, `docs/MEMORY_DESIGN.md`, `docs/misskey/misskey-integration.md`).

## 3. Getting Started & User Guide Chapters

- [x] 3.1 Author `docs/getting-started/quickstart.md`: installation prerequisites, docker compose launch, and initial setup.
- [x] 3.2 Author `docs/getting-started/platforms.md`: supported platforms grounded in code (Discord and Misskey) and connection settings.
- [x] 3.3 Author `docs/getting-started/models-and-keys.md`: supported AI model providers, API key configuration, and fallback options.
- [x] 3.4 Author `docs/guide/chat-and-interactions.md`: interaction modalities, mentions, DMs, thread handling, and conversational behavior.
- [x] 3.5 Author `docs/guide/context-and-reset.md`: session context limits, sliding windows, and reset commands.
- [x] 3.6 Author `docs/guide/memory-experience.md`: auto-summaries, memory search and export, and channel write policy.
- [x] 3.7 Author `docs/guide/reminders.md`: scheduling reminders, natural language syntax, and delivery semantics.

## 4. Character Authoring & Administration Chapters

- [x] 4.1 Author `docs/character/concepts.md`: character identity, soul prompt structure, personality framing, and tone.
- [x] 4.2 Author `docs/character/fragments.md`: modular system prompt fragments, conditional inclusion, and organization.
- [x] 4.3 Author `docs/character/template-engine.md`: Vento template engine integration, custom variables, filters, and rendering lifecycle.
- [x] 4.4 Author `docs/admin/configuration.md`: configuration loading order, YAML hierarchy, environment variable substitution.
- [x] 4.5 Author `docs/admin/reply-policy.md`: reply rules, whitelist/blacklist controls, and direct mention restrictions.
- [x] 4.6 Author `docs/admin/rate-limiting.md`: per-user sliding-window request timestamp limits, cooldown period enforcement, and burst capacity as implemented in `src/core/rate-limiter.ts`.
- [x] 4.7 Author `docs/admin/deployment-modes.md`: container deployment (Docker/Podman), systemd service setup, and rootless environments.

## 5. Agent ACP Engine & Security Chapters

- [x] 5.1 Author `docs/agent/acp-engine.md`: OpenCode vs OMP engine comparison, setup matrix (container vs local/custom prerequisites: models.yml, skills.customDirectories, extension bundle), version verification (`verifyOmpVersion`), and native acceptance commands.
- [x] 5.2 Author `docs/agent/security-and-sandbox.md`: workspace boundary isolation, Restricted mode vs YOLO mode, explicit security guarantees and limitations (opt-in OS confinement, Rootless Podman constraints, proxy limitations, OMP accepted upstream differences, and distinction between client-side unit evidence and operator runtime acceptance).
- [x] 5.3 Author `docs/agent/model-routing.md`: contextual model routing rules, first-match evaluation, and reasoning effort (`thought_level`).

## 6. Features & Operations Chapters

- [x] 6.1 Author `docs/features/spontaneous-posting.md`: spontaneous posting trigger conditions, timing intervals, and topic generation.
- [x] 6.2 Author `docs/features/channel-lurk.md`: channel lurk listener, message harvesting, and conversation joining criteria.
- [x] 6.3 Author `docs/features/self-research.md`: autonomous web research, tool invocation, and knowledge synthesis.
- [x] 6.4 Author `docs/features/memory-maintenance.md`: lexical recall indexing (`indexed-memory.ts`), agent-driven LLM background consolidation and memory patching (`session-orchestrator.ts`), and explicit exclusion of vector embeddings.
- [x] 6.5 Author `docs/features/git-backup.md`: automated git backup workflow for characters, memory stores, and configuration state, including the recommended baseline `.gitignore` pattern.
- [x] 6.6 Author `docs/features/scheduler-lifecycle.md`: shared scheduler lifecycle, restart catchup execution, and randomized interval jitter.
- [x] 6.7 Author `docs/operations/dashboard.md`: Web Dashboard configuration (port 8090, loopback default, passphrase length, behindHttpsProxy, trustedProxies, 5 tabs).
- [x] 6.8 Author `docs/operations/metrics-and-health.md`: Prometheus `/metrics`, health endpoints (`/health`, `/ready`, `/readyz`), and `--dry-run` flag.
- [x] 6.9 Author `docs/operations/audit-logs.md`: session JSONL audit logging, SHA-256 integrity hashing, and retention policies.
- [x] 6.10 Author `docs/operations/logging.md`: structured JSON log formatting, Message Template conventions, and GELF HTTP transport.

## 7. Extending, Reference & Inbound Link Updates Across Repository

- [x] 7.1 Author `docs/extending/built-in-skills.md`: catalog of out-of-the-box skills and execution requirements.
- [x] 7.2 Author `docs/extending/external-skills.md`: installing and integrating external agent skills.
- [x] 7.3 Author `docs/extending/custom-skills.md`: authoring custom skills with secure payload file contract.
- [x] 7.4 Author `docs/extending/platform-adapters.md`: architecture and interface contracts for adding new chat platform adapters.
- [x] 7.5 Author `docs/extending/mcp-servers.md`: Model Context Protocol (MCP) server configuration and tool binding.
- [x] 7.6 Author `docs/extending/contributing.md`: developer environment setup, style conventions, and pull request guidelines.
- [x] 7.7 Author `docs/reference/config-schema.md`: complete YAML configuration dictionary and environment variable mapping table.
- [x] 7.8 Author `docs/reference/troubleshooting.md`: common failure modes, connection diagnostics, and FAQ.
- [x] 7.9 Update inbound documentation links in root `README.md` to dual-mode (direct relative Markdown paths for GitHub browsing and Docsify site link).
- [x] 7.10 Update active documentation citations across the repository: `config.example.yaml`, `.env.example`, `AGENTS.md`, and `tests/README.md`.
- [ ] 7.11 Review all written documentation outcomes according to `chinese-content-writing-guideline` and `chinese-traditional-conversion` (Traditional Chinese zh-TW, full-width punctuation, Taiwan terminology, no mainland phrasing/calques, proper CJK-alphanumeric spacing).

## 8. Runtime Smoke Verification

- [ ] 8.1 Serve `docs/` locally via HTTP server (e.g., `python3 -m http.server 3000 --directory docs`) and verify that `index.html` loads, `_sidebar.md` navigation renders all sections, search plugin indexes pages, and code copy operates without browser console errors.
