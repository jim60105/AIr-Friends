# Tasks

C2 is a prerequisite; serialize after C1 (C3). Run build/format/lint/affected tests once after all implementation edits, not between tasks. Automated acceptance is deterministic source/API-shaped smoke only; native runtime, providers, platforms, and containers remain user-owned.

## 1. Reproducible native-loadable packaging

- [ ] 1.1 Replace the copy/import-map output with frozen-lock Deno ESM bundling of canonical dependencies, allowing only documented native builtins and the exact native TypeBox host import. Verify generated dependency edges contain no JSR/import-map alias/unapproved package and the builder import retains its pinned host-resolved spelling.
- [ ] 1.2 Export one generated development-entry/image-entry mapping and migrate build/launch/install consumers to it; preserve authored settings/prompt mount semantics and root ownership. Verify a missing generated development entry fails preflight with the build remedy rather than selecting raw sources.
- [ ] 1.3 Update packaging/dev instructions and affected closure/launch coverage, remove old sidecar-map/mirror scaffolding, and recut the manifest for all installed output. Verify canonical source remains single-owned, locked input/output facts are recorded, and no JavaScript runtime installation is added.

## 2. Runtime-compatible resolver boundary

- [ ] 2.1 Replace Deno-only native DNS with the Node DNS interface and retain transport injection/literal-IP behavior and the existing SSRF classifier. Verify dual-stack, one-family no-record, empty/all-failure, and private-answer cases produce the existing authorization outcomes.
- [ ] 2.2 Audit reachable extension defaults for runtime-only Deno calls and provide narrow supported adapters through existing metadata seams where required, without a Deno polyfill or weakened sink. Update affected behavioral coverage, network docs, changelog, and rebuilt owned digests; verify unsupported required runtime observation still denies rather than silently bypassing policy.

## 3. Closure and resolver smoke

- [ ] 3.1 After all edits, build the real bundle once and run a throwaway API-shaped module-load/schema/DNS smoke without a Deno import map, using only the pinned host facade fixture and mock DNS/transport; run affected suites once. Verify no runtime dependency download, external endpoint, native OMP, or container execution occurs and report that native-loader behavior remains user-owned.

## Workflow follow-up

- Archive and sync after implementation/review gates; leave historical archives unchanged.
- Apply successors in the correction index order; rebuild/recut owned outputs for each affected successor.
