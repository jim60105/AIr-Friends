# Design

## Context

See proposal.md — Why. Observed state:

- The image's `base` stage installed `git nodejs npm` from the apt archive. On the floating Debian 13 base those packages resolve to Node 20.19.2 / npm 11.x, below the engine requirements of the two JavaScript consumers actually shipped in the image:
  - the `skills` CLI that `src/core/skill-installer.ts` drives via `npx --yes --package=skills skills add <repo> -a universal -s <skill> -g -y --copy` declares `engines.node >= 22.20.0` and imports `glob` from `node:fs/promises`;
  - the globally installed `agent-browser` package declares `engines.node >= 24.0.0`.
- Container log evidence (`tmp/air-friends.txt`) showed the failure for every configured entry (`blog-post`, `docx`, `pdf`, `image-generator-sd-webui`, `image-prompt-builder-nl`) with exit code 1 and stderr `npm WARN EBADENGINE ... package: 'skills@1.7.2', required: { node: '>=22.20.0' }, current: { node: 'v20.19.2' }` followed by `SyntaxError: The requested module 'fs/promises' does not provide an export named 'glob'`. A fifth entry, `chinese-content-writing-guideline`, was skipped by design as a bundled/reserved collision and is out of scope.
- The repository already pins and checksum-verifies downloaded executables in the `opencode-unpacker`, `omp-unpacker` and `dumb-init` steps; the Node runtime is provisioned the same way rather than through a moving distribution package.

## Goals / Non-Goals

**Goals:** the image provides one Node.js runtime that satisfies every JavaScript consumer packaged in it; that runtime is a pinned official tarball verified against a per-arch SHA-256 before it is extracted; the distribution packaging no longer supplies a Node runtime; external skill installation cannot fail on an unsupported runtime; the contract is documented where operators configure external skills.

**Non-Goals:** changing the installer command line, its private staging HOME, its `--copy` publication, its collision/traversal refusals or its failure isolation; changing any configuration field, environment variable or Helm value; adding a runtime version-selection knob; introducing a second package manager, a version manager, or a Node install that is not the pinned tarball.

## Decisions

### D1. Pin the official tarball per architecture, verify before extraction

`ARG NODE_VERSION=24.22.0` selects the exact upstream release; `TARGETARCH` maps `amd64`→`x64` and `arm64`→`arm64`, and any other value exits naming the unsupported architecture. The download is verified with `sha256sum -c -` against `NODE_SHA256_X64`/`NODE_SHA256_ARM64` **before** `tar -xJf` extracts into `/usr/local`, so a moved upstream tarball aborts the build without installing bytes. `24.x` is the current Active LTS line and clears both consumers' floors (`>= 22.20.0`, `>= 24.0.0`).

Alternatives rejected: keeping the apt `nodejs`/`npm` packages (they float with the base and are too old — this is the defect); the NodeSource apt repository (adds a third-party trust root and still floats a minor line); `nvm`/`fnm` (a version manager to select one pinned version is a moving part the image does not need); a floating `latest` tarball (unreproducible, and the project's convention is exactly-pinned downloads with checksums).

### D2. Remove the distribution Node packages from the apt list

Leaving `nodejs`/`npm` installed would place a second, older interpreter earlier on `PATH` under `/usr/bin` while the pinned tarball lives under `/usr/local/bin`, making which interpreter a consumer gets a coincidence of `PATH` order. Removing them makes the pinned runtime the only one, and `xz-utils` is added so the `.tar.xz` asset can be unpacked.

### D3. State the runtime contract in the documentation that configures external skills

The image's guarantee and the host's requirement are different facts for the operator: the image ships the pinned runtime, while a direct (non-container) run must supply Node ≥ 22.20.0 itself. `docs/extending/external-skills.md` and `docs/getting-started/quickstart.md` state the minimum; `AGENTS.md` lists `node`/`npm` among the container binaries with the reason the tarball is used instead of the apt packages; `CHANGELOG.md` records the fix under `[Unreleased] → Fixed`.

## Risks / Trade-offs

- **A pinned Node version eventually needs a deliberate bump** → `NODE_VERSION` and both digests are build arguments with the verification command documented inline; a bump is one intentional edit and recomputation of both digests, and a wrong digest fails closed at build time.
- **The tarball install adds a network fetch to the `base` stage** → the digest is verified before extraction, so a compromised or moved asset cannot be installed; the stage already performs apt fetches.
- **`/usr/local/bin` precedence over any distro interpreter** → the distro packages are removed in the same change, so there is exactly one interpreter.

## Migration Plan

No data migration and no operator action. Deploying the rebuilt image replaces the Node runtime in place; existing `agent.externalSkills` configuration is reused verbatim and starts succeeding. Roll back by rebuilding the previous image; the installer's behavior is unchanged, so no configuration or skill-tree migration is implied either way.

## Verification Performed

- `podman build --target base` with the edited Containerfile: SUCCESS; in-image `node --version` = `v24.22.0`, `npm --version` = `11.19.1`, tarball `sha256sum -c -` OK.
- Reproduced the exact failure in the unmodified base image with the distro Node: `npx --yes --package=skills skills add jim60105/copilot-prompt -a universal -s pdf -g -y --copy` → exit 1, the same `fs/promises ... 'glob'` SyntaxError, nothing materialized in the private staging HOME.
- With the pinned Node 24 tarball installed, the identical command → exit 0, materialized `<private HOME>/.agents/skills/pdf` (the path the installer publishes from); it also succeeds as the runtime user (`--user 1000:0`, uid 1000 gid 0).
- `npm install -g agent-browser` under the new Node → `agent-browser 0.39.1` at `/usr/local/bin/agent-browser`; `npx playwright --version` → `1.64.1`.
- `deno test --allow-read tests/core/bundled-skills.test.ts` → 6 passed (the test parses the Containerfile; the edit keeps exactly one skill-tree COPY).
- A full `--target final` image build is the remaining acceptance check and is owned by the operator.

## Dependencies and Conflicts

None. This change touches only the `base` stage's runtime provisioning and documentation; it declares no edge to any other in-flight change.
