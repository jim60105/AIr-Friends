#!/bin/sh
# scripts/omp/generate-omp-manifest.sh — PACKAGE-MANIFEST.sha256 generator
# (OpenSpec `package-pinned-omp-runtime`; design D5).
#
# Records a SHA-256 digest over EVERY installed owned file under <owned-root>
# (/opt/air/omp in the image): the extension bundle, the settings overlays, and
# the prompt artifact. The covered set is DERIVED from the tree itself
# (`find`, manifest self-excluded), so the install list and the manifest can
# never drift apart — that is the machine-enforced half of the recut invariant:
# the image build regenerates this file over final content on every build, and
# ANY successor change that lands content touching /opt/air/omp inputs must
# recut it in the same change (a stale manifest after a content change is a
# task-failure condition; see docs/OMP_PACKAGING.md).
#
# Usage: generate-omp-manifest.sh <owned-root> <omp-version>
# Writes <owned-root>/PACKAGE-MANIFEST.sha256; the caller owns the final
# chown/chmod (the image build sets 0:0 / 0644 root-owned, non-writable by the
# runtime user).

set -eu

ROOT="${1:?usage: generate-omp-manifest.sh <owned-root> <omp-version>}"
OMP_VERSION="${2:?usage: generate-omp-manifest.sh <owned-root> <omp-version>}"
MANIFEST="${ROOT}/PACKAGE-MANIFEST.sha256"

{
  echo "# PACKAGE-MANIFEST.sha256 — generated at image build time by"
  echo "# scripts/omp/generate-omp-manifest.sh (package-pinned-omp-runtime)."
  echo "#"
  echo "# OMP_VERSION=${OMP_VERSION}"
  echo "# Trusted-extension serial composition: 12 -> 13 -> 14b -> 17 -> 18"
  echo "#   (tree -> discovery -> enforcement -> fetch-transport -> web-search siblings);"
  echo "#   no reserved-but-unconsumed slot remains, so this digest set covers"
  echo "#   exactly that composition."
  echo "#"
  echo "# Format: one 'sha256  <path>' line per installed owned file, paths relative"
  echo "# to this root, sorted. The manifest itself is the only excluded file."
  echo "#"
  echo "# RECUT INVARIANT: digests are cut only over FINAL content. If any change"
  echo "# modifies anything installed under this root, regenerate this manifest in"
  echo "# the same change; a stale manifest after a content change is a"
  echo "# task-failure condition (docs/OMP_PACKAGING.md)."
  (
    cd "${ROOT}"
    find . -type f ! -name PACKAGE-MANIFEST.sha256 -print | sed 's|^\./||' | LC_ALL=C sort |
      while IFS= read -r f; do
        sha256sum "${f}"
      done
  )
} > "${MANIFEST}"

digests=$(sed -n '/^[0-9a-f]\{64\}  /p' "${MANIFEST}" | wc -l)
echo "wrote ${MANIFEST} (${digests} file digests)"
