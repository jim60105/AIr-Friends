#!/bin/sh
# scripts/image-smoke.sh — smoke the packaged Bun image under the deployment's
# container permissions (OpenSpec `package-bun-container-image`, design D4).
#
# Usage:
#   sh scripts/image-smoke.sh [--only <check>] <final-image> <test-image>
#
# Checks (each prints `ok <name>`; the first failure exits non-zero):
#   help            the daemon prints its help and exits 0
#   tools           bun, opencode, omp, node, agent-browser, dumb-init, rg, git,
#                   bwrap and unshare run at their pinned versions
#   browser         /usr/local/bin/chromium reports its version and starts a
#                   headless session exposing a DevTools endpoint
#   skill-config    /opt/air/skill-bunfig.toml is root:root 0444 size 0 inside a
#                   root-owned 0755 /opt/air, and cannot be removed/replaced
#   skill-run       a built-in skill starts through its shebang, its trusted
#                   config loads, and it fails on its own unreachable-API error
#   in-image-tests  the image test subset passes: the native tokenizer, the real
#                   FFI backend, sandbox-capability detection and the real OMP
#                   native runtime (P0-9/P0-7), with acceptance mode ON so an
#                   unavailable prerequisite fails instead of skipping
#   seccomp-enosys  the real FFI backend fails closed on a seccomp-denied openat2
#                   (P0-4): reason `secure_access_unavailable` for ENOSYS
#
# Every `podman run` uses `--rm --user 1000:0 --cap-drop ALL
# --security-opt no-new-privileges`, the same restricted posture compose.yml
# (OpenShift `restricted-v2`) grants. The tests directory is mounted read-only
# because `.containerignore` excludes it from the image.
set -eu

usage() {
  echo "usage: sh scripts/image-smoke.sh [--only <check>] <final-image> <test-image>" >&2
  exit 2
}

fail() {
  echo "not ok $1: $2" >&2
  exit 1
}

podman_run() {
  podman run --rm --user 1000:0 --cap-drop ALL --security-opt no-new-privileges "$@"
}

only=""
if [ "${1:-}" = "--only" ]; then
  [ $# -ge 2 ] || usage
  only="$2"
  shift 2
fi
[ $# -eq 2 ] || usage
final_image="$1"
test_image="$2"
repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

check_help() {
  podman_run "$final_image" \
    bun run --no-env-file --config=/app/bunfig.toml src/main.ts --help >/dev/null ||
    fail help "the daemon --help command exited non-zero"
  echo "ok help"
}

check_tools() {
  podman_run "$final_image" sh -c '
    set -eu
    test "$(bun --version)" = "1.4.4"
    case "$(bun --revision)" in
      1.4.4+38afee6c8*) ;;
      *) echo "bun --revision: $(bun --revision)" >&2; exit 1 ;;
    esac
    test "$(opencode --version)" = "1.18.21"
    case "$(omp --version)" in
      *18.6.1*) ;;
      *) echo "omp --version: $(omp --version)" >&2; exit 1 ;;
    esac
    case "$(node --version)" in
      v24.*) ;;
      *) echo "node --version: $(node --version)" >&2; exit 1 ;;
    esac
    agent-browser --version >/dev/null
    dumb-init --version >/dev/null
    rg --version >/dev/null
    git --version >/dev/null
    bwrap --version >/dev/null
    unshare --version >/dev/null
  ' || fail tools "a pinned tool is missing or reports the wrong version"
  echo "ok tools"
}

check_browser() {
  podman_run -v "$repo_root/scripts/browser:/browser-scripts:ro,Z" \
    "$final_image" sh -c '
    set -eu
    test -x /usr/local/bin/chromium
    test -s /licenses/chromium/LICENSE
    /browser-scripts/verify-chromium.sh /usr/local/bin/chromium
  ' || fail browser "the packaged headless browser is missing or cannot start"
  echo "ok browser"
}

check_skill_config() {
  podman_run "$final_image" sh -c '
    set -eu
    test "$(stat -c "%U:%G %a %s" /opt/air/skill-bunfig.toml)" = "root:root 444 0"
    test "$(stat -c "%U:%G %a" /opt/air)" = "root:root 755"
    # Each attempt MUST fail for the runtime user. Written as explicit guards
    # because `! cmd` under `set -e` is not a portable failure (bash exempts it
    # from errexit), which would let a successful mutation pass the check.
    if rm -f /opt/air/skill-bunfig.toml; then
      echo "removing the trusted config unexpectedly succeeded" >&2
      exit 1
    fi
    if mv /opt/air/skill-bunfig.toml /opt/air/skill-bunfig.toml.bak; then
      echo "renaming the trusted config unexpectedly succeeded" >&2
      exit 1
    fi
    if sh -c ": > /opt/air/skill-bunfig.toml"; then
      echo "overwriting the trusted config unexpectedly succeeded" >&2
      exit 1
    fi
    # The file MUST survive every attempt unchanged.
    test "$(stat -c "%U:%G %a %s" /opt/air/skill-bunfig.toml)" = "root:root 444 0"
  ' || fail skill-config "the trusted skill config is not immutable for UID 1000"
  echo "ok skill-config"
}

check_skill_run() {
  # No Skill API daemon and no session JWT here, so the skill MUST exit with its
  # own JSON error. A missing/unloadable trusted config would instead print the
  # config path, which is what this check distinguishes.
  status=0
  out="$(podman_run "$final_image" \
    /home/air/.agents/skills/memory-stats/scripts/memory-stats.ts --session-id x 2>&1)" ||
    status=$?
  [ "$status" -ne 0 ] || fail skill-run "the skill exited 0 without a Skill API: $out"
  case "$out" in
    *skill-bunfig.toml*) fail skill-run "the trusted config failed to load: $out" ;;
  esac
  case "$out" in
    *'"success":false'*) ;;
    *) fail skill-run "unexpected skill output: $out" ;;
  esac
  echo "ok skill-run"
}

check_in_image_tests() {
  podman_run -w /app \
    -v "$repo_root/tests:/app/tests:ro,Z" \
    -v "$repo_root/scripts/omp:/app/scripts/omp:ro,Z" \
    -v "$repo_root/skills:/app/skills:ro,Z" \
    -e OMP_NATIVE_ACCEPTANCE=1 \
    "$test_image" \
    bun test --timeout=120000 \
    tests/core/memory-recall/tokenizer.test.ts \
    tests/acp/filesystem-access-linux.test.ts \
    tests/acp/sandbox-capabilities.test.ts \
    tests/integration/omp-native-runtime ||
    fail in-image-tests "the in-image test subset failed"
  echo "ok in-image-tests"
}

check_seccomp_enosys() {
  # The seccomp profile turns `openat2` into ENOSYS. The expected outcome is
  # produced by the REAL backend (no injected native calls), so the check also
  # asserts the backend initialized and the failure came from the syscall.
  script='
    import { lstatSync, realpathSync } from "node:fs";
    import { join } from "node:path";
    import {
      getRealLinuxNativeCalls,
      performLinuxSecureAccess,
    } from "/app/src/acp/filesystem-access-linux.ts";

    const backend = getRealLinuxNativeCalls();
    if (!backend.calls) {
      console.error("native backend unavailable: " + JSON.stringify(backend.error));
      process.exit(1);
    }

    const identity = (path) => {
      const stats = lstatSync(path);
      return { dev: stats.dev, ino: stats.ino };
    };
    const root = "/app";
    const relativePath = "package.json";
    const canonicalPath = realpathSync(root);
    const result = performLinuxSecureAccess({
      operation: "read",
      selectedRoot: {
        role: "workspace",
        configuredPath: root,
        canonicalPath,
        identity: identity(canonicalPath),
        readOnly: false,
      },
      target: {
        acpSessionId: "",
        sessionContextGeneration: "",
        roles: ["workspace"],
        rootIdentities: [],
        normalizedInput: relativePath,
        canonicalTarget: join(canonicalPath, relativePath),
        rootRelativePath: relativePath,
        targetType: "file",
        targetIdentity: identity(join(canonicalPath, relativePath)),
        observedSymlinks: [],
      },
      relativePath,
      isNewFile: false,
      content: "",
    });
    if (result.ok) {
      console.error("the seccomp profile did not deny openat2");
      process.exit(1);
    }
    console.log(result.reason);
    console.log(result.message);
  '
  status=0
  out="$(podman_run -w /app \
    --security-opt "seccomp=$repo_root/tests/fixtures/seccomp/deny-openat2.json" \
    "$test_image" bun -e "$script" 2>&1)" || status=$?
  [ "$status" -eq 0 ] || fail seccomp-enosys "the guarded read did not fail closed: $out"
  case "$out" in
    *secure_access_unavailable*) ;;
    *) fail seccomp-enosys "unexpected failure reason: $out" ;;
  esac
  case "$out" in
    *ENOSYS*) ;;
    *) fail seccomp-enosys "the failure is not the seccomp ENOSYS path: $out" ;;
  esac
  echo "ok seccomp-enosys"
}

dispatch() {
  case "$1" in
    help) check_help ;;
    tools) check_tools ;;
    browser) check_browser ;;
    skill-config) check_skill_config ;;
    skill-run) check_skill_run ;;
    in-image-tests) check_in_image_tests ;;
    seccomp-enosys) check_seccomp_enosys ;;
    *) usage ;;
  esac
}

if [ -n "$only" ]; then
  case " help tools browser skill-config skill-run in-image-tests seccomp-enosys " in
    *" $only "*) dispatch "$only" ;;
    *) echo "unknown check: $only" >&2; usage ;;
  esac
else
  for check in help tools browser skill-config skill-run in-image-tests seccomp-enosys; do
    dispatch "$check"
  done
fi
