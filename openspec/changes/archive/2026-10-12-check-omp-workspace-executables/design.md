## Context

See proposal.md and its matrix. The archived discovery guard owns `DiscoveryDecision`, seven audited surface ids, exact module identity, `preImportExclusionGate`, `criticalSkillSelectionGate`, resourceGeneration and bounded error formatting. Native custom tools/plugins retain `no-supported-mechanism`; the pinned loader imports before metadata/factory inspection. Decision 1 chooses deployment exclusion and a startup check, so runtime admission must depend on verified deployment posture separately from this unchanged native verdict.

## Goals / Non-Goals

Reject executable workspace discovery sources before native setup, and reuse the existing fail-closed boundary. Preserve synchronous handler/live registry enforcement and the decision-2 accepted extension-load risk. No native loader hook, host-guard claim, post-import scan, readiness handshake, new policy or skill-root settings.

## Decisions

### D1. Metadata-only executable-source observation

Extend the existing discovery tree with a typed observation of authoritative workspace roots, custom-tool/plugin discovery roots and ownership identities. Derive roots from the actual session workspace, optional shared Agent workspace, the owned-only settings plan and pinned `sdk.ts`, `custom-tools/loader.ts`, `plugins/loader.ts` discovery routes. Include reachable configured module roots, linked package entry points/dependencies, and global discovery paths reachable from owned state/HOME. A missing, model-supplied or caller-omitted root cannot manufacture an empty clean result. Metadata/manifest inspection may read deterministic package-entry declarations; no dynamic import, require, factory call, subprocess or execution for inspection.

An executable module means a loader-recognized custom-tool module, plugin entry point or linked dependency that the pinned discovery inventory can import. Files need no POSIX execute bit; `.ts`/`.js`/ESM/package entries may execute on import. Do not reject every source file, legitimate repository script, or owned skill script just because it is executable. Inventory includes the loader's directory/package/index shapes, enabled plugin entries, configured roots and aliases. Any unowned discovery root outside the workspace cannot satisfy deployment exclusion and fails closed. Reject symlinked discovery candidates/roots, broken links, inaccessible paths, unknown entry shapes or identity replacement; do not follow a hostile link to execute or inspect it as trusted. Empty and genuinely absent discovery roots are accepted only when their authoritative parent ownership can be observed.

### D2. Pre-native lifecycle ordering

Use the row-26 preflight seam. Order is settings-source check, executable-source check, then OMP spawn or native new/load request. Before first process spawn the factory checks known workspaces. Before every pooled/per-spawn `session/new`, native `session/load` and same-mode recovery, the connector checks the current requested workspace afresh while holding existing session ownership/lease. Before a repository-triggered rediscovery/refresh dispatch, run the same check. Reuse a frozen load-time decision only for immutable source/identity facts; attach fresh per-session observations with existing resourceGeneration. Changed workspaces or stale/foreign generations never reuse a previous clean result.

The production trusted extension is selected by existing image-first owned path resolution and admitted only at the exact packaged image path; ambient extensions remain disabled by `--no-extensions`. Unit/mock tests may use the existing source-owned development tree and must label that evidence. No workspace/HOME/package-cache copy becomes trusted. All installed imports resolve inside `/opt/air/omp/extension` and its existing `_daemon/` closure. Recut PACKAGE-MANIFEST.sha256 after changing installed inputs.

### D3. Admission uses deployment disposition, native verdict remains unchanged

Preserve `DiscoverySurfaceStatus` values and the two native verdict strings exactly. Introduce an explicit deployment-control result rather than changing `no-supported-mechanism` to supported or removing audited surfaces. Native status alone no longer creates an unconditional application rejection after decisions 1/7; the selected deployment controls must succeed. For custom-tool/plugin sources a verified absent executable observation permits deployment admission under decision 1; found executable modules, incomplete observations or invalid owned-module/closure/env posture invoke the existing bounded fail-closed rejection. This permits clean deployments while preserving unsupported native evidence.

`preImportExclusionGate` and `criticalSkillSelectionGate` retain their native `unresolved`/pinnedVerdict data and add a separate `DECIDED (2026-10-09)` disposition, decision number, selected control and runtime-unverified evidence. Remove stale `userDecisionRequired: true` and native-supported-mechanism prerequisite as application blockers. Row 28 owns actual settings-root selection checks; do not mark those controls implemented here. Keep the tuple/current-generation checks already landed active until row 28 extends them. No mock can clear either native gate.

### D4. Fail-closed errors do not assert authenticated extension readiness

A failed client/factory preflight rejects locally before the native protected request, mapping to the existing named-surface, bounded credential-free error contract. Invalid trusted identity/closure or inconsistent deployment posture remains fallback rejection. Keep extension initialization checks as defense in depth; never claim its thrown lifecycle error guarantees native session rejection, because decision 2 records runner.emit swallowing/logging lifecycle failures. No readiness token/channel, handler-installed acknowledgement or first-prompt gate is added. If the synchronous handler fails to install, the accepted native non-YOLO approval plus ACP client policy fallback and missing restricted capability set remain recorded, with no equivalent default-deny or complete callback coverage claim. YOLO receives only deployment checks, never restricted tool rules.

### D5. Deployment control persists beyond the check

The image/deployment keeps executable custom tools and plugin entries out of workspaces for process lifetime. A startup check is a snapshot. No extension callback or mock certifies a race-free barrier against arbitrary external mutation or autonomous native imports. Rechecks guard repository-controlled entry points; native timing and lifecycle reload remain user-owned section-15 observations. Never invent a supported import interception mechanism to fill that limitation.

## Risks / Trade-offs

Discovery-root under-enumeration misses package/index paths; source-backed inventory and table-driven cases must cover all pinned importable forms. Overbroad executable detection would reject allowed source work and skill scripts; bind it to executable discovery sources. Clean preflight plus unsupported native status is the user's decided disposition, not native support. Production development-path fallback would violate the image-only extension decision, so reject it outside the test/development contract.

## Migration Plan

Extend current guard objects/callers, removing obsolete unconditional application blockers while preserving native evidence. No archived artifact rewrite, migration, compatibility shim or fallback launch. Existing downstream enforcement/network imports and contracts remain intact.

## Verification and Handoff

Use real temporary paths for custom tools, plugin package/index entries, links, unreadable/replaced roots, unknown layouts and clean/ordinary-source/owned-skill-script controls. Use importer/spawn/native-request spies to prove repository rejection precedes invocation. Repeat both modes, pooled/per-spawn, new/load/recovery and refreshed workspace/generation cases. Keep positive fixtures labeled repository/synthetic evidence and retain unsupported surface/gate assertions. Docs/checklist explicitly preserve decision-2 risk and native pre-import observations as unverified.
