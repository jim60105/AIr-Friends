# Design

## Context

See `proposal.md` — Why. The current image build and runtime shape, as observed in this repository:

| Aspect | Current state |
|---|---|
| Build steps | `npx playwright install-deps chromium-headless-shell`, then (after `USER $UID`) `npx playwright install chromium-headless-shell` |
| Playwright version pin | None; `playwright` is absent from `package.json`/`bun.lock`, so `npx` resolves a fresh package per build |
| Installed browser | `~/.cache/ms-playwright/chromium_headless_shell-<revision>/chrome-headless-shell-linux64/chrome-headless-shell` |
| Runtime resolution | `detectPlaywrightBinarySync()` scans the cache and injects `AGENT_BROWSER_EXECUTABLE_PATH` at both agent-factory call sites |
| OS dependencies | Whatever `playwright install-deps` resolves for the base distribution, plus its font set |
| Recording | Playwright's bundled ffmpeg is replaced by a symlink to system `ffmpeg` |

Browser freshness is a stated requirement of this project: every rebuild is expected to pick up the newest browser, so a browser-version bump must not require a repository change. "Unpinned" is therefore not the defect — the defect is that today's unpinned path has no integrity check, no fixed dependency set, no launch verification, and an entire framework toolchain attached to it.

`agent-browser` 0.43.0 resolves its own browser in `find_chrome()` (`cli/src/native/cdp/chrome.rs`): its install cache (`~/.agent-browser/browsers/chrome-*/chrome`, or `chrome-linux64/chrome`), then macOS/Windows app paths, then on Linux `which` over `google-chrome`, `google-chrome-stable`, `chromium-browser`, `chromium`, `brave-browser`, `brave-browser-stable`. `AGENT_BROWSER_EXECUTABLE_PATH` is applied at launch (`flags.rs` → daemon options), never inside `find_chrome()`.

Measured facts used by the decisions below (performed during this proposal; at that time the newest release was `v153.0.0`. None of these digests become repository pins — they document the artifact shape and the per-architecture verification):

| Check | Result |
|---|---|
| `@sparticuz/chromium` v153.0.0 release pack, `x64` | sha256 `91b9f56d35a2cbb14279a1cbdaf1c86c0faa5fd82315bdd7334ff93bf35f224d` (70,051,840 bytes) |
| Same, `arm64` | sha256 `b6874fc0d7af15e16a15ef1b73177731f698c296c73d26aa4a90840c0777a338` (68,249,600 bytes) |
| `LICENSE` at tag `v153.0.0` | sha256 `3569040c1b042820ece7d85760a7f12b4ce8e66fa5b10f44252a923a46af5e2b` |
| `chromium.br` (identical in the pack and the npm tarball) | sha256 `38e1e1649db20fa4ea644bf5987688ce81a4c9eb10e7eae8380b74fc0d699fea`; inflates to 199.3 MB (`x64`) / 190.2 MB (`arm64`) |
| Version output | `Chromium 153.0.8010.0`; `file` confirms ELF x86-64 and aarch64 respectively |
| agent-browser's launch shape (`--headless=new --no-sandbox --remote-debugging-port=0`, `DevToolsActivePort`) | Works; CDP `Page.navigate` + `Runtime.evaluate` + `Page.captureScreenshot` verified (87,560-byte PNG) |
| `--dump-dom` against the same binary | Does not complete (hangs) — so it is unusable as an acceptance probe |
| Debian `trixie-slim` with only `libnss3 libnspr4 libexpat1 libfontconfig1 fonts-liberation ca-certificates` | Version and `DevToolsActivePort` both succeed |
| `ldd` of the pack binary | `libnspr4`, `libnss3`, `libnssutil3`, `libplc4`, `libplds4`, `libexpat1`, `libgcc_s`, libc — no X11/ATK/GBM/asound |
| `ldd` of the current Playwright shell | additionally `glib`, `gio`, `atk`, `atk-bridge`, `dbus`, `X11`, `Xcomposite`, `Xdamage`, `Xext`, `Xfixes`, `Xrandr`, `gbm`, `xcb`, `xkbcommon`, `udev`, `asound`, `atspi` |
| Package's bundled AL2023 libraries | exactly `libexpat`, `libnspr4`, `libnss*`, `libfreebl*`, `libsoftokn*` — consistent with the `ldd` set |

## Goals / Non-Goals

Goals:

- One integrity-verified browser artifact per architecture, freshly resolved on every rebuild, extracted at build time, and discoverable without daemon-side injection.
- Fail the image build if the installed browser cannot launch on the image's own dependency set.
- Delete the Playwright dependency surface from the build.

Non-goals:

- Pinning the browser version (freshness is required; integrity is verified instead).
- Pinning the floating `npm install -g agent-browser` CLI (noted as a risk, unchanged by this change).
- Achieving a materially smaller image; the extracted binary (199 MB) is comparable to the current shell (188 MB binary inside a ~254 MB cache directory).
- Any headed-mode support, WebGL/`swiftshader` tuning, or CJK font policy beyond parity.
- Changing the `agent-browser` skill docs or templates.

## Decisions

### D1 — Artifact source: the newest GitHub release pack, integrity-verified by the release's own asset digest

The npm package ships a single architecture's `bin/` (the publisher's `pack:x64`/`pack:arm64` targets each produce one, and `files` excludes per-arch directories), so it cannot serve a dual-arch build. The GitHub release publishes `chromium-v<version>-pack.x64.tar` and `.arm64.tar` side by side, and the releases API exposes a `sha256:` digest for every asset (`GET /repos/Sparticuz/chromium/releases/latest` → `.assets[].digest`). The build therefore:

1. resolves the newest non-prerelease release,
2. selects the single pack asset matching the target architecture (zero or multiple matches fail the build),
3. downloads it and verifies the bytes against that asset's published digest,
4. logs the resolved tag and full browser version.

Integrity is preserved without version pinning: the digest is read from the same API response that names the version, so a moved or tampered asset still fails the build, while a new release is picked up automatically on the next rebuild. `latest` is intentionally not hardcoded to a tag; pinning is an explicit non-goal.

Layer caching is the one thing that could defeat freshness: an unchanged `RUN` would be reused verbatim. The stage therefore echoes the existing `VERSION`/`RELEASE` build arguments first, so every real image build (CI varies `RELEASE` per run) invalidates the layer and re-resolves. A local rebuild that wants a newer browser must change `RELEASE` or bypass the cache for this stage; this is documented in the changelog.

Alternatives rejected:

- Exact-tag + repository digest pins: gives reproducibility but violates the project's freshness requirement — every browser release would need a repository change to ship.
- `npm pack @sparticuz/chromium@latest`: no per-architecture selection and it drags the package's JS API (`engines.node`) into a build that only needs the compressed binary.
- Downloading without verification for the sake of simplicity: a mutable asset URL with no check would make the browser layer unverifiable.

### D2 — Install location: `/usr/local/bin/chromium`

`find_chrome()`'s Linux branch already probes `which chromium`, and `/usr/local/bin` is already read-only inside the bwrap confinement list (`src/acp/filesystem-confinement.ts`), so the confined agent cannot replace the browser it is about to launch. This makes the CLI's own discovery authoritative, needs no environment injection, and keeps the image's `$UID:0` + `775` binary convention.

Alternatives rejected:

- `~/.agent-browser/browsers/chrome-<version>/chrome` (the CLI's install cache): works and makes `doctor` pass, but that tree is an explicitly agent-writable runtime path (`DEFAULT_CONFINEMENT_WRITABLE_RUNTIME_PATHS`), so the browser would be replaceable by the confined process for no benefit.
- Installing elsewhere and injecting `AGENT_BROWSER_EXECUTABLE_PATH` from the daemon: keeps a second resolution authority, and `doctor`'s static Chrome check (`find_chrome()`) would report a false failure because it ignores that variable.

### D3 — Explicit OS dependency set: the binary's linkage plus font parity

`libnss3`, `libnspr4`, `libexpat1`, `libfontconfig1`, `libfreetype6`, `ca-certificates` cover the pack binary (verified in `debian:trixie-slim`). The font packages that `playwright install-deps` used to supply are carried over explicitly (`fonts-liberation`, `fonts-unifont`, `fonts-noto-color-emoji`, `fonts-wqy-zenhei`, `fonts-ipafont-gothic`, `fonts-tlwg-loma-otf`, `fonts-freefont-ttf`) so screenshot text rendering — including the CJK coverage used today — does not regress. X11/ATK/GBM/asound packages are dropped because the pack binary does not link them.

### D4 — Build-time acceptance: version/release consistency plus a real CDP startup probe

Two `RUN` assertions in the unpack/install path: the version query's reported major must equal the resolved release's major (the release tag's leading component, e.g. `153` for `v153.0.0`), with the full version logged; and a bounded loop must launch the installed binary with `--headless=new --no-sandbox --disable-dev-shm-usage --remote-debugging-port=0 --user-data-dir=<temp>` and observe `DevToolsActivePort` before tearing it down. The major check is the strongest equality that stays satisfiable while the version floats — it still catches a corrupted decompression or a mismatched asset/architecture. `--dump-dom` is excluded: it hangs against this build even though CDP works, so it would be a false-failure probe. The probe runs against the final image's package set, which is what makes the dependency list verifiable at build time rather than after deployment.

### D5 — Do not adopt `agent-browser doctor --offline --quick` as a gate

Read from the CLI source (`cli/src/doctor/`):

- `--quick` skips `launch::check()` — the only check that actually starts a browser. What remains is `find_chrome()` existence, ffmpeg, daemon stale-file cleanup, config parsing, security key/state files, and provider key presence (provider checks are `Info` unless a provider is selected). So `--quick` would validate presence only, not the failure mode this change introduces (missing OS libraries).
- The Chrome check consults `find_chrome()`, which ignores `AGENT_BROWSER_EXECUTABLE_PATH`; it would have failed for the current env-injection setup. With D2 it passes — but for the same "found on PATH" reason `--quick` adds little.
- Doctor also mutates `~/.agent-browser` (stale sidecar cleanup) and returns exit 1 on any `fail`, which makes it a user-facing diagnostic, not a bootstrap or build contract.

Conclusion: no doctor invocation is added to the build or startup. The build probe in D4 is the gate; `agent-browser doctor --offline` (without `--quick`) remains the recommended operator diagnostic because it does run the real launch.

### D6 — Remove `detectPlaywrightBinarySync()` and its call sites

With D2 the image needs no injection, and the function's only remaining purpose is the Playwright cache — the dependency this change removes. Deleting it also removes the implicit "newest Playwright revision wins" selection that silently changed the browser between builds. `AGENT_BROWSER_EXECUTABLE_PATH` stays as the operator override (still passed at both spawn shapes) and stays in `SandboxManager`'s allowlist, so deployments that mount their own browser keep working. Developer machines that only have a Playwright cache can set the override or run `agent-browser install`; this is documented in the changelog.

### D7 — Drop the Playwright ffmpeg symlink step

It only existed to replace `~/.cache/ms-playwright/ffmpeg-*/ffmpeg-linux`, which no longer exists. `agent-browser record` resolves `ffmpeg` from PATH, and the image already installs system `ffmpeg`. The `Recording` doctor category continues to pass.

### D8 — License packaging

The pack tarballs contain no license text (`LICENSE`, `package.json`, `build/`, `bin/` only in the npm form; the release packs contain only the four `.br` assets). The MIT `LICENSE` is fetched from the same `v153.0.0` tag, verified against its own digest, and installed at `/licenses/chromium/LICENSE` in the existing third-party license location; the project `LICENSE` is untouched.

## Risks / Trade-offs

- [Lambda-oriented build behaves differently from Chrome for Testing] → `--dump-dom` hangs against this binary while CDP works. The D4 probe exercises the CDP path the CLI actually uses; the skill surface never calls `--dump-dom`. Recorded in the changelog/docs so operators do not read the hang as a regression.
- [`arm64` binary untested at proposal time] → The release pack and `file` output are arch-correct, but the launch was executed only on x64. The build probe runs per architecture, so an arm64-specific launch failure fails the arm64 build rather than shipping.
- [Image size not actually reduced] → Download drops (~70 MB per arch instead of a Playwright browser download and unpinned package), but the installed binary is ~199 MB. Mitigation: state the goal honestly (integrity, dependency surface, launch verification) and do not claim a size win in docs.
- [Font coverage regression] → D3 carries the Playwright font set explicitly. Verified by inspecting the installed package list, not by eyeballing a screenshot.
- [Floating browser meets a floating CLI] → Both `@sparticuz/chromium` and `npm install -g agent-browser` track latest, so a browser change and a CLI change can land in the same rebuild with no repository diff. Mitigation: the CDP startup probe fails the build on a launch-shape incompatibility, and the resolved versions are logged for post-hoc diagnosis. If a regression slips past startup, the fallback is an explicit `AGENT_BROWSER_EXECUTABLE_PATH` override or a temporary CLI pin.
- ["Latest packager release" is not "latest Chrome"] → At verification time the newest `@sparticuz/chromium` release was `v153.0.0`, while the installed `agent-browser` warned that Chrome stable was `157.0.8103.78` (published later). The pipeline is as fresh as this packager, not as fresh as Chrome. Mitigation: the build log records the resolved release, and the CLI's own version warning surfaces the gap at runtime; switching source would be a separate decision if the lag becomes unacceptable.
- [Builds are not bit-reproducible and cannot be bisected by version] → Accepted trade-off of the freshness requirement. Mitigation: the resolved release and browser version are printed in the build log, so an image can still be traced to the artifacts it contains.
- [Build now needs `api.github.com`] → Unauthenticated API rate limits could fail a build. Mitigation: the resolution step fails loudly with the API's message; a `GITHUB_TOKEN` can be supplied to the build if the limit is hit; the release-asset host itself is already required for the OMP/OpenCode downloads.
- [Digest verification only proves transport integrity] → The published digest is computed by the platform for the uploaded asset, not a signature by the vendor. This is the same trust level as the current download path, and the build log records what was accepted.
- [The pack's `al2023.tar.br` is irrelevant on Debian] → Deliberately not installed; Debian supplies `libnss3`/`libnspr4`/`libexpat1`. `LD_LIBRARY_PATH` manipulation is not used.
- [No tests currently assert the Containerfile's browser steps] → Add a focused test that parses `Containerfile` and asserts: no `playwright` step remains, the pack is resolved from the latest release and digest-verified before unpacking, and the binary is installed at `/usr/local/bin/chromium`.

## Migration Plan

Single-image change: rebuild, then verify inside the image as the runtime user that `agent-browser open about:blank` (or a small CDP probe) succeeds and that `which chromium` resolves. Rollback is a revert of the Containerfile/code commit; no persisted data, config, or API changes are involved.

## Open Questions

None.
