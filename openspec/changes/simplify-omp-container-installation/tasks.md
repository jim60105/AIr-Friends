# Tasks

## 1. Dependency-closed implementation

All estimates include the named work; the final task explicitly includes integration verification and repair allowance. Implement in the listed order. Land each task’s named behavior tests/docs with its edits, then run acceptance once after the whole change is coherent. Do not run builds/tests/linters/formatters mid-flight. No test of import wiring, source text, fixed schema/default copies, byte-equal settings, epoch constants, or inverse cancelled-policy behavior is acceptable. Production native YAML is hand-authored and never generated or rewritten.

- [x] 1.1 Adopt normal OMP artifact installation permissions (1.00 h estimate).
  - Prerequisite: cutover-omp-native-runtime tasks 1.1–1.7.
  - Exact targets: Containerfile executable COPY, /opt artifact directories/COPY, native HOME models COPY and licenses; tests/utils/omp-packaging.test.ts; docs/OMP_PACKAGING.md.
  - Ordered edits: Keep exact OMP version/checksum/asset selection/download ordering. Change OMP binary/config/prompt/bundle install owner/mode to existing $UID:0/775 convention; preserve authored-copy paths and notices. Keep post-COPY directory preparation ordering required by linked layers. Remove governance ownership commentary and document normal installation.
  - Input/output/error behavior: The non-root runtime can execute native OMP and read authored settings/models/notices; downloads still fail before installation if checksum differs.
  - Remove or migrate: Remove OMP-only immutability/UID/mode/inode tests and assertions; do not assert the inverse writability property.
  - Non-goals: No checksum/version change, OpenCode binary changes or additional JS runtime.
  - Acceptance after this change is complete: At final acceptance build the local architecture image and run native ACP startup with its authored assets; missing asset or checksum failure SHALL stop the actual build/start.

- [x] 1.2 Delete the manifest command and its complete consumer closure (1.00 h estimate).
  - Prerequisite: Task 1.1.
  - Exact targets: Containerfile OMP_VERSION output, /opt/air-build staging and bundle RUN chain; scripts/omp/generate-omp-manifest.sh; tests/utils/omp-packaging.test.ts manifest cases; docs/OMP_PACKAGING.md.
  - Ordered edits: Remove only manifest-owned version-file emission/staging/COPY, manifest generator call/chown/chmod, staging cleanup and recut rules. Keep the real frozen ESM bundle command and cache-stage sibling source mount. Delete generate-omp-manifest.sh and its manifest tests once no build consumer remains.
  - Input/output/error behavior: Image still builds usable native code and copies authored config; no internal artifact inventory is required.
  - Remove or migrate: Manifest script, manifest-specific version/staging files and stale ops checklist commands.
  - Non-goals: No dead placeholder script, normal license deletion or removal of release download checks.
  - Acceptance after this change is complete: At final acceptance native bundle/image startup SHALL succeed without a package manifest; observe generated files as build outputs, with no YAML rewrite. Do not add a text assertion that manifest strings are absent.

- [x] 1.3 Replace packaging snapshots with exercised installation behavior (1.00 h estimate).
  - Prerequisite: Tasks 1.1–1.2.
  - Exact targets: tests/utils/omp-packaging.test.ts; tests/acp/omp-owned-module-bundle-smoke.test.ts; tests/utils/omp-version.test.ts retained; Containerfile checksum build arguments.
  - Ordered edits: Remove file-source/default snapshots and metadata policy assertions. Add a local-architecture build/start scenario using a deliberately incorrect executable checksum build argument and assert failure before output image installation, plus a positive native load/config/catalog operation using the built image. Observe official license files through the installed package, not string inventories. Keep version-health mocked behavior tests unchanged.
  - Input/output/error behavior: Bad download bytes cannot produce an installed runnable image; correct image exposes the pin, notices and working ACP configuration.
  - Remove or migrate: Old checksum-source string tests, root-tree byte inventory and recut tests.
  - Non-goals: No acceptance claim for unbuilt arm64 image; no source-line wiring tests.
  - Acceptance after this change is complete: At final acceptance podman build --build-arg OMP_SHA256_X64=0000000000000000000000000000000000000000000000000000000000000000 -f Containerfile . on amd64 SHALL fail checksum verification; positive built image SHALL start native ACP and expose both official notice files.

- [x] 1.4 Synchronize packaging requirements and operator procedures (1.00 h estimate).
  - Prerequisite: Tasks 1.1–1.3.
  - Exact targets: docs/OMP_PACKAGING.md; docs/OMP_SPAWN.md installation references; CHANGELOG.md; container-packaging delta.
  - Ordered edits: Replace root-owned trust/manifest recut procedures with existing normal install and frozen ESM build instructions. Preserve exact version/download/notice verification, shared skill tree and development/image asset paths. State native model install at HOME and manual root provisioning, plus observed/unverified architecture limits.
  - Input/output/error behavior: Operators can build/install/load authored config and native bundle without cancelled governance steps.
  - Remove or migrate: Remove exact module-declaration/manifest scope/permission posture requirements and current obsolete commands; keep normal license/distribution requirements.
  - Non-goals: No historical archive rewrite or unsupported native config switch.
  - Acceptance after this change is complete: The documented build/start commands SHALL match the actual local-architecture acceptance and distinguish source, download, native load and image observations.

- [x] 1.5 Run packaging acceptance and repair installation regressions (1.00 h estimate).
  - Prerequisite: Tasks 1.1–1.4.
  - Exact targets: Containerfile, packaging tests, native smoke driver and docs.
  - Ordered edits: Run focused unit/bundle tests once and build/run the local-architecture image. Observe config-path writes during bundle/image build and native startup; copied authored YAML is permitted as installation, generation/rewriting is not. Record each asset download/checksum outcome actually exercised and local image version.
  - Input/output/error behavior: Installed native runtime and notices remain usable; no production YAML generator or manifest consumer remains.
  - Remove or migrate: No dead manifest script or OMP permission test remains.
  - Non-goals: No platform posting, paid model or unobserved architecture certification.
  - Acceptance after this change is complete: deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi tests/utils/omp-packaging.test.ts tests/utils/omp-version.test.ts tests/acp/omp-owned-module-bundle-smoke.test.ts; podman build -f Containerfile -t air-friends-omp-parity-local .; podman run --rm --entrypoint omp air-friends-omp-parity-local --version. Expected 18.6.1 and native fixture ACP load/config operation success; report any missing namespace/download prerequisites explicitly.

