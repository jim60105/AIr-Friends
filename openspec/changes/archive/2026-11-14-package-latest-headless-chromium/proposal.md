# Proposal

## Why

The browser that `agent-browser` drives is fetched by two unpinned `npx playwright` steps at image build time, and only a source-level detector (`detectPlaywrightBinarySync()`) makes the CLI find it. Browser freshness across rebuilds is intended and stays that way, but the current path has no integrity check, no fixed OS dependency set, no launch verification, and drags in the whole Playwright toolchain plus its resolved apt/font layer just to download one headless-shell binary.

## What Changes

- Replace `npx playwright install-deps chromium-headless-shell` and `npx playwright install chromium-headless-shell` with the **latest** `@sparticuz/chromium` release pack for the target architecture: the release is resolved at build time, the pack is verified against the digest that release publishes for it, and the resolved version is printed in the build log so a built image is traceable. Version pinning is an explicit non-goal — every rebuild picks up the newest browser.
- Unpack the pack's Brotli-compressed `chromium.br` into a real executable at image build and install it at the contracted PATH name `/usr/local/bin/chromium`, following the image's existing `$UID:0` + `775` binary convention.
- Replace the Playwright-resolved apt layer with an explicit, minimal Debian dependency set derived from the binary's own linkage, plus the font packages Playwright's tool layer used to supply, so screenshot text rendering does not regress.
- Add fail-closed build verification in the image: the browser's reported version must match the resolved release's major version, and a bounded CDP startup probe (launch with `--remote-debugging-port=0`, wait for `DevToolsActivePort`, tear down) must succeed before the build completes.
- Remove `detectPlaywrightBinarySync()` from `src/acp/agent-factory.ts` and its two call sites plus their tests. Browser resolution becomes `agent-browser`'s own documented order (its install cache, then system PATH); the operator escape hatch `AGENT_BROWSER_EXECUTABLE_PATH` keeps working unchanged and stays in the sandbox environment allowlist.
- Remove the Playwright ffmpeg symlink step; the already-installed system `ffmpeg` on PATH serves `agent-browser record`.
- Install the browser package's MIT license under `/licenses/chromium/LICENSE`; the license text is content-pinned by digest (the browser is not), because an unnoticed license change should fail loudly rather than ship silently.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `container-packaging`: adds the pinned headless-browser artifact and its build-time launch verification, replacing the Playwright download/dependency steps the image currently runs.
- `acp-integration`: adds the browser executable resolution contract (operator override passes through unchanged; no Playwright cache scan; otherwise delegated to `agent-browser`'s own discovery).

## Impact

- **Containerfile**: new `chromium-unpacker` stage (latest-release resolution + per-arch published-digest verification + content-pinned license digest), final-stage apt set and browser install, removal of both `npx playwright` steps and the ffmpeg symlink loop.
- **Code**: `src/acp/agent-factory.ts` (remove the Playwright detector and both env-injection call sites); `tests/acp/agent-factory.test.ts` (drop the detector tests, keep the env-override test). `src/acp/sandbox-manager.ts` is unchanged — `AGENT_BROWSER_EXECUTABLE_PATH` stays allowlisted.
- **Docs/changelog**: `CHANGELOG.md`, `AGENTS.md` (ACP Client / container binaries sections), and the browser provisioning note in `docs/agent/`.
- **Build dependencies**: removes build-time Playwright (unversioned `npx`) entirely; adds one ~70 MB release-pack download per architecture (requires `api.github.com` plus the release asset host at build time) and Debian `libnss3`, `libnspr4`, `libexpat1`, `libfontconfig1`, `libfreetype6` and the font packages.
- **Runtime behavior**: unchanged launch interface (`agent-browser` still resolves a headless-only Chromium through CDP); no new service, port, config key, or environment variable. No configuration-document trio change.
- **BREAKING**: none. `--headed` was already unavailable in the image (headless-shell only) and remains unavailable.
