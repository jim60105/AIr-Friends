# Proposal

## Why

The stock image shipped the base distribution's `nodejs`/`npm` packages. On Debian 13 those resolve to Node 20.19.2, which is below the engine requirement of both JavaScript consumers the image bundles: the `skills` CLI that the daemon's external-skill installer drives (`engines.node >= 22.20.0`; it imports `glob` from `node:fs/promises`, exported only from Node 22) and the globally installed `agent-browser` package (`engines.node >= 24.0.0`). At container startup every configured `agent.externalSkills` entry therefore failed with `SyntaxError: The requested module 'fs/promises' does not provide an export named 'glob'` and exit code 1, so no external skill was ever installed. External Skill Auto-Installation is a required behavior of this deployment, so the runtime it depends on must satisfy its consumers by construction, not by accident.

## What Changes

- **The image provisions its own Node.js runtime** from the official upstream tarball, pinned by `ARG NODE_VERSION` (default `24.22.0`) and selected per `TARGETARCH` (`amd64`→`x64`, `arm64`→`arm64`), with the tarball verified against a per-architecture SHA-256 build argument (`NODE_SHA256_X64`, `NODE_SHA256_ARM64`) **before** extraction; an unsupported architecture SHALL fail the build naming it and a checksum mismatch SHALL abort the build before any install step consumes the bytes. This mirrors the existing pin-plus-checksum convention of the OpenCode, OMP and `dumb-init` steps.
- **The base distribution's `nodejs`/`npm` apt packages are removed**; `xz-utils` is added to unpack the `.tar.xz` asset. No JavaScript consumer in the image resolves a Node runtime other than the pinned one.
- **The pinned runtime satisfies every packaged JavaScript consumer**, so external skill installation can no longer fail on an unsupported Node runtime.
- **Documentation and changelog state the runtime contract**: the external-skills chapter and the quickstart state the `skills` CLI's Node.js minimum and that the image ships the pinned Node 24 LTS, `AGENTS.md` lists `node`/`npm` among the container binaries, and `CHANGELOG.md` records the fix.

No configuration field, environment variable, Helm value, or API changes. No change to the installer's command line, destination or publication rules.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `container-packaging`: the image's runtime provisioning — a new requirement that the Node.js runtime consumed by the image's `npx`/`npm` consumers is installed from a pinned official tarball whose per-arch SHA-256 is verified before extraction, replacing the distribution packages.
- `configuration-and-deployment`: External Skill Auto-Installation — a new requirement that the runtime the installer CLI executes on satisfies its declared engine requirement, so a configured external skill cannot fail on an unsupported Node runtime.

## Impact

- `Containerfile` (`base` stage): the apt package list and the new pinned Node.js tarball step; every later step (`npm install -g agent-browser`, `npx playwright install-*`, and the runtime external-skill installer `src/core/skill-installer.ts`) keeps its command line and now runs the pinned interpreter.
- Documentation: `CHANGELOG.md`, `docs/extending/external-skills.md`, `docs/getting-started/quickstart.md`, `AGENTS.md`.
- No code change: `src/core/skill-installer.ts` and its external-install behavior are untouched.
- **Verification performed**: the `base` stage and a full `--target final` image build both succeeded with these edits, and the real `installExternalSkills()` run inside the built image (as `--user 1000:0`) published a configured skill; image-build acceptance inside CI stays operator-owned as before.
