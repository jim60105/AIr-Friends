# Proposal

## Why

The current packaging script copies sources with bare `@std/*` imports and emits a Deno import map, while OMP loads extensions through Bun. The shared DNS adapter also relies on `Deno.resolveDns`, which is absent in that native runtime.

## What Changes

- Produce a reproducible Bun-loadable ESM dependency closure from canonical, lock-resolved sources at build time; do not rely on runtime import maps, JSR downloads, or ambient packages.
- Replace the Deno-only production resolver with a runtime-compatible Node DNS interface, retaining injectable DNS fixtures and the single existing SSRF classifier.
- Use the same generated entry for image installation and supported development launch; preserve root ownership and digest recuts.
- Amend the content-faithfulness requirement to permit deterministic bundling without adding an installed JavaScript runtime or a second policy source tree.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `container-packaging`: Require a locked native-loadable extension closure and reproducible build transformation of canonical sources.
- `acp-integration`: Require runtime-compatible DNS resolution shared by controlled URL read and web search.

## Impact

Targets: `scripts/omp/bundle-extension.ts`, build tasks/lock inputs, `Containerfile`, `src/utils/omp-paths.ts`, `extension/read-replacement.ts`, and packaging/DNS consumers. Prerequisite: C2 definition/schema dependency choices. Serialize after C1 manifest cleanup and before C4 native wiring; successors rebuild/recut through this path. Budget: 8.0h. Native OMP/container execution remains user-owned, not a proposal-validation claim.
