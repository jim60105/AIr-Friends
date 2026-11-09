# Proposal

## Why

Source design section 7 renames `/home/deno` to `/home/air`, uses the existing `ENV` instead of `DENO_ENV`, and removes `DENO_DIR` and `DENO_NO_UPDATE_CHECK`. These identifiers live in the confinement lists, environment allowlists, fallbacks, remedy messages, Helm values and examples, not only in the image. Changing them in one change before the image change keeps the image change small and gives one place for the breaking deployment notes.

## What Changes

- `src/utils/env.ts` reads `ENV` only; `DENO_ENV` is ignored. **BREAKING**: deployments must set `ENV` (Helm `env.DENO_ENV` → `env.ENV`).
- Every `/home/deno` default, fallback and allowlist entry in `src/`, `agent-config/opencode.json`, `helm/values.yaml`, `.env.example` and `config.example.yaml` becomes `/home/air`. **BREAKING**: a custom `AGENT_SKILLS_DIR` value that points under `/home/deno` must move to `/home/air`, including ArgoCD Helm parameters.
- `src/acp/sandbox-manager.ts` drops `DENO_DIR` and `DENO_NO_UPDATE_CHECK` from the agent environment allowlist.
- `src/acp/filesystem-confinement.ts` read-only paths drop `/deno-dir`, `/app/deno.json`, `/app/deno.lock`, add `/opt/air/skill-bunfig.toml`, and the home entries move to `/home/air`.
- User-facing remedy strings and comments that say `deno task <name>` or `deno run` say `bun run <name>` (for example `bun run prepare:omp-natives`, `bun run bundle:omp-extension`).
- Update the tests that assert these values.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `configuration-and-deployment`: `YAML Configuration Loading` (`ENV` only), `Stock Image Declares the Shared Skill Install Root` and `External Skill Auto-Installation Into the Single Skill Root` (`/home/air`).
- `agent-sandbox-hardening`: `Shared Resolved Skill Tree Has Read-Only Runtime Visibility` (`/home/air`); adds `Confinement Exposes The Bun Skill Runtime Read-Only`.

## Impact

- Edited: `src/utils/env.ts`, `src/acp/sandbox-manager.ts`, `src/acp/filesystem-confinement.ts`, `src/acp/client.ts`, `src/acp/agent-factory.ts`, `src/core/git-credential-setup.ts`, `src/core/skills-root.ts`, `src/utils/omp-native-cache.ts`, `src/utils/omp-paths.ts`, `src/utils/opencode-paths.ts`, `agent-config/opencode.json`, `helm/values.yaml`, `.env.example`, `config.example.yaml`, and the tests that assert these strings.
- The image still uses `/home/deno` until `package-bun-container-image`; this change and that one ship together at cutover.
- P0 ownership: none directly; prerequisite of **P0-10** (container deployment).
- No human review document.

## Batch:

depends-on: enforce-bun-skill-approval-grammar
depends-on: port-signals-and-entrypoint-to-bun

Conflict note: edits `agent-config/opencode.json` after `enforce-bun-skill-approval-grammar`, and files across `src/acp/` after every step 4 to 6 change. `package-bun-container-image` depends on it.
