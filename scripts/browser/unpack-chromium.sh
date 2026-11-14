#!/usr/bin/env bash
# Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under GPL-3.0-or-later
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.
# ==================================================================
#
# Unpack the newest `@sparticuz/chromium` release into a single headless
# browser executable plus its license, for the container image build.
#
# Usage:
#   unpack-chromium.sh --arch <amd64|arm64> --output <dir> \
#     --license-sha256 <hex> --build-identity <text>
#
# Browser freshness is intentional: the release is resolved at run time and no
# browser version is pinned. Integrity is still enforced — the pack is checked
# against the digest the release publishes for it, and the packaged license is
# checked against `--license-sha256` before either is installed.
#
# `--build-identity` is only echoed. It exists so an unchanged Dockerfile RUN
# re-executes (and re-resolves the release) whenever the image build identity
# changes, instead of silently reusing an older browser layer.

set -Eeuo pipefail

readonly API_URL="https://api.github.com/repos/Sparticuz/chromium/releases/latest"
readonly RAW_URL="https://raw.githubusercontent.com/Sparticuz/chromium"
readonly CURL_ARGS=(
  --retry 10 --retry-delay 5 --retry-all-errors
  --retry-max-time 900 --connect-timeout 30 --max-time 900
)

RED=$'\033[0;31m'
RESET=$'\033[0m'

die() {
  echo "${RED}ERROR: $*${RESET}" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: unpack-chromium.sh --arch <amd64|arm64> --output <dir> \
         --license-sha256 <hex> --build-identity <text>
EOF
}

arch=""
output=""
license_sha256=""
build_identity=""

while [[ $# -gt 0 ]]; do
  case "$1" in
  --arch) arch="${2:-}" && shift 2 ;;
  --output) output="${2:-}" && shift 2 ;;
  --license-sha256) license_sha256="${2:-}" && shift 2 ;;
  --build-identity) build_identity="${2:-}" && shift 2 ;;
  -h | --help) usage && exit 0 ;;
  *) die "unknown argument: $1" ;;
  esac
done

[[ -n $arch ]] || die "--arch is required"
[[ -n $output ]] || die "--output is required"
[[ -n $license_sha256 ]] || die "--license-sha256 is required"

for tool in curl jq tar sha256sum bun; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is required but not installed"
done

case "$arch" in
amd64) asset_arch="x64" ;;
arm64) asset_arch="arm64" ;;
*) die "unsupported architecture: $arch" ;;
esac

workdir="$(mktemp -d)"
trap 'rm -rf -- "$workdir"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Resolving the latest Chromium release (build ${build_identity:-unknown})"
curl "${CURL_ARGS[@]}" -fsSL -H "Accept: application/vnd.github+json" \
  "$API_URL" -o "$workdir/release.json"

tag="$(jq -r '.tag_name // empty' "$workdir/release.json")"
[[ -n $tag ]] || die "the release response carries no tag_name"
version="${tag#v}"
major="${version%%.*}"
asset="chromium-v${version}-pack.${asset_arch}.tar"

asset_count="$(jq -r --arg name "$asset" \
  '[.assets[] | select(.name == $name)] | length' "$workdir/release.json")"
[[ $asset_count == 1 ]] ||
  die "expected exactly one release asset named ${asset}, found ${asset_count}"

asset_digest="$(jq -r --arg name "$asset" \
  '.assets[] | select(.name == $name) | .digest // empty' "$workdir/release.json")"
asset_url="$(jq -r --arg name "$asset" \
  '.assets[] | select(.name == $name) | .browser_download_url' "$workdir/release.json")"
[[ $asset_digest == sha256:* ]] || die "asset ${asset} carries no sha256 digest"
[[ -n $asset_url ]] || die "asset ${asset} carries no download URL"

echo "Downloading ${tag} asset ${asset}"
curl "${CURL_ARGS[@]}" -fsSL "$asset_url" -o "$workdir/pack.tar"
echo "${asset_digest#sha256:}  ${workdir}/pack.tar" | sha256sum -c -

mkdir -p "$workdir/pack" "$output"
tar -xf "$workdir/pack.tar" -C "$workdir/pack"
[[ -f "$workdir/pack/chromium.br" ]] || die "the pack does not contain chromium.br"

CHROMIUM_BR="$workdir/pack/chromium.br" CHROMIUM_OUT="$output/chromium" bun -e '
const fs = require("node:fs");
const z = require("node:zlib");
fs.writeFileSync(process.env.CHROMIUM_OUT, z.brotliDecompressSync(fs.readFileSync(process.env.CHROMIUM_BR)), {
  mode: 0o755,
});
'
chmod 0755 "$output/chromium"

reported_version="$("$output/chromium" --version)"
echo "Headless browser ${tag}: ${reported_version}"
[[ $reported_version == "Chromium ${major}."* ]] ||
  die "browser reports '${reported_version}', which does not match release ${tag}"

curl "${CURL_ARGS[@]}" -fsSL "${RAW_URL}/${tag}/LICENSE" -o "$output/LICENSE"
echo "${license_sha256}  ${output}/LICENSE" | sha256sum -c -
