# Tasks

C2 is a prerequisite; serialize after C1 (C3). Run build/format/lint/affected tests once after all implementation edits, not between tasks. Automated acceptance is deterministic source/API-shaped smoke only; native runtime, providers, platforms, and containers remain user-owned.

## 1. Reproducible native-loadable packaging

- [x] 1.1 Replace the copy/import-map output with frozen-lock Deno ESM bundling of canonical dependencies, allowing only documented native builtins and the exact native TypeBox host import. Verify generated dependency edges contain no JSR/import-map alias/unapproved package and the builder import retains its pinned host-resolved spelling.
  <!-- Emitted edges of the real bundle are exactly ["@sinclair/typebox", "node:dns/promises"]; audit predicate shared with tests (scripts/omp/bundle-audit.ts); every violation class fails packaging. -->
- [x] 1.2 Export one generated development-entry/image-entry mapping and migrate build/launch/install consumers to it; preserve authored settings/prompt mount semantics and root ownership. Verify a missing generated development entry fails preflight with the build remedy rather than selecting raw sources.
- [x] 1.3 Update packaging/dev instructions and affected closure/launch coverage, remove old sidecar-map/mirror scaffolding, and recut the manifest for all installed output. Verify canonical source remains single-owned, locked input/output facts are recorded, and no JavaScript runtime installation is added.
  <!-- Manifest recut (generator unchanged; repo convention: PACKAGE-MANIFEST.sha256 is never repo-tracked, it is regenerated over final content at every image build). Recut over the simulated C3 owned root (config trio + prompt/SYSTEM.md + generated extension/index.js) verified with sha256sum -c: 5 file digests, all OK. Installed-output digest: extension/index.js = 41785710a361b5a0fe2c8980a84870a2bd568439e6776856865ee2998aa07e1c, generated from src/acp/omp/extension/index.ts = 0e249ce94fb47af49d5b3409427c01fd96462b9d5dcf879f84565af413620462 with deno.lock = b74317ecf6acab57d41265a2353af841de9d68d587e9b746d6e6e743341449dd (the same inventory the bundle header records). -->

## 2. Runtime-compatible resolver boundary

- [x] 2.1 Replace Deno-only native DNS with the Node DNS interface and retain transport injection/literal-IP behavior and the existing SSRF classifier. Verify dual-stack, one-family no-record, empty/all-failure, and private-answer cases produce the existing authorization outcomes.
  <!-- One-family resolver FAULT (e.g. SERVFAIL) stays indistinguishable from no-records — byte-parity with the superseded Deno.resolveDns path, which swallowed identically; fail-closed empty-set paths and the single classifier verified unchanged. Post-review disposition: recording the swallowed error class for diagnosability is deferred, behavior unchanged. -->
- [x] 2.2 Audit reachable extension defaults for runtime-only Deno calls and provide narrow supported adapters through existing metadata seams where required, without a Deno polyfill or weakened sink. Update affected behavioral coverage, network docs, changelog, and rebuilt owned digests; verify unsupported required runtime observation still denies rather than silently bypassing policy.
  <!-- Bundle audit: every reachable Deno.* call is typeof-Deno-guarded with node:fs/process fallbacks (bootstrap env/cwd, safeCwd, executable-sources node-fs-first) or sits on Deno-only daemon paths outside the bundle (filesystem-roots/settings-sources tree-shaken out); required-observation denial (executable-sources fail-closed) unchanged. Owned digests rebuild = the manifest recut under 1.3. -->

## 3. Closure and resolver smoke

- [x] 3.1 After all edits, build the real bundle once and run a throwaway API-shaped module-load/schema/DNS smoke without a Deno import map, using only the pinned host facade fixture and mock DNS/transport; run affected suites once. Verify no runtime dependency download, external endpoint, native OMP, or container execution occurs and report that native-loader behavior remains user-owned.
  <!-- Permanent suite home: packaging test "loads under a facade-only host with NO Deno import map" (facade fixture + mock DNS throughout; skip-pass where no node binary exists; zero downloads — jsr inputs are cached-locked, the npm: typebox repo pin is fixture-side and pre-cached). The throwaway run (node + /tmp facade fixture) confirmed: facade host-resolved, bundle reached the identical discovery-gate fail-closed throw, no import map, no download. Native-loader behavior remains user-owned (docs/OMP_PACKAGING.md §7). -->

## Workflow follow-up

- Archive and sync after implementation/review gates; leave historical archives unchanged.
- Apply successors in the correction index order; rebuild/recut owned outputs for each affected successor.
