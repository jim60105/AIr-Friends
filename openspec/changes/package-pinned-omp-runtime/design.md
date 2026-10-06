# Design — package-pinned-omp-runtime

## Context

Row 20 is the packaging terminus of the OMP batch. Rows 8 (owned settings assets `agent-config/omp/restricted.yml`, `native-yolo.yml`, `models.yml` + the `SYSTEM.md` prompt mapping), 9 (`src/utils/omp-paths.ts` with `OMP_TRUSTED_EXTENSION_PATH` as a dev-tree source constant, "final install location coordinated with row 20"), 12 (module tree authored at that contracted dev path; its ownership rule trusts "row 20's checksummed install"), 13/14b/17/18 (serial siblings 12→13→14b→17→18, each stating "must land before row 20's digest cut"), and 19 (6th slot reserved-but-unconsumed; "row 20's digest cut carries no new extension module from row 19") all terminate here. The image today installs only OpenCode (`opencode-unpacker` stage with pinned `OPENCODE_VERSION` + per-arch checksum args, install to `/usr/local/bin/opencode`, `agent-config/opencode.json` to the user config dir). Design §12 fixes the release assets and SHA-256 table; §14 limits automated evidence to unit/mock; §15 makes container execution, architecture packaging, and installed-binary checks user-owned.

## Goals / Non-Goals

**Goals:** A checksum-verified, fail-closed, exact-tag install of official `omp` 18.6.1 (executable + LICENSE + THIRD-PARTY-NOTICES) mirroring the OpenCode pattern; the row-8 settings tree, prompt artifact, and FINAL row-12…18 extension tree installed outside agent-writable roots with recorded digests; an explicit, code-resident dev→image path mapping that keeps development behavior byte-identical; warn-only OMP version health with the env override documented across the trio; every claim testable by Containerfile-parse and unit/mock assertions without ever building an image or running `omp`.

**Non-Goals:** Enforcement semantics (rows 12/13/14 gates, P0 verdicts), dashboard/restart flows (row 22), OpenCode packaging or any OpenCode pin bump (row 15's audit note is explicitly not acted on), extension/settings CONTENT edits (frozen; install-only), any config/env/Helm field beyond `AGENT_OMP_MIN_VERSION`, and any live container/arch/binary acceptance (§15 user-owned).

## Decisions

### D1. Stage shape copies the proven OpenCode unpacker pattern, one stage per binary

New `FROM base AS omp-unpacker` stage with `ARG OMP_VERSION=18.6.1`, `ARG OMP_SHA256_X64=c92a6846d02984e84f07c6362d18add3783f528f494ffcf1e0f26e594f327463`, `ARG OMP_SHA256_ARM64=cb7815330bb117877e4e133562ea82e3001ee470e47393552507b5a7f0407f4a`, identical `case "${TARGETARCH}"` arm handling (amd64→x64, arm64→arm64, `*) … exit 1`). Checksum verification (`sha256sum -c -`) precedes every `install`/`COPY --from` consumption, so a mismatch aborts the build before any install side effect — the same fail-closed shape as lines 49–58. Notices get their own args `OMP_LICENSE_SHA256=16c45f9d667442781f03fa198914cc39abcaa48ec5ed8f644643e554ca2fbf63`, `OMP_NOTICES_SHA256=d0c2e7c05bb4d755044b13fa560be58d01ab7c980b87892400a979397e569a8b`, verified the same way. Alternative rejected: downloading inside the final stage — it bakes release-fetch failures into every rebuild of an unchanged layer and diverges from the existing pattern.

### D2. Executable assets are arch-allowlisted, not filename-pinned

The design table names `omp-linux-x64` / `omp-linux-arm64`. The Containerfile base is `denoland/deno:debian` — the unpin-tagged `debian` tag floats the Debian release, so a fully pinned exact filename (`-glibc`, `-musl`, or a Debian-versioned suffix) would silently change the libc the runtime runs against whenever upstream moves the tag's default. A silent libc swap is a larger unpinning than the filename flexibility bought. The rule: within the exact `v18.6.1` release, select the unique asset whose name matches `omp-linux-{OC-arch}[^/]*` for the resolved arch — zero or more than one match fails the build — and pin its SHA-256 verbatim, so any asset-name or content change under the same tag breaks the checksum step fail-closed rather than installing silently. The stage comment records the asset name actually observed at implementation time. The two notices filenames ARE pinned exactly (`LICENSE`, `THIRD-PARTY-NOTICES.txt`).

### D3. Install contract and ownership

`/usr/local/bin/omp` installed `--chown=0:0 --chmod=0755`. The existing binaries use `$UID:0` 775; `omp` deliberately diverges because `$UID` is the agent's own user inside the image — a group-writable agent binary is self-modifiable by the process the restricted boundary governs, contradicting row 12's owned/non-writable ownership model. The app process needs no write bit, only exec. Settings overlays install to `/opt/air/omp/config/…` (dirs 0755, files 0644, root-owned), the prompt artifact to `/opt/air/omp/prompt/SYSTEM.md`, the extension tree to `/opt/air/omp/extension/…`, all root-owned with modes that leave the runtime user read-only. Alternative rejected: the user-home config-dir pattern used for `opencode.json` — `/home/deno` is agent-writable, and design §12 requires owned settings "outside agent-writable roots".

### D4. The dev→image mapping is exported code, not a Dockerfile convention

`src/utils/omp-paths.ts` gains: `OMP_IMAGE_EXTENSION_ROOT = "/opt/air/omp/extension"`, `resolveOmpTrustedExtensionPath()` (image entry `<root>/index.ts` when it exists, else the existing dev `OMP_TRUSTED_EXTENSION_PATH`), `resolveOmpConfigPath(devPath)` (`/opt/air/omp/config/<basename>` when it exists, else dev path), and `resolveOmpSystemPromptPath()` (the row-8 mapping, image-first for the packaged artifact, with the operator mount `/app/prompts/system_prompt_override.md` honored exactly as row 8 defined — mounts are operator-owned and never relocated). Existence-based resolution means development checkouts (no `/opt/air/omp`) keep byte-identical dev behavior; the factory's presence check and fail-closed error stay row 9's, untouched. Consumers rows 12/13/14b import the resolver instead of the raw constant where the launch argument is formed. Alternative rejected: build-time sed/env rewriting of paths — invisible in unit tests, and breaks any environment where the image tree is absent.

### D5. Digest manifest: `PACKAGE-MANIFEST.sha256` + recut invariant

The final stage runs `sha256sum` over the installed `/opt/air/omp` tree (extension files, `config/*.yml`, `prompt/SYSTEM.md`) writing `PACKAGE-MANIFEST.sha256` into that root, root-owned, non-writable, with a header comment recording `OMP_VERSION`, the row-19 reserved-but-unconsumed 6th-slot fact, and the serial composition 12→13→14b→17→18. This is the auditability artifact rows 12's dependency-closure trust cites. **Invariant:** digests are cut only over final content; if any successor change (row 21/22 or any batch/review insertion) lands content touching `/opt/air/omp` inputs, that change recuts the manifest in the same commit — a stale manifest after a content change is a task-failure condition, documented in `docs/OMP_PACKAGING.md` and the Containerfile comment.

### D6. Version health mirrors `verifyOpenCodeVersion`, with one scoped divergence

`src/utils/omp-version.ts`: same exports shape (`KNOWN_GOOD_OMP_MIN_VERSION = "18.6.1"`, 5000 ms timeout, `OmpVersionCheckResult = "ok"|"below_minimum"|"unknown"`, `getMinimumOmpVersion()` honoring `AGENT_OMP_MIN_VERSION` with the same blank-means-default rule, injectable `detect`/`log`/`commandName`, timeout-raced SIGKILL, parse-tolerant semver). Markers: `OMP version check: OK|BELOW_MINIMUM|UNKNOWN`, WARN-only on non-OK, never throws, never blocks startup, no download/upgrade side effect. Divergence (stated): bootstrap calls `verifyOmpVersion()` only when the resolved agent type is `omp`, because unlike OpenCode, `omp` is absent-by-design on OpenCode-only installs and a permanent UNKNOWN warning there would train operators to ignore the marker. Image-intended version is exact (`OMP_VERSION=18.6.1`); the runtime check is warn-only per design §12 — the constant equals the pin so any environment drift surfaces.

### D7. The trio gets documentation-only sync, mirroring today's treatment

`AGENT_OMP_MIN_VERSION` is a runtime env var read exactly like `AGENT_OPENCODE_MIN_VERSION` (env-only; no loader key, no chart value). Today's OpenCode counterpart is present in all three files as commented documentation and nothing more; row 20 syncs identically: commented block in `config.example.yaml` beside the OpenCode version-check comment, commented entry in `.env.example`, commented entry in `helm/values.yaml`'s env map. The pin itself remains a Containerfile ARG — `OPENCODE_VERSION` is likewise absent from the trio. The honest answer to "build-time or runtime?": the override is runtime-consumed (the bootstrap check reads env), so it belongs in the trio's env documentation; the exact-version pin is build-time and belongs only in the Containerfile.

### D8. Test surface without ever touching Docker

`tests/utils/omp-packaging.test.ts`: parse `Containerfile` (regex/line structure, read via `Deno.readTextFile`) asserting the OMP stage exists with the exact-18.6.1 default, the four digest args byte-equal to the design table, arch mapping branches, that every `sha256sum -c` precedes the corresponding install/COPY, the install destinations, root-owned modes for `omp`/`/opt/air/omp`, that `agent-config/opencode.json`/`OPENCODE_*` sections appear byte-unchanged relative to their pre-change content recorded in the fixture, and the no-new-Bun rule (no `bun` install command in the OMP stage; the pre-existing Deno base image is noted as pre-existing, not proven absent). `tests/utils/omp-version.test.ts`: mocked detectors (OK at/above 18.6.1, below, unparseable, spawn failure, timeout) asserting marker strings, WARN levels, env override incl. blank-ignored, and "never throws / never blocks". Path-resolver tests: fake filesystem roots for image-present and dev-fallback; assert the image tree never lands under `/app/data`, `/app/prompts`, or `/home/deno`. Manifest test: fixture tree + expected manifest format, recut-invariant comment present. Config-trio sync test: the three files each carry `AGENT_OMP_MIN_VERSION` documentation and the test asserts the env-var name appears in all three. Mock outputs are process-spawn fakes; nothing runs docker, nothing downloads, nothing executes `omp`.

## Risks / Trade-offs

- **The digest values were transcribed from the approved design table, and this change never downloads the assets** → if upstream's v18.6.1 assets ever differ, the build fails closed at the checksum step (never installs wrong bytes); §15's user build is the first real verification, and the spec says so.
- **Arch-allowlist could select an unexpected variant** → uniqueness + digest pin bound the blast radius to build failure; observed name recorded in the stage comment.
- **Existence-based path resolution could pick the image tree in a development checkout that happens to have `/opt/air/omp`** → that presence IS the deployment signal; tests cover both branches, and development checkouts are not supposed to own `/opt/air`.
- **Root-owned `omp` diverges from the image's `$UID:0` convention** → intentional; documented in the Containerfile comment with the self-modification rationale.
- **warn-only version health can lull** → same posture the design approved for OpenCode: the pin is prevention, the marker is observability; docs repeat the sentence.

## Migration Plan

Additive: new stage + COPYs in `Containerfile`, new module, new docs, one bootstrap call site, appended path helpers. OpenCode deployments see zero behavior change (version check is agent-type-scoped; no existing path or arg moves). Existing images rebuild with the new stage; no config migration, no runtime data migration.

## Open Questions

None blocking: the exact `omp` asset filenames are recorded during implementation (allowlist rule makes them non-decisional), and real-asset digest confirmation is §15 user-owned by explicit design.
