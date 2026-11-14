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
# Verify that a headless browser can actually start and serve the DevTools
# protocol on the current OS dependency set — the path `agent-browser` drives.
#
# Usage:
#   verify-chromium.sh [binary]
#
# `--dump-dom` is deliberately not used: it does not complete against the
# serverless build this image ships, even though CDP works.

set -Eeuo pipefail

binary="${1:-/usr/local/bin/chromium}"

RED=$'\033[0;31m'
RESET=$'\033[0m'

die() {
  echo "${RED}ERROR: $*${RESET}" >&2
  exit 1
}

[[ -x $binary ]] || die "browser executable not found or not executable: $binary"

profile="$(mktemp -d)"
browser_pid=""

cleanup() {
  if [[ -n $browser_pid ]]; then
    kill "$browser_pid" 2>/dev/null || true
    wait "$browser_pid" 2>/dev/null || true
  fi
  rm -rf -- "$profile"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

"$binary" --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --user-data-dir="$profile" --remote-debugging-port=0 about:blank \
  >/dev/null 2>&1 &
browser_pid=$!

for _ in $(seq 1 40); do
  [[ -s "$profile/DevToolsActivePort" ]] && break
  sleep 0.5
done

[[ -s "$profile/DevToolsActivePort" ]] ||
  die "headless browser did not expose a DevTools endpoint"

echo "Headless browser verified: $("$binary" --version)"
