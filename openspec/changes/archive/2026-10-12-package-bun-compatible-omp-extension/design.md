# Design

## Context

The official executable embeds Bun; its legacy extension loader does not consume a sidecar Deno import map. Existing Deno exposes `bundle` with ESM output, dependency bundling, frozen-lock checks, and external-specifier controls. The pinned OMP loader explicitly host-resolves bare `@sinclair/typebox` through its TypeBox facade. DNS currently uses `Deno.resolveDns` only.

## Goals / Non-Goals

**Goals:** Supply one deterministic native-loadable entry from canonical sources, with runtime-supported DNS.

**Non-Goals:** Install Bun/Node, vendor a second policy implementation, shim the entire Deno runtime, or alter SSRF rules.

## Decisions

1. Replace verbatim graph copying plus sidecar import-map generation with build-time `deno bundle` ESM output and `--frozen` lock enforcement. Inline canonical `@std/*`/local dependencies. Allow external `node:`/`bun:` runtime builtins and the exact documented bare TypeBox host-facade import only; fail the build for remaining JSR, import-map aliases, or unapproved bare packages. Preserve the TypeBox import in its canonical host-resolved spelling, not `npm:` form. Do not minify away auditable provenance; retain a deterministic source/input digest inventory.
2. Generate `build/omp-extension/index.js` through the existing repository bundling command. Export its development-to-image mapping once in `omp-paths.ts`; development launch and Containerfile consume this same artifact contract. Canonical extension-root and source-origin observations must identify the selected generated/installed artifact, not the former copied source paths, so C4 can admit its real native provenance. A missing generated artifact fails the existing launch preflight with the build remedy, never falls back to a raw Deno-only source tree. Settings and prompt fallback/mount behavior remain unchanged.
3. Install generated output under the existing root-owned extension tree and manifest every installed output plus owned settings/prompt files. Permit build transformation only from canonical source and locked dependencies; no independently edited mirror or arbitrary augmentation. Rebuild/recut in successors changing installed inputs.
4. Resolve hostnames with `node:dns/promises` A/AAAA queries and the existing literal-IP handling. Preserve both address families, normalize/deduplicate records, and fail on empty/unresolvable results. Individual no-record responses do not discard valid results from the other family. Pass the resolver through the existing transport seam; the same SSRF classifier evaluates every resulting hop. Abort/network behavior stays owned by the current transport, not a new retry system.
5. Check reachable native production defaults for Deno-only execution. Native metadata adapters used by C4/C6 must be explicitly supplied through existing reader seams; Deno remains available only in daemon/script paths. Do not polyfill unsafe filesystem sinks merely to make import succeed.

## Risks / Trade-offs

- [Bundle imports look valid but retain a runtime alias] → Check emitted dependency edges and execute the generated module through an API-shaped runtime smoke without an import map; source inspection is not native binary proof.
- [Schema facade gets inlined or renamed] → Pin the exact host external specifier and exercise schema construction through the native-compatible fixture loader.
- [DNS changes reject/accept different targets] → Cover dual-stack, one-family no-record, all-failure, literal-IP, and private-answer cases using the real adapter seam.
- [Generated development entry is missing] → Fail closed with the explicit bundle command; do not silently choose a second launch convention.

## Migration Plan

Apply after C2 and serialize after C1. Regenerate owned output/manifest, update packaging commands and runtime-checklist limits, then let C4/C5/C6 rebuild through this path. Rollback reverts source and generated contract together. Budget: bundling/path integration 4.0h, DNS/runtime-boundary adaptation 1.5h, focused smoke 1.5h, docs/digests 1.0h, total 8.0h. No native OMP/container/provider execution is automated acceptance.
