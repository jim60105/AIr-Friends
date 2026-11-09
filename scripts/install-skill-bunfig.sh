#!/bin/sh
# Create the trusted, root-owned, read-only Bun config file used by the skill
# shebang (`--config=/opt/air/skill-bunfig.toml`). Idempotent: rerunning it
# leaves the same empty 0444 root-owned file in place.
#
# This host is unprivileged by design: when the script is not already root it
# refuses with the rootless-container instructions instead of elevating.
set -eu

CONFIG_DIR=/opt/air
CONFIG_FILE="$CONFIG_DIR/skill-bunfig.toml"

if [ "$(id -u)" -ne 0 ]; then
  echo "install-skill-bunfig: must run as root (this host is unprivileged by design)." >&2
  echo "Run it inside a rootless container, e.g.:" >&2
  echo "  podman run --rm -v \"\$PWD:/src:Z\" -w /src docker.io/oven/bun:1.4.2-debian sh scripts/install-skill-bunfig.sh" >&2
  exit 1
fi

install -d -m 0755 -o root -g root "$CONFIG_DIR"
install -m 0444 -o root -g root /dev/null "$CONFIG_FILE"
stat -c '%U:%G %a %s' "$CONFIG_FILE"
