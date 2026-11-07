#!/usr/bin/env bash
set -euo pipefail
suite="${1:?usage: run-suite.sh <suite> [--final]}"
mode="${2:-}"
repo_root="$(git rev-parse --show-toplevel)"
poc_dir="${repo_root}/migration/bun/poc"
arch="$(uname -m)"
out_root=".evidence-wip"
if [[ "${mode}" == "--final" ]]; then out_root="evidence"; fi
out_dir="${poc_dir}/${out_root}/${arch}"
mkdir -p "${out_dir}"
image="air-friends-bun-poc:local"
extra=()
case "${suite}" in
  ffi-enosys) extra+=(--security-opt "seccomp=${poc_dir}/fixtures/deny-openat2.json") ;;
  injection-noconfig) extra+=(--tmpfs "/opt/air:rw,mode=0755") ;;
  harness|process|acp|acp-failure|ffi|egress|injection) ;;
  *) echo "unknown suite: ${suite}" >&2; exit 2 ;;
esac
podman build --quiet -f "${poc_dir}/Containerfile" -t "${image}" "${repo_root}" >/dev/null
podman run --rm --network=none --cap-drop=ALL --security-opt=no-new-privileges \
  --userns=keep-id:uid=1000,gid=1000 --user 1000:0 \
  --env "POC_GIT_HEAD=$(git rev-parse HEAD)" \
  --env "POC_IMAGE_ID=$(podman image inspect --format '{{.Id}}' "${image}")" \
  --env "POC_SPAWN_BACKEND=${POC_SPAWN_BACKEND:-node}" \
  -v "${out_dir}:/evidence:Z" "${extra[@]}" "${image}" \
  bun run --no-env-file /repo/migration/bun/poc/gate/run-in-container.ts "${suite}"
