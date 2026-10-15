# Design

## Context

The AIr-Friends repository currently stores documentation in a mixed format under `docs/`. Over time, early architectural brainstorms (`superpowers/specs/`), OMP implementation notes (`OMP_*.md`), temporary verification checklists (`USER-RUNTIME-VERIFICATION.md`), and an isolated docsify experiment (`docs/omp-features/`) accumulated alongside core guides. Various files across the repository (`README.md`, `config.example.yaml`, `.env.example`, `AGENTS.md`, and `tests/README.md`) reference these legacy documentation files.

To provide a cohesive documentation experience without requiring a complex node build toolchain or static site generator build steps, AIr-Friends will standardize on Docsify v5 (`5.0.0-rc.4`) served dynamically by GitHub Pages or local HTTP servers from `docs/`, while maintaining clean, navigable relative Markdown links for developers reading directly in GitHub's repository view.

See `proposal.md` for motivation and scope summary.

## Goals / Non-Goals

**Goals:**
- Provide a clean, client-side Docsify documentation site rooted at `docs/` with standard navigation (`_sidebar.md`, `_navbar.md`, `_coverpage.md`, `README.md`).
- Delete all obsolete development artifacts, historical design specs, and redundant OMP deep-dive notes from `docs/` after migrating surviving operational contracts, acceptance commands, and verification criteria into the active topical chapters.
- Systematically digest and organize valid operational and architectural information into 9 top-level topic directories with 30 target Markdown files.
- Align documented capabilities strictly with repository code:
  - Platforms: Discord and Misskey (Telegram is not an active platform in `src/types/events.ts`).
  - Rate Limiting: Sliding-window timestamp queue per user with cooldown penalty (per `src/core/rate-limiter.ts`).
  - Memory: Lexical indexing (`src/core/memory-recall/indexed-memory.ts`), agent-driven summarization, and memory patching (no embeddings/vector databases).
  - Git Backup: Include the recommended baseline `.gitignore` referenced by `config.example.yaml`.
- Ensure GitHub Pages compatibility via `docs/.nojekyll` and hash-based routing.
- Support dual-mode linking: root `README.md` and repository config files use direct relative Markdown links (`docs/chapter/page.md`) that render natively on GitHub, with a top-level banner linking to the Docsify site.
- Support dark/light mode, full-text search, code copy, and multi-language Prism syntax highlighting.
- Update inbound links across `README.md`, `config.example.yaml`, `.env.example`, `AGENTS.md`, and `tests/README.md`.
- Include a manual smoke verification task to validate local site serving via Python HTTP server / Docsify CLI.

**Non-Goals:**
- Automated test suites for documentation prose, link checking, or Markdown spell check (non-code proposal).
- Multi-lingual docs localization (zh-TW or i18n variants) in this change; docs will be organized in a unified, consistent technical voice.
- Changes to AIr-Friends core application code, container entrypoints, or runtime behavior.

## Decisions

### 1. Zero-Build Docsify v5 Runtime (`5.0.0-rc.4`)
- **Decision**: Use Docsify v5 RC (`cdn.jsdelivr.net/npm/docsify@5.0.0-rc.4`) with CSS core theme (`core.min.css`) and media-query dark mode (`addons/core-dark.min.css`).
- **Rationale**: No node compile/build step is needed for GitHub Pages or local development. Serving Markdown directly preserves raw markdown readability while providing rich in-browser browsing.
- **Plugins included**:
  - `plugins/search.min.js`: Client-side search indexing.
  - Prism components for syntax highlighting: bash, yaml, json, typescript, python.
  - Clipboard copy button for code blocks.
- **GitHub Pages compatibility**: Add `docs/.nojekyll` so GitHub Pages serves `_sidebar.md`, `_navbar.md`, and `_coverpage.md`.

### 2. Migration of Surviving Operational Contracts Prior to Deletion
- **Preserved Operational Knowledge**:
  - OMP Native Provider and Approval Settings: Documented in `agent/acp-engine.md` and `agent/security-and-sandbox.md` (migrated from `OMP_SETTINGS.md` and `OMP_SPAWN.md`).
  - Version Verification & Native Acceptance Commands: Pinned minimum version `18.6.1`, `verifyOmpVersion()`, smoke test commands, and prerequisites documented in `agent/acp-engine.md`.
  - Evidence Boundaries: Explicit distinction between client-side unit/mock evidence, container image packaging evidence, and operator runtime platform acceptance (migrated from `USER-RUNTIME-VERIFICATION.md` into `agent/security-and-sandbox.md`).
  - Git Backup Baseline `.gitignore`: Recommended pattern from `DESIGN.md` documented directly in `features/git-backup.md` so `config.example.yaml` has an accurate reference.
- **Files Deleted Outright (after contract migration)**:
  - `docs/OMP_*.md` (10 files): Spawn, settings, recovery, pool modes, packaging, network, discovery, compatibility, tool policy, enforcement.
  - `docs/USER-RUNTIME-VERIFICATION.md`: Temporary manual testing checklist.
  - `docs/omp-features/` (15 files): Earlier isolated docsify sandbox.
  - `docs/superpowers/specs/` (4 files): Historical design proposals.
  - `docs/CONTAINER_TOOLS.md` & `docs/misskey/misskey-open-api.json`: Internal tool notes & raw swagger schema.
- **Files Replaced / Digested into Chapter Topics**:
  - `docs/DEVELOPMENT.md`, `docs/DESIGN.md`, `docs/AGENT_PERMISSIONS.md`, `docs/SKILLS_IMPLEMENTATION.md`, `docs/PLATFORM_INTEGRATION.md`, `docs/MEMORY_DESIGN.md`, `docs/misskey/misskey-integration.md` will be cleanly digested across `guide/`, `character/`, `admin/`, `agent/`, `features/`, `operations/`, `extending/`, and `reference/`.

### 3. Clear Three-Pillar Audience Entry in Docs Homepage (`docs/README.md`)
- The documentation homepage will structure entry points by user archetype:
  1. **End-Users**: How to chat, interaction modes, context reset, memory recall experience, reminders (`guide/*`).
  2. **Operators / Administrators**: Setup matrix, deployment modes (Docker, Podman, systemd), security sandbox, configuration dictionary, metrics, audit logs, web dashboard (`getting-started/*`, `admin/*`, `operations/*`, `agent/*`).
  3. **Developers / Extenders**: Character prompt authoring & Vento templates, custom skills payload contract, platform adapters, MCP server integration, contributing (`character/*`, `extending/*`).

### 4. Technical Chapter Organization & Grounded Content Definitions
The documentation structure under `docs/` will be:
```
docs/
├── index.html
├── .nojekyll
├── _sidebar.md
├── _navbar.md
├── _coverpage.md
├── README.md
├── preview.webp (retained asset)
├── preview.png  (retained asset)
├── getting-started/
│   ├── quickstart.md
│   ├── platforms.md
│   └── models-and-keys.md
├── guide/
│   ├── chat-and-interactions.md
│   ├── context-and-reset.md
│   ├── memory-experience.md
│   └── reminders.md
├── character/
│   ├── concepts.md
│   ├── fragments.md
│   └── template-engine.md
├── admin/
│   ├── configuration.md
│   ├── reply-policy.md
│   ├── rate-limiting.md
│   └── deployment-modes.md
├── agent/
│   ├── acp-engine.md
│   ├── security-and-sandbox.md
│   └── model-routing.md
├── features/
│   ├── spontaneous-posting.md
│   ├── channel-lurk.md
│   ├── self-research.md
│   ├── memory-maintenance.md
│   ├── git-backup.md
│   └── scheduler-lifecycle.md
├── operations/
│   ├── dashboard.md
│   ├── metrics-and-health.md
│   ├── audit-logs.md
│   └── logging.md
├── extending/
│   ├── built-in-skills.md
│   ├── external-skills.md
│   ├── custom-skills.md
│   ├── platform-adapters.md
│   ├── mcp-servers.md
│   └── contributing.md
└── reference/
    ├── config-schema.md
    └── troubleshooting.md
```

### 5. Content Mapping & Digesting Rules Grounded in Code
- **Getting Started (`getting-started/platforms.md`)**:
  - Focus strictly on supported platforms: **Discord** and **Misskey** (referencing `src/types/events.ts`). No phantom Telegram setup.
- **Administration (`admin/rate-limiting.md`)**:
  - Accurately document the sliding-window per-user request timestamp queue and cooldown penalty mechanism as implemented in `src/core/rate-limiter.ts`.
- **Memory Maintenance (`features/memory-maintenance.md`)**:
  - Detail the lexical search and TF-IDF-like ranking implemented in `src/core/memory-recall/indexed-memory.ts`, accompanied by agent-driven LLM background consolidation and memory patching (`src/core/session-orchestrator.ts`). Explicitly disclaim embedding vector databases.
- **Git Backup (`features/git-backup.md`)**:
  - Document the automated git backup runner and provide the recommended baseline `.gitignore` pattern for the operator's data directory.
- **Agent ACP Engine & Security (`agent/`)**:
  - `acp-engine.md`: Comprehensive breakdown comparing OpenCode vs OMP engine backends; setup matrix specifying prerequisite files (`models.yml`, `skills.customDirectories`, extension bundle) for container vs local/custom deployments; minimum OMP version check (`AGENT_OMP_MIN_VERSION=18.6.1`).
  - `security-and-sandbox.md`: Workspace boundary isolation, Restricted mode vs YOLO mode, explicit security guarantees and operational limitations (opt-in OS confinement, Rootless Podman constraints, proxy limitations, OMP accepted upstream differences, user-owned runtime evidence boundaries).
  - `model-routing.md`: Contextual routing rules (first-match wins) and reasoning effort control (`thought_level`).
- **Operations (`operations/`)**:
  - `dashboard.md`: Web Dashboard configuration (port 8090, loopback 127.0.0.1 default, passphrase requirements ≥ 16 chars, `behindHttpsProxy`, `trustedProxies`, overview of the 5 tabs).
  - `metrics-and-health.md`: Prometheus `/metrics`, health probes (`/health`, `/ready`, `/readyz`), and `--dry-run` validation flag.
  - `audit-logs.md`: Session JSONL audit logging, SHA-256 integrity hashing, and log rotation/retention.
  - `logging.md`: Structured JSON logging format, Message Template conventions, and GELF HTTP transport.
- **Extending (`extending/custom-skills.md`)**:
  - Document the secure payload file contract for custom external skills (file-based argument passing preventing shell injection).
- **Features (`features/scheduler-lifecycle.md`)**:
  - Document the shared background scheduler lifecycle, restart catchup behavior, and jitter calculations.

### 6. Dual-Mode Link Resolution Across Repository
- **GitHub Compatibility**: Root `README.md` will link to relative markdown files (e.g. `[Quickstart](docs/getting-started/quickstart.md)`) so that repository visitors reading on GitHub navigate directly to formatted markdown pages without 404s.
- **Documentation Website Banner**: The top of root `README.md` and `docs/README.md` will link to the GitHub Pages hosted Docsify site URL (`https://jim60105.github.io/AIr-Friends/`).
- **Repository-Wide Active Citations**: Update obsolete paths in:
  - `config.example.yaml` (point git backup `.gitignore` advice to `docs/features/git-backup.md`, OMP packaging notes to `docs/agent/acp-engine.md`).
  - `.env.example` (point OMP packaging reference to `docs/agent/acp-engine.md`).
  - `AGENTS.md` (point design, development, and packaging links to new chapter files).
  - `tests/README.md` (point runtime enforcement and packaging notes to `docs/agent/acp-engine.md` and `docs/agent/security-and-sandbox.md`).

## Risks / Trade-offs

- **Risk**: Search index performance in Docsify with 30+ pages.
  - **Mitigation**: Standard Docsify search plugin indexes headings and text progressively; pages are split into small, focused Markdown files to maintain high retrieval speed.
- **Risk**: GitHub Pages routing with underscores.
  - **Mitigation**: Included `docs/.nojekyll` file at the root of `docs/` to prevent Jekyll from stripping `_sidebar.md`, `_navbar.md`, or `_coverpage.md`.
- **Risk**: External or repository links breaking when legacy docs are removed.
  - **Mitigation**: Updated repository-wide references across `README.md`, `config.example.yaml`, `.env.example`, `AGENTS.md`, and `tests/README.md`.
- **Risk**: Runtime execution issues in browser (broken CDN, sidebar parsing).
  - **Mitigation**: Added a concrete manual smoke verification step in Task 8 to test the live Docsify runtime using a local static HTTP server.
