// tests/scripts/browser-packaging.test.ts
//
// Packaging contract for the headless browser (`package-latest-headless-chromium`):
// the latest release is resolved and digest-verified at build time, installed
// under a PATH name `agent-browser` discovers, and the image build fails unless
// the browser can actually start. Source-level checks only — image acceptance is
// exercised by `scripts/image-smoke.sh` and CI.

import { assert, assertEquals } from "@std/assert";
import fs from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const CONTAINERFILE = fs.readFileSync(join(REPO_ROOT, "Containerfile"), "utf8");
const UNPACK = fs.readFileSync(
  join(REPO_ROOT, "scripts", "browser", "unpack-chromium.sh"),
  "utf8",
);
const VERIFY = fs.readFileSync(
  join(REPO_ROOT, "scripts", "browser", "verify-chromium.sh"),
  "utf8",
);

/** The stage body from its `FROM ... AS <name>` line to the next stage header. */
function stageBody(name: string): string {
  const body: string[] = [];
  let collecting = false;
  for (const line of CONTAINERFILE.split("\n")) {
    const header = line.match(/^FROM\s+\S+\s+AS\s+(\S+)$/i);
    if (header) {
      if (collecting) break;
      collecting = header[1].toLowerCase() === name.toLowerCase();
      continue;
    }
    if (collecting) body.push(line);
  }
  return body.join("\n");
}

test("Containerfile - no Playwright surface remains", () => {
  assertEquals(CONTAINERFILE.toLowerCase().includes("playwright"), false);
  assertEquals(CONTAINERFILE.includes("ms-playwright"), false);
});

test("Containerfile - the unpack stage only invokes the packaging script", () => {
  const stage = stageBody("chromium-unpacker");
  assert(stage.length > 0, "chromium-unpacker stage is missing");
  assert(stage.includes("COPY --link --chown=0:0 --chmod=0755 scripts/browser/ /scripts/browser/"));
  assert(stage.includes("/scripts/browser/unpack-chromium.sh"));
  assert(stage.includes('--arch "${TARGETARCH}"'));
  assert(stage.includes('--license-sha256 "${CHROMIUM_LICENSE_SHA256}"'));
  assert(stage.includes("--output /chromium"));
  // Browser freshness requires the layer cache to be invalidated per real build.
  assert(stage.includes('--build-identity "${VERSION:-EDGE}-${RELEASE:-0}"'));
});

test("unpack script - latest release, digest verified before unpacking", () => {
  assert(UNPACK.includes("https://api.github.com/repos/Sparticuz/chromium/releases/latest"));
  assert(UNPACK.includes('asset="chromium-v${version}-pack.${asset_arch}.tar"'));
  const digestCheck = UNPACK.indexOf(
    'echo "${asset_digest#sha256:}  ${workdir}/pack.tar" | sha256sum -c -',
  );
  const unpack = UNPACK.indexOf('tar -xf "$workdir/pack.tar"');
  assert(digestCheck >= 0, "the published asset digest must be checked");
  assert(unpack > digestCheck, "the digest check must precede unpacking");
  assert(UNPACK.includes("carries no sha256 digest"));
  assert(UNPACK.includes("expected exactly one release asset named"));
  assert(UNPACK.includes("unsupported architecture"));
});

test("unpack script - version and license are asserted", () => {
  assert(UNPACK.includes('[[ $reported_version == "Chromium ${major}."* ]]'));
  assert(UNPACK.includes("brotliDecompressSync"));
  assert(UNPACK.includes('echo "${license_sha256}  ${output}/LICENSE" | sha256sum -c -'));
});

test("Containerfile - browser is installed where agent-browser discovers it", () => {
  assert(
    CONTAINERFILE.includes(
      "--from=chromium-unpacker /chromium/chromium /usr/local/bin/chromium",
    ),
    "the browser must be installed as `chromium` on PATH",
  );
  assert(
    CONTAINERFILE.includes(
      "--from=chromium-unpacker /chromium/LICENSE /licenses/chromium/LICENSE",
    ),
  );
  // The check script must not be installed into the runtime image.
  assertEquals(CONTAINERFILE.includes("/usr/local/bin/verify-chromium"), false);
  assert(
    stageBody("final").includes(
      "--mount=type=bind,from=chromium-unpacker,src=/scripts/browser,target=/browser-scripts,readonly",
    ),
    "the launch check must be bind-mounted from the unpacker stage",
  );
});

test("Containerfile - explicit browser dependencies, no X11/ATK/GBM/asound layer", () => {
  for (const pkg of ["libnss3", "libnspr4", "libexpat1", "libfontconfig1", "libfreetype6"]) {
    assert(CONTAINERFILE.includes(pkg), `${pkg} must be installed explicitly`);
  }
  for (const pkg of ["libx11", "libgbm", "libasound", "libatk", "libcups"]) {
    assertEquals(
      CONTAINERFILE.toLowerCase().includes(pkg),
      false,
      `${pkg} is not a dependency of the packaged headless build`,
    );
  }
});

test("Containerfile - build fails when the browser cannot start", () => {
  const userLine = CONTAINERFILE.indexOf("USER $UID");
  const probe = CONTAINERFILE.indexOf(
    "/browser-scripts/verify-chromium.sh /usr/local/bin/chromium",
    userLine,
  );
  assert(probe > userLine, "the launch probe must run as the runtime user, after USER $UID");
  assert(VERIFY.includes("--remote-debugging-port=0"));
  assert(VERIFY.includes("DevToolsActivePort"));
  assert(VERIFY.includes("headless browser did not expose a DevTools endpoint"));
  // `--dump-dom` never completes against this build; no instruction may use it.
  for (
    const [name, text] of [["Containerfile", CONTAINERFILE], ["unpack", UNPACK], ["verify", VERIFY]]
  ) {
    for (const line of text.split("\n")) {
      if (line.trimStart().startsWith("#")) continue;
      assertEquals(line.includes("--dump-dom"), false, `${name}: unexpected --dump-dom use`);
    }
  }
});
