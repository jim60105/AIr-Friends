# Proposal

## Why

The `configuration-and-deployment` contract still names six permission flags, while every launch path now needs seven: `pino` calls `os.hostname()` at module initialization while loading `imapflow`, so Deno aborts with `NotCapable: Requires sys access to "hostname"` unless `--allow-sys` is declared, even when `platforms.email.enabled` is false. The behavior fix already shipped as commit `183293e`; this change closes the gap between the shipped runtime and its normative contract so the next reader or deployment does not follow an incomplete permission list.

## What Changes

- Update the existing `Deno Runtime with Explicit Permissions` requirement so `Scenario: Required Permission Flags` lists `--allow-sys` alongside the current six flags.
- Add one scenario: an eagerly loaded dependency that performs a module-level OS call requires the matching permission even when its owning platform is disabled, so future dependency additions are checked against the launch contract.
- Documentation artifact only: no source, workflow, container, task, or operator-documentation file changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `configuration-and-deployment`: `Deno Runtime with Explicit Permissions` adds `--allow-sys` to `Scenario: Required Permission Flags` and adds one scenario covering module-level OS calls in eagerly loaded dependencies.

## Impact

- **Affected file**: `openspec/specs/configuration-and-deployment/spec.md`, synced from this change's delta at archive. No `src/`, `tests/`, `deno.json`, CI workflow, `Containerfile`, or `docs/` file is modified.
- **Existing behavior**: after commit `183293e`, every application launch path already declares `--allow-sys` — `.github/workflows/ci.yaml` compile, `deno.json` `dev`/`start`/`start:config` and every `test*` task, `Containerfile` `CMD`, the `AGENTS.md` launch and YOLO examples plus its permission table, the systemd `ExecStart` in `docs/admin/deployment-modes.md`, and the dry-run command in `docs/operations/metrics-and-health.md`. This change records that behavior; it does not alter it.
- **Pre-release project**: no compatibility layer, migration, deprecation, or narrowed grant is introduced. The permission set is a hard requirement of every launch, not an optional capability.

## Non-goals

- No source, workflow, `Containerfile`, task, or docs changes; commit `183293e` is the behavior fix and stays as-is.
- Do not refactor to a lazy or dynamic import of the email platform or `imapflow`. Module initialization is the actual failure mode, and the spec must state the consequence rather than prescribe an architectural workaround.
- Do not narrow the grant to `--allow-sys=hostname`: that silently disables nodemailer's guarded `os.networkInterfaces()` call (`nodemailer@7.0.13/lib/shared/index.js:23-37`), degrading its SMTP address-family check to "hope for the best".
- Do not edit `openspec/specs/` directly; the delta must flow through this change and be synced on archive.
- Do not touch `openspec/specs/email-imap-transport/` or any email capability spec; they contain no permission declarations.

## Estimate

Total: **1 engineering hour**, well below the one engineer-day ceiling: 0.25h for the delta, 0.25h for proposal and tasks, 0.25h for the verification gates, and 0.25h contingency. This is an artifact-only change under an explicit request; it introduces no behavior, dependency, deployment, or operator action.
