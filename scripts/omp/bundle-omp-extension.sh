#!/bin/sh
# scripts/omp/bundle-omp-extension.sh — wrapper for the trusted-extension
# bundler (OpenSpec `package-pinned-omp-runtime` D5; native-loadable bundle
# retarget by `package-bun-compatible-omp-extension`; Bun bundling by
# `bundle-omp-extension-with-bun`). The bundler logic lives in
# bundle-extension.ts beside this script; this wrapper invokes it and
# normalizes the output modes.
#
# Usage:
#   bundle-omp-extension.sh <src-root> <extension-target>
#
# The single generated artifact is <extension-target>/index.js. In the image
# build: src-root=/build-src, extension-target=/opt/air/omp/extension, run as
# ROOT before `USER $UID`. Development launch builds the SAME artifact
# contract at build/omp-extension/index.js (bun run bundle:omp-extension
# routes here; src-root/target are the repo checkout and its build dir).

set -eu

SRC="${1:?usage: bundle-omp-extension.sh <src-root> <extension-target>}"
TARGET="${2:?usage: bundle-omp-extension.sh <src-root> <extension-target>}"

if ! command -v bun >/dev/null 2>&1; then
  echo "bundle-omp-extension.sh requires bun" >&2
  exit 1
fi

here="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

bun run --no-env-file "${here}/bundle-extension.ts" "${SRC}" "${TARGET}"

# Deterministic output modes (dirs 0755, files 0644) when run as root, so the
# generated tree never depends on the invoking umask. The IMAGE does not keep
# these modes: the Containerfile's post-COPY directory step re-owns and
# re-modes the installed tree to the deployment's ordinary $UID:0 + 775
# convention, which supersedes any ownership policy this script might imply.
# (Non-root replay — the packaging unit test runs this script to prove the
# bundle — skips chown.)
if [ "$(id -u)" = "0" ]; then
  chown -R 0:0 "${TARGET}"
fi
find "${TARGET}" -type d -exec chmod 0755 {} +
find "${TARGET}" -type f -exec chmod 0644 {} +

echo "trusted-extension native-loadable bundle generated under ${TARGET}"
