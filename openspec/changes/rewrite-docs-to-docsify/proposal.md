# Proposal

## Why

The current `docs/` directory is cluttered with obsolete development snapshots, unmaintained experimental notes (`OMP_*.md`, `superpowers/specs/`, `omp-features/`), and fragmented technical guides that mix operator setup, internal engineering notes, and legacy integration checklists. This makes it difficult for new users, operators, and developers to locate accurate, up-to-date documentation.

Rewriting the documentation into a unified, zero-build Docsify documentation site (pinned to Docsify `5.0.0-rc.4`) reorganizes all project knowledge into intuitive, audience-targeted topical chapters (Getting Started, User Guide, Character Authoring, Administration, ACP Engine & Security, Features, Operations, Extending, and Reference) while digesting surviving operational contracts from legacy notes into active documentation, discarding dead development clutter, and fixing inbound documentation links across the repository.

## What Changes

- **Docsify Site Foundation**:
  - Deploy standard Docsify v5 runtime in `docs/index.html` pinned to `docsify@5.0.0-rc.4`, configured with light/dark themes (`core.min.css`, `core-dark.min.css`), Prism language syntax highlighting, search plugin, and copy-code plugin.
  - Add `docs/.nojekyll` to ensure GitHub Pages serves underscore-prefixed docs files.
  - Create `docs/_sidebar.md` with complete hierarchical navigation across all sections.
  - Create `docs/_navbar.md` with version indicator, GitHub repository link, and quick jump links.
  - Create `docs/_coverpage.md` for a clean landing page experience.
  - Create `docs/README.md` as the documentation home, providing an overview of AIr-Friends, high-level architecture, and 3 explicit reader entry paths: End-User, Operator, and Developer.
- **De-clutter Legacy Development Artifacts with Active Contract Migration**:
  - Migrate surviving operational and verification knowledge (OMP approval settings, native acceptance commands, surviving packaging contracts, and evidence boundaries from `docs/OMP_*.md` and `docs/USER-RUNTIME-VERIFICATION.md`) into `docs/agent/acp-engine.md`, `docs/agent/security-and-sandbox.md`, and `docs/operations/`.
  - Retire and delete the 10 obsolete `OMP_*.md` files (`OMP_SPAWN.md`, `OMP_SETTINGS.md`, `OMP_RECOVERY.md`, `OMP_POOL_MODES.md`, `OMP_PACKAGING.md`, `OMP_NETWORK.md`, `OMP_DISCOVERY.md`, `OMP_COMPATIBILITY.md`, `OMP_TOOL_POLICY.md`, `OMP_ENFORCEMENT.md`).
  - Remove `docs/USER-RUNTIME-VERIFICATION.md` and `docs/CONTAINER_TOOLS.md`.
  - Remove directory `docs/omp-features/` (15 files).
  - Remove directory `docs/superpowers/specs/` (4 design specs).
  - Remove `docs/misskey/misskey-open-api.json`.
  - Retire legacy standalone files (`docs/DEVELOPMENT.md`, `docs/DESIGN.md`, `docs/AGENT_PERMISSIONS.md`, `docs/SKILLS_IMPLEMENTATION.md`, `docs/PLATFORM_INTEGRATION.md`, `docs/MEMORY_DESIGN.md`, `docs/misskey/misskey-integration.md`) by digesting their valid content into the new topical chapter structure.
- **Topical Chapters Structure**:
  - `getting-started/`: `quickstart.md`, `platforms.md` (Discord, Misskey), `models-and-keys.md`
  - `guide/`: `chat-and-interactions.md`, `context-and-reset.md`, `memory-experience.md` (auto-summaries, memory search and export, channel write policy), `reminders.md`
  - `character/`: `concepts.md`, `fragments.md`, `template-engine.md` (Vento engine)
  - `admin/`: `configuration.md`, `reply-policy.md`, `rate-limiting.md` (sliding-window per-user rate limiting and cooldown rules), `deployment-modes.md`
  - `agent/`:
    - `acp-engine.md`: OpenCode vs OMP engine comparison, setup matrix (container vs local/custom prerequisites: models.yml, skills.customDirectories, extension bundle), version verification (`verifyOmpVersion`), native acceptance commands
    - `security-and-sandbox.md`: Workspace boundary isolation, Restricted mode vs YOLO mode, explicit security guarantees and limitations (opt-in OS confinement, Rootless Podman constraints, proxy limitations, OMP accepted upstream differences, evidence boundary definitions)
    - `model-routing.md`: Contextual routing rules, reasoning effort (`thought_level`)
  - `features/`: `spontaneous-posting.md`, `channel-lurk.md`, `self-research.md`, `memory-maintenance.md` (agent-driven memory maintenance, periodic summarization, patching vs lexical indexing), `git-backup.md` (including recommended baseline `.gitignore`), `scheduler-lifecycle.md` (restart catchup & shared lifecycle)
  - `operations/`:
    - `dashboard.md`: Web Dashboard (port 8090, loopback default, passphrase length, behindHttpsProxy, trustedProxies, 5 tabs)
    - `metrics-and-health.md`: Prometheus `/metrics`, probes (`/health`, `/ready`, `/readyz`), dry-run mode
    - `audit-logs.md`: Session JSONL audit logging, SHA-256 hashing, retention
    - `logging.md`: Structured JSON, Message Template, GELF HTTP transport
  - `extending/`: `built-in-skills.md`, `external-skills.md`, `custom-skills.md` (secure payload file contract), `platform-adapters.md` (adding platforms), `mcp-servers.md`, `contributing.md`
  - `reference/`: `config-schema.md` (YAML & env var dictionary), `troubleshooting.md`
- **Dual-Mode Inbound Link Updates Across the Repository**:
  - Update inbound links in root `README.md`, `config.example.yaml`, `.env.example`, `AGENTS.md`, and `tests/README.md`.
  - In root `README.md`, provide direct relative links to markdown chapters (e.g. `docs/getting-started/quickstart.md`, `docs/admin/reply-policy.md`) for seamless browsing on GitHub, alongside a prominent link to the hosted Docsify documentation site (e.g. `https://jim60105.github.io/AIr-Friends/#/` or relative `docs/index.html` locally).

## Capabilities

### New Capabilities
*None (skip_specs: true)*

### Modified Capabilities
*None (skip_specs: true)*
