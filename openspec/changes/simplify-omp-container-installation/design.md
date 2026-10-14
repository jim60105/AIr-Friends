# Design

## Context

Containerfile pins OMP 18.6.1 and x64/arm64 binary plus license/notice SHA-256 values, verifies bytes before install, installs the executable/root artifact tree under special root ownership, builds a single ESM artifact and invokes `generate-omp-manifest.sh`. OpenCode binaries/config use `$UID:0` and mode 775. The native cutover has already removed physical deployment evidence and declaration embedding, but the image manifest command still has a real build consumer.

## Goals / Non-Goals

Retain exact-version download verification, ordinary notices and native ESM installation. Adopt existing OpenCode file permissions; remove OMP-only physical trust and internal digest manifests. No version bump, network-stack change, new JS runtime, duplicate skill tree or config generation.

## Decisions

1. Preserve all download URLs/asset selection, four OMP checksum arguments and fail-before-install ordering. Preserve OpenCode/download/dumb-init steps unchanged. Native version observation via `omp-version.ts` is unchanged.
2. Change OMP executable and authored settings/prompt/bundle installation ownership/modes to existing `$UID:0`/775 conventions. Keep stable `/opt/air/omp/...` runtime paths as locations, with no ownership authority attached. The model asset moved to `/home/deno/.omp/agent/models.yml` by the core remains authored and content-faithfully copied. Normal notices remain installed under `/licenses/omp`; apply existing normal license packaging conventions without removing required notices.
3. Remove the unpack-stage `OMP_VERSION` file used only by the manifest, `/opt/air-build` version staging, manifest invocation/recut/chown/chmod and its dead script. Keep native ESM bundle invocation as a build step with sibling canonical source/deno lock input. No YAML is parsed/written by the bundler. No module fingerprint or deployment declaration is emitted.
4. Replace packaging tests with behavior evidence: successfully loading the installed binary/bundle, checksum failure before installation, usable authored native config and packaged license availability. Remove UID/mode/inode/immutability assertions and tests comparing full file strings or manifest inventories. Do not add inverse tests that the packaged tree must be writable.
5. Modify the existing 'Single Packaged Skill Tree For Every Agent Type' requirement only to remove its obsolete promise that the old owned tree and manifest scope remain unchanged. Preserve one authored skill tree, publication/install root and pinned versions.

## Risks / Trade-offs

Image builds depend on architecture download access and namespace privileges. Record observed version/architecture and distinguish native local loading from image acceptance. A successful local test never certifies both architectures. Checksum-negative tests use local fixture assets or injected build arguments and do not claim the real release was downloaded unless it was.

## Migration Plan

Apply after the native-runtime cutover, so module evidence has no consumers before permissions/manifest removal. Update current packaging docs and CHANGELOG in this unit. No archive, version migration or compatibility installation layout.
