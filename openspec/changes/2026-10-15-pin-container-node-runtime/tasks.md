# Tasks

## 1. Node.js runtime provisioning in the `base` stage

- [x] 1.1 In `Containerfile`, remove `nodejs npm` from the `apt-get install` list and add `xz-utils` (for the `.tar.xz` asset). Verify: the stage installs no distribution Node runtime, so no interpreter under `/usr/bin` can shadow the pinned one.
- [x] 1.2 Add the pinned official Node.js tarball install: `ARG NODE_VERSION=24.22.0`, `ARG NODE_SHA256_X64=cc2f601cee82d9a5a233302fe307abc600727035fd7d2c3a3571755989e95008`, `ARG NODE_SHA256_ARM64=fef00bb4d36e1c50104a9775a10359beee98f162b4104dd12472c75065c6a143`; map `TARGETARCH` (`amd64`→`x64`, `arm64`→`arm64`, anything else → `exit 1` naming `unsupported architecture`); `curl` the exact-version `.tar.xz`; `sha256sum -c -`; only then `tar -xJf ... -C /usr/local --strip-components=1 --no-same-owner`; finish with `node --version && npm --version`. Verify: it mirrors the existing pin-and-checksum convention of the OpenCode, OMP and `dumb-init` steps, and the digest check precedes extraction so a moved upstream tarball aborts the build.
- [x] 1.3 Keep the document-level rationale (the two `npx`/`npm` consumers, the observed Debian-13 Node 20 failure, the digest-verification command) as a comment above the step. Verify: the reason the distribution packages were dropped and the one-line way to recompute both digests on a version bump are recorded next to the step.

## 2. Documentation and changelog sync

- [x] 2.1 `CHANGELOG.md`: add a `[Unreleased] → Fixed` entry stating that configured `agent.externalSkills` install again because the image now ships the pinned Node.js 24 LTS runtime instead of the distribution's Node 20. Verify: the entry describes the user-visible symptom (`fs/promises` import error) and the fix.
- [x] 2.2 `docs/extending/external-skills.md`: state that installation is driven by Node.js `npx` and requires Node.js ≥ 22.20.0 (the `skills` CLI's requirement), that the container image already ships the pinned Node.js 24 LTS, and that a host-side run must supply the version itself. Verify: the paragraph gives the operator the host requirement and the image guarantee.
- [x] 2.3 `docs/getting-started/quickstart.md`: change the host prerequisite to "Node.js 22.20.0 以上版本". Verify: the prerequisite matches the documented installer requirement.
- [x] 2.4 `AGENTS.md`: add `node` / `npm` to the container-binaries list, naming Node.js 24 LTS pinned as an official tarball with per-arch SHA-256 and distinguishing it from the Debian `nodejs`/`npm` packages whose Node 20 is below what the `skills` installer CLI and the global `agent-browser` require. Verify: the Container Binaries bullet covers the runtime the image now provides.

## 3. Verification

- [x] 3.1 `podman build --target base` with the edited Containerfile: SUCCESS; in-image `node --version` = `v24.22.0`, `npm --version` = `11.19.1`, and the tarball's `sha256sum -c -` OK. Verify: the pinned runtime is installed and self-consistent in the image.
- [x] 3.2 Reproduce the failure and the fix in the image: in the unmodified base image (distro Node) `npx --yes --package=skills skills add jim60105/copilot-prompt -a universal -s pdf -g -y --copy` exits 1 with the same `fs/promises ... 'glob'` SyntaxError and materializes nothing in the private staging HOME; with the pinned Node 24 tarball the identical command exits 0 and materializes `<private HOME>/.agents/skills/pdf`. Verify: the change addresses the observed root cause at the exact command the installer runs.
- [x] 3.3 Confirm the installer path works for the runtime user: the same command under `--user 1000:0` (uid 1000, gid 0) exits 0. Verify: publication is not dependent on running as root.
- [x] 3.4 Confirm the image's other JavaScript consumer: `npm install -g agent-browser` under the new Node yields `agent-browser 0.39.1` at `/usr/local/bin/agent-browser`, and `npx playwright --version` prints `1.64.1`. Verify: the `engines.node >= 24.0.0` consumer is satisfied by the pinned runtime.
- [x] 3.5 Run `deno test --allow-read tests/core/bundled-skills.test.ts` → 6 passed. Verify: the Containerfile-parsing test still sees exactly one skill-tree COPY after the edit.
- [x] 3.6 Run `openspec validate 2026-10-15-pin-container-node-runtime --strict` → valid. Verify: the change's artifacts satisfy the schema.
- [x] 3.7 Build the full image (`podman build -f Containerfile --target final`) → SUCCESS end to end with the edited `base` stage. Verify: every later stage (`npm install -g agent-browser`, `npx playwright install-deps` / `install`, the OMP extension bundle) still builds with no distribution `nodejs`/`npm` packages present.
- [x] 3.8 Run the real installer in the built final image as the runtime user (`--user 1000:0`, `deno eval` importing `@core/skill-installer.ts` from `/app`) → logs `Published skill pdf from jim60105/copilot-prompt to /tmp/dest/pdf` and the published tree exists. Verify: the container-startup path that produced the reported failure now publishes a configured skill.

## Workflow follow-up

- A full `--target final` image build was performed locally and succeeded (3.7/3.8); image-build acceptance inside CI stays operator-owned as before. Archive this change once the image ships.
