# Tasks

## 1. Latest-release browser unpack stage

- [x] 1.1 Add a `chromium-unpacker` stage to `Containerfile` based on `base` that resolves the newest non-prerelease release of `Sparticuz/chromium` at build time via `GET https://api.github.com/repos/Sparticuz/chromium/releases/latest`, and fails naming the API error if resolution fails. Verify: the build log prints the resolved tag; a build with an unreachable API fails at this step.
- [x] 1.2 Select exactly one pack asset for the target architecture (`chromium-v<version>-pack.x64.tar` / `.arm64.tar`), failing the build on zero or multiple matches and on any architecture outside `amd64`/`arm64`; treat a missing asset digest as a failure. Verify: a build with an unsupported `TARGETARCH` fails with the architecture name; an asset-set mismatch fails with the match count.
- [x] 1.3 Download the selected pack and verify it against the digest published in the same API response before unpacking or installing anything. Verify: a build with a one-byte-corrupted download (or an intentionally mismatched digest) aborts before install.
- [x] 1.4 Decompress `chromium.br` to a real executable (Brotli, in-stage, using the base image's Bun), assert the reported major version equals the release tag's major (e.g. `Chromium 153.` for `v153.0.0`), log the full version, and fail otherwise. Verify: the build log shows both the resolved tag and the full browser version; a wrong-major expected value fails the step.
- [x] 1.5 Add a test that parses `Containerfile` and asserts the new browser packaging contract: latest-release resolution present, exactly one digest verification before unpack, no `playwright` invocation anywhere, browser installed at `/usr/local/bin/chromium`. Verify: `bun --no-env-file test --timeout=120000 --isolate tests/scripts/browser-packaging.test.ts` passes.

## 2. Final-stage install, dependencies, and build probe

- [x] 2.1 Replace `RUN npx playwright install-deps chromium-headless-shell` with an explicit apt install of `libnss3 libnspr4 libexpat1 libfontconfig1 libfreetype6 ca-certificates` plus `fonts-liberation fonts-unifont fonts-noto-color-emoji fonts-wqy-zenhei fonts-ipafont-gothic fonts-tlwg-loma-otf fonts-freefont-ttf`, using the same cache mounts. Verify: build log shows exactly these packages; no crash-repository, X11, ATK, GBM, or asound package is pulled in for the browser.
- [x] 2.2 Remove `RUN npx playwright install chromium-headless-shell` and the Playwright ffmpeg symlink loop; keep the system `ffmpeg` install. Verify: a built image has no `~/.cache/ms-playwright` and `ffmpeg -version` still runs inside it.
- [x] 2.3 Copy the unpacked browser and its license into the final image (`/usr/local/bin/chromium` under the `$UID:0` + `775` convention, `/licenses/chromium/LICENSE`), and ensure the directory-mode RUN still runs after every `COPY --link`. Verify: inside the built image `/usr/local/bin/chromium` is executable and `/licenses/chromium/LICENSE` is present with the project `/licenses/LICENSE` unchanged.
- [x] 2.4 Add the bounded CDP launch probe after `USER $UID`: launch the installed browser with `--headless=new --no-sandbox --disable-dev-shm-usage --remote-debugging-port=0 --user-data-dir=<temp>`, require `DevToolsActivePort` within the timeout, then tear down and remove the profile. Verify: probe passes in the image build and a build with a removed runtime library fails at this step (simulate by omitting `libnss3` once).
- [x] 2.5 Add a `browser` check to `scripts/image-smoke.sh` that runs the same version and CDP assertions inside the built image under `--user 1000:0 --cap-drop ALL`. Verify: `sh scripts/image-smoke.sh --only browser <final-image> <test-image>` prints `ok browser`.

## 3. Resolution cutover

- [x] 3.1 Remove `detectPlaywrightBinarySync()` and both `AGENT_BROWSER_EXECUTABLE_PATH` injection sites in `src/acp/agent-factory.ts`, keeping the operator env override pass-through and the `SandboxManager` allowlist entry. Verify: `bun run check` and `bun run lint` pass; no `ms-playwright` or `detectPlaywrightBinarySync` reference remains in `src/`.
- [x] 3.2 Update `tests/acp/agent-factory.test.ts`: delete the detector tests, keep/adjust the env-override test, and add a case asserting no path is injected when the override is unset. Verify: `bun --no-env-file test --timeout=120000 --isolate tests/acp/agent-factory.test.ts` passes.
- [ ] 3.3 Run the focused ACP/sandbox suites that assert the env allowlist and spawn shapes. Verify: `bun --no-env-file test --timeout=120000 --isolate tests/acp/ tests/integration/` passes.

## 4. Documentation

- [x] 4.1 Document the browser provisioning and resolution order in `docs/agent/` (latest-release resolution and integrity check, `/usr/local/bin/chromium`, operator override, the `--dump-dom` limitation) and update `AGENTS.md`'s container-binaries and ACP sections. Verify: each documented command/path exists in the final image.
- [x] 4.2 Add a `CHANGELOG.md` entry covering the browser packaging change, the removed Playwright build dependency, the intentional latest-release behaviour (a rebuild may ship a newer browser), and the resolution change for developer machines (set `AGENT_BROWSER_EXECUTABLE_PATH` or run `agent-browser install`). Verify: entry follows the existing heading/format conventions.

## 5. Integration verification

- [x] 5.1 Build the final image for `linux/amd64` and run the browser probe plus `agent-browser open about:blank` as `1000:0` inside it. Verify: both succeed, the build log shows the resolved release, and no Playwright cache exists.
- [x] 5.2 Build the final image for `linux/arm64` (or the arm64 unpacker stage) and confirm the installed binary is aarch64 and the probe passes. Verify: `file /usr/local/bin/chromium` reports ARM aarch64 and the build probe succeeds.
- [ ] 5.3 Run the full CI command set. Verify: `bun run fmt:check`, `bun run lint`, `bun run check`, and `bun --no-env-file test --timeout=120000 --isolate tests/` pass.
- [x] 5.4 Run `openspec validate package-latest-headless-chromium --strict`. Verify: validation passes.

## Workflow follow-up

- Archive the change after review requirements are satisfied.
- Verify the archived spec delta merged into `container-packaging` and `acp-integration`.
