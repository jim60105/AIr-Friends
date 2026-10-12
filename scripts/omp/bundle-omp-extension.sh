#!/bin/sh
# scripts/omp/bundle-omp-extension.sh — wrapper for the trusted-extension
# bundler (OpenSpec `package-pinned-omp-runtime` D5; native-loadable bundle
# retarget by `package-bun-compatible-omp-extension`). The bundler logic
# lives in bundle-extension.ts beside this script; this wrapper invokes it
# with the exact permission set it needs and hardens ownership afterwards.
#
# Usage:
#   bundle-omp-extension.sh <src-root> <extension-target> <repo-deno-lock>
#
# The single generated artifact is <extension-target>/index.js. In the image
# build: src-root=/build-src, extension-target=/opt/air/omp/extension, run as
# ROOT before `USER $UID`; ownership hardening below makes the tree root-owned
# with runtime-user read-only modes (dirs 0755, files 0644). Development
# launch builds the SAME artifact contract at build/omp-extension/index.js
# (deno task bundle:omp-extension routes here; src-root/target are the repo
# checkout and its build dir).

set -eu

SRC="${1:?usage: bundle-omp-extension.sh <src-root> <extension-target> <repo-deno-lock>}"
TARGET="${2:?usage: bundle-omp-extension.sh <src-root> <extension-target> <repo-deno-lock>}"
DENO_LOCK="${3:?usage: bundle-omp-extension.sh <src-root> <extension-target> <repo-deno-lock>}"

if ! command -v deno >/dev/null 2>&1; then
  echo "bundle-omp-extension.sh requires deno (present in the image build base)" >&2
  exit 1
fi

here="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

install -d -m 755 "${TARGET}"

deno run --allow-read --allow-write --allow-run "${here}/bundle-extension.ts" "${SRC}" "${TARGET}" "${DENO_LOCK}"

# Ownership hardening: root-owned, the runtime agent user read-only.
# (Non-root replay — the packaging unit test runs this script to prove the
# bundle — skips chown; in the image the RUN executes as root before
# `USER $UID`, which is where the ownership contract is enforced.)
if [ "$(id -u)" = "0" ]; then
  chown -R 0:0 "${TARGET}"
fi
find "${TARGET}" -type d -exec chmod 0755 {} +
find "${TARGET}" -type f -exec chmod 0644 {} +

echo "trusted-extension native-loadable bundle generated under ${TARGET}"
