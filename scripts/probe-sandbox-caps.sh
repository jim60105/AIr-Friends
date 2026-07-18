#!/bin/sh
# scripts/probe-sandbox-caps.sh
#
# Functional probe for the agent-sandbox capabilities F12 (filesystem confinement) and F14
# (network-namespace isolation) depend on. Run it INSIDE the container to see whether the
# runtime grants the namespace privileges the agent needs, mirroring the checks the daemon
# performs at spawn time (src/acp/sandbox-capabilities.ts).
#
# Usage (mirror the OpenShift restricted-v2 posture that compose.yml uses by default):
#   podman run --rm --user 1000:0 --cap-drop=ALL --security-opt no-new-privileges \
#     air-friends:dev scripts/probe-sandbox-caps.sh
#
# A hardened node that disables unprivileged user namespaces (sysctl
# user.max_user_namespaces=0) will FAIL every probe below; the daemon then fails closed
# rather than spawning the agent unconfined / with open egress.

set -u
ok()   { echo "  OK    $1"; }
fail() { echo "  FAIL  $1"; }

echo "kernel: $(uname -r)"
echo

echo "[F14] network-namespace isolation (userns-first)"
if unshare --user --map-root --net true 2>/dev/null; then
  ok "unshare --user --map-root --net"
else
  fail "unshare --user --map-root --net"
fi

echo "[F14] bare unshare --net (expected to FAIL in a non-root container)"
if unshare --net true 2>/dev/null; then
  ok "unshare --net (unexpectedly permitted)"
else
  fail "unshare --net (expected — needs CAP_SYS_ADMIN in current userns)"
fi

echo "[F12] filesystem confinement (bubblewrap)"
if command -v bwrap >/dev/null 2>&1; then
  if bwrap --unshare-user --unshare-pid --proc /proc --dev /dev --ro-bind / / true 2>/dev/null; then
    ok "bwrap mount-namespace confinement"
  else
    fail "bwrap mount-namespace confinement"
  fi
else
  fail "bwrap not installed"
fi

echo
echo "Interpretation:"
echo "  - Both [F14] userns-first AND [F12] bwrap OK  -> confinement + isolation available."
echo "  - Both FAIL                                    -> unprivileged user namespaces are"
echo "    disabled on this node; the daemon will fail closed. Enable them, or set"
echo "    agent.sandbox.filesystemConfinement:false / agent.sandbox.unrestrictedEgress:true"
echo "    to accept the risk explicitly."
