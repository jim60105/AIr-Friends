#!/bin/sh
# migration/bun/cutover/drill.sh — pre-cutover container drill (design D2).
#
# Usage:
#   sh migration/bun/cutover/drill.sh <image> <data-copy-dir> <label> [runs]
#   sh migration/bun/cutover/drill.sh --rollback <rollback-image> <scratch-data-dir>
#
# Normal mode copies the state directory to a fresh scratch directory (the
# source is never mounted or modified), then for each run:
#   - starts the image with compose.yml's restricted posture
#     (--user 1000:0 --cap-drop ALL --security-opt no-new-privileges),
#   - measures startup seconds to the first 200 from /ready,
#   - after 60 s idle measures memory, file descriptors and processes,
#   - stops with a 15 s timeout, measures the stop and counts host processes
#     left after it (PID start times guard against PID reuse),
#   - starts it again and measures restart readiness,
#   - fails the run unless the logs show zero platform adapters and no adapter
#     registration or connection attempt.
# Results are written atomically to measurements/<label>.json.
#
# The run mounts ONLY config.drill.yaml (every real platform disabled) at
# /app/config.yaml, and ONLY the scratch copy at /app/data. It passes no
# credentials. `-e ENV=production`, `-e AGENT_DEFAULT_TYPE=opencode` and the
# three explicit `*_ENABLED=false` overrides keep the environment from
# overriding the drill config.
#
# Rollback mode starts the rollback image once on the scratch data directory a
# Bun run used, after verifying the daemon-written skill-secret still matches
# the attestation recorded by the Bun drill, and requires readiness.
#
# Requires a non-root, rootless-podman host: podman, curl, jq, ps, sha256sum,
# realpath, and GNU date (+%s%3N). Runs as POSIX sh (the task invokes `sh`).
set -eu

CUTOVER_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
CONFIG="$CUTOVER_DIR/config.drill.yaml"
MEASUREMENTS="$CUTOVER_DIR/measurements"
HOST_PORT=18080
READY_URL="http://127.0.0.1:$HOST_PORT/ready"
STARTUP_TIMEOUT_SEC=120
IDLE_SEC=60
STOP_TIMEOUT_SEC=15
PLATFORM_MARKER_TIMEOUT_SEC=30

container=""
work=""
keep_scratch=0

usage() {
  printf '%s\n' \
    "usage: sh $0 <image> <data-copy-dir> <label> [runs]" \
    "       sh $0 --rollback <rollback-image> <scratch-data-dir>" >&2
  exit 2
}

die() {
  printf 'drill: %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

now_ms() {
  date +%s%3N
}

seconds_between() {
  awk -v start="$1" -v end="$2" 'BEGIN { printf "%.3f", (end - start) / 1000 }'
}

# Field 22 (start time) of /proc/<pid>/stat. The comm field is parenthesized
# and may contain spaces, so drop everything through its closing ") " first.
proc_starttime() {
  awk '{ sub(/^[^)]*\) /, ""); split($0, fields, " "); if (fields[20] == "") exit 1; print fields[20] }' \
    "/proc/$1/stat"
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ -n "$container" ]; then
    podman rm -f "$container" >/dev/null 2>&1 || true
  fi
  if [ "$status" -ne 0 ] && [ "$keep_scratch" -ne 1 ] && [ -n "$work" ]; then
    rm -rf -- "$work"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Start the image in the background with the deployment posture. The
# keep-id mapping makes the host-owned scratch writable as container UID 1000
# on a rootless host (compose.yml uses a podman volume instead).
start_container() {
  image=$1
  data_dir=$2
  name=$3
  container=$name
  if ! podman run -d --name "$container" --log-driver=k8s-file \
    --user 1000:0 --userns=keep-id:uid=1000,gid=0 \
    --cap-drop ALL --security-opt no-new-privileges \
    -e ENV=production -e AGENT_DEFAULT_TYPE=opencode \
    -e DISCORD_ENABLED=false -e MISSKEY_ENABLED=false -e EMAIL_ENABLED=false \
    -v "$data_dir:/app/data:Z" \
    -v "$CONFIG:/app/config.yaml:ro,Z" \
    -p "127.0.0.1:$HOST_PORT:8080" \
    "$image" >/dev/null 2>&1; then
    die "podman run failed for $image"
  fi
}

# Poll /ready every 250 ms. Sets READY_SECONDS on success.
wait_ready() {
  ready_start=$(now_ms)
  ready_deadline=$((ready_start + STARTUP_TIMEOUT_SEC * 1000))
  while :; do
    ready_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$READY_URL" || true)
    if [ "$ready_code" = "200" ]; then
      ready_end=$(now_ms)
      READY_SECONDS=$(seconds_between "$ready_start" "$ready_end")
      return 0
    fi
    ready_now=$(now_ms)
    if [ "$ready_now" -ge "$ready_deadline" ]; then
      return 1
    fi
    sleep 0.25
  done
}

# Require the zero-adapter log line and reject every adapter registration or
# connection marker. This is the proof that no platform client was constructed.
wait_no_platform() {
  log_path=$1
  marker_deadline=$(($(now_ms) + PLATFORM_MARKER_TIMEOUT_SEC * 1000))
  while :; do
    if podman logs "$container" > "$log_path" 2>&1; then
      if grep -Eq 'Platform registered:|Connecting to [0-9]+ platforms|Failed to connect platform|All platforms connection initiated' "$log_path"; then
        die "platform adapter activity found in container logs"
      fi
      if grep -q 'No platform adapters configured' "$log_path"; then
        return 0
      fi
    fi
    if [ "$(now_ms)" -ge "$marker_deadline" ]; then
      return 1
    fi
    sleep 0.25
  done
}

# Capture the host PID and start time of every process descended from the
# container's init process, so leftovers can be checked after stop.
capture_process_tree() {
  times_path=$1
  init_pid=$(podman inspect -f '{{.State.Pid}}' "$container")
  case "$init_pid" in
    ''|*[!0-9]*) die "podman inspect did not return a container PID" ;;
  esac
  [ "$init_pid" -gt 0 ] || die "container init PID is not running"

  ps -eo pid=,ppid= > "$times_path.ps" || die "could not list host processes"
  awk -v root="$init_pid" '
    { parent_of[$1] = $2 }
    END {
      inside[root] = 1
      changed = 1
      while (changed) {
        changed = 0
        for (pid in parent_of) {
          if (!(pid in inside) && (parent_of[pid] in inside)) {
            inside[pid] = 1
            changed = 1
          }
        }
      }
      for (pid in inside) print pid
    }' "$times_path.ps" > "$times_path.pids" || die "could not build the process tree"

  : > "$times_path.times"
  root_seen=0
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    if [ -r "/proc/$pid/stat" ]; then
      start=$(proc_starttime "$pid" 2>/dev/null || true)
      [ -n "$start" ] || die "could not read the start time of PID $pid"
      printf '%s %s\n' "$pid" "$start" >> "$times_path.times"
      if [ "$pid" = "$init_pid" ]; then root_seen=1; fi
    fi
  done < "$times_path.pids"
  [ "$root_seen" -eq 1 ] || die "could not observe the container init process start time"
}

# Sets LEFTOVER to the number of captured host processes still alive with the
# same start time after the container stopped. An unreadable live PID fails
# the drill instead of being counted as zero.
count_leftover() {
  times_path=$1
  leftover=0
  while IFS= read -r line; do
    pid=${line%% *}
    start=${line#* }
    if [ -r "/proc/$pid/stat" ]; then
      now_start=$(proc_starttime "$pid" 2>/dev/null || true)
      if [ -z "$now_start" ] && [ -r "/proc/$pid/stat" ]; then
        die "could not observe leftover candidate PID $pid"
      fi
      if [ -n "$now_start" ] && [ "$now_start" = "$start" ]; then
        leftover=$((leftover + 1))
      fi
    fi
  done < "$times_path"
  LEFTOVER=$leftover
}

# Convert podman's human memory reading to MiB; an unknown unit is a failure.
memory_usage_mib() {
  awk -v usage="$1" 'BEGIN {
    split(usage, parts, "/")
    value = parts[1]
    gsub(/[ \t]/, "", value)
    if (match(value, /^[0-9]+(\.[0-9]+)?/) == 0) exit 1
    number = substr(value, 1, RLENGTH)
    unit = substr(value, RLENGTH + 1)
    if (unit == "B") factor = 1 / 1048576
    else if (unit == "kB" || unit == "KB") factor = 1000 / 1048576
    else if (unit == "MB") factor = 1000000 / 1048576
    else if (unit == "MiB") factor = 1
    else if (unit == "GB") factor = 1000000000 / 1048576
    else if (unit == "GiB") factor = 1024
    else exit 1
    printf "%.3f", number * factor
  }'
}

run_label=""

if [ "${1:-}" = "--rollback" ]; then
  [ $# -eq 3 ] || usage
  image=$2
  data_input=$3

  need_cmd podman
  need_cmd curl
  need_cmd jq
  need_cmd sha256sum
  need_cmd realpath

  [ -f "$CONFIG" ] || die "drill config not found: $CONFIG"
  [ -d "$data_input" ] || die "scratch data directory not found: $data_input"
  data_dir=$(realpath "$data_input") || die "could not resolve $data_input"
  mkdir -p "$MEASUREMENTS" || die "could not create measurements directory"

  attestation=$(dirname "$data_dir")/attestation.json
  [ -f "$attestation" ] || die "missing drill attestation: $attestation"

  expected_secret=$(jq -r '.secretSha256 // empty' "$attestation") || die "invalid attestation"
  [ -n "$expected_secret" ] || die "attestation has no secretSha256"
  [ -f "$data_dir/skill-secret" ] || die "state directory has no skill-secret"
  actual_secret=$(sha256sum "$data_dir/skill-secret" | awk '{ print $1 }')
  [ "$actual_secret" = "$expected_secret" ] || die \
    "skill-secret does not match the Bun-written attestation"

  run_label="rollback-$$"
  start_container "$image" "$data_dir" "air-friends-drill-$run_label"
  if ! wait_ready; then
    die "rollback image did not become ready within ${STARTUP_TIMEOUT_SEC}s"
  fi
  if ! wait_no_platform "$CUTOVER_DIR/measurements/.rollback-$run_label.log"; then
    die "could not verify zero platform adapters for the rollback image"
  fi
  podman stop -t "$STOP_TIMEOUT_SEC" "$container" >/dev/null 2>&1 || true
  podman rm -f "$container" >/dev/null 2>&1 || true
  container=""
  rm -f -- "$CUTOVER_DIR/measurements/.rollback-$run_label.log"
  printf 'rollback ready: %s\n' "$image"
  printf 'rollback state: skill-secret matches the Bun-written attestation\n'
  exit 0
fi

[ $# -ge 3 ] && [ $# -le 4 ] || usage
image=$1
data_input=$2
label=$3
runs=${4:-5}

case "$label" in
  ''|*[!A-Za-z0-9_-]*) die "label must match [A-Za-z0-9_-]+" ;;
esac
case "$runs" in
  ''|*[!0-9]*) die "runs must be a positive integer" ;;
esac
[ "$runs" -ge 1 ] || die "runs must be a positive integer"

need_cmd podman
need_cmd curl
need_cmd jq
need_cmd ps
need_cmd awk
need_cmd sha256sum
need_cmd realpath
need_cmd mktemp

[ -f "$CONFIG" ] || die "drill config not found: $CONFIG"
[ -d "$data_input" ] || die "data copy not found: $data_input"
source_dir=$(realpath "$data_input") || die "could not resolve $data_input"

scratch_root=${AIR_FRIENDS_DRILL_SCRATCH:-${TMPDIR:-/tmp}/air-friends-drill}
mkdir -p "$scratch_root" || die "could not create scratch root: $scratch_root"
work=$(mktemp -d "$scratch_root/$label.XXXXXX") || die "could not create a scratch directory"
work_real=$(realpath "$work") || die "could not resolve the scratch directory"

# Never copy a source into itself or create the scratch inside the source.
case "$source_dir/" in
  "$work_real/"*) die "data copy is inside the new scratch directory" ;;
esac
case "$work_real/" in
  "$source_dir/"*) die "new scratch directory is inside the data copy" ;;
esac

data_dir="$work/data"
mkdir -p "$data_dir" || die "could not create the scratch data directory"
cp -a "$source_dir/." "$data_dir/" || die "could not copy $source_dir into the scratch directory"

# The rollback evidence depends on a daemon-written artifact. If the copied
# state already carries a skill-secret, a running daemon did not necessarily
# write it; refuse rather than claim unproven evidence.
if [ -f "$data_dir/skill-secret" ]; then
  die "data copy already contains skill-secret; cannot prove a daemon-written artifact"
fi

attestation="$work/attestation.json"
runs_file="$work/runs.jsonl"
: > "$runs_file"
measured_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
run_failed=0

run=1
while [ "$run" -le "$runs" ]; do
  dir="$work/run$run"
  mkdir -p "$dir" || die "could not create the run directory"

  start_container "$image" "$data_dir" "air-friends-drill-$label-$run-$$"

  if ! wait_ready; then
    die "run $run did not become ready within ${STARTUP_TIMEOUT_SEC}s"
  fi
  startup_seconds=$READY_SECONDS
  if ! wait_no_platform "$dir/container.log"; then
    die "run $run did not report zero platform adapters within ${PLATFORM_MARKER_TIMEOUT_SEC}s"
  fi

  if [ "$run" -eq 1 ]; then
    [ -f "$data_dir/skill-secret" ] || die \
      "run 1 did not persist data/skill-secret; no daemon-written state to prove"
    secret_sha=$(sha256sum "$data_dir/skill-secret" | awk '{ print $1 }')
    jq -n \
      --arg image "$image" \
      --arg label "$label" \
      --arg secretSha256 "$secret_sha" \
      --arg recordedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '{image: $image, label: $label, secretSha256: $secretSha256, recordedAt: $recordedAt}' \
      > "$attestation" || die "could not write the drill attestation"
  fi

  sleep "$IDLE_SEC"

  memory_usage=$(podman stats --no-stream --format '{{.MemUsage}}' "$container") || die \
    "could not read memory usage for run $run"
  idle_memory_mib=$(memory_usage_mib "$memory_usage") || die \
    "could not parse memory usage '$memory_usage' for run $run"

  fds_raw=$(podman exec "$container" sh -c 'ls /proc/[0-9]*/fd | wc -l') || die \
    "could not count file descriptors for run $run"
  idle_fds=$(printf '%s\n' "$fds_raw" | awk 'NF { print $1; exit }')
  case "$idle_fds" in
    ''|*[!0-9]*) die "invalid file descriptor count '$fds_raw' for run $run" ;;
  esac

  podman top "$container" pid comm > "$dir/processes.txt" || die \
    "could not list processes for run $run"
  tail -n +2 "$dir/processes.txt" > "$dir/processes.body"
  processes_json=$(jq -R -s 'split("\n") | map(select(length > 0))' < "$dir/processes.body") || die \
    "could not encode the process list for run $run"

  capture_process_tree "$dir/host-processes"

  stop_start=$(now_ms)
  if podman stop -t "$STOP_TIMEOUT_SEC" "$container" >/dev/null 2>&1; then
    stop_exit=0
  else
    stop_exit=$?
  fi
  stop_end=$(now_ms)
  stop_seconds=$(seconds_between "$stop_start" "$stop_end")
  container_exit=$(podman inspect -f '{{.State.ExitCode}}' "$container" 2>/dev/null || true)
  case "$container_exit" in
    ''|*[!0-9]*) container_exit=-1 ;;
  esac
  count_leftover "$dir/host-processes.times"

  if podman start "$container" >/dev/null 2>&1; then
    if wait_ready; then
      restart_ready=true
    else
      restart_ready=false
    fi
    if ! wait_no_platform "$dir/container-restart.log"; then
      die "could not verify zero platform adapters after the restart (run $run)"
    fi
    podman stop -t "$STOP_TIMEOUT_SEC" "$container" >/dev/null 2>&1 || true
  else
    restart_ready=false
  fi

  podman rm -f "$container" >/dev/null 2>&1 || true
  container=""

  run_json=$(jq -n \
    --argjson startupSeconds "$startup_seconds" \
    --argjson idleMemoryMiB "$idle_memory_mib" \
    --argjson idleFds "$idle_fds" \
    --argjson processes "$processes_json" \
    --argjson leftoverProcesses "$LEFTOVER" \
    --argjson stopSeconds "$stop_seconds" \
    --argjson stopExit "$stop_exit" \
    --argjson containerExit "$container_exit" \
    --argjson restartReady "$restart_ready" \
    '{startupSeconds: $startupSeconds, idleMemoryMiB: $idleMemoryMiB, idleFds: $idleFds, processes: $processes, leftoverProcesses: $leftoverProcesses, stopSeconds: $stopSeconds, stopExit: $stopExit, containerExit: $containerExit, restartReady: $restartReady}') || die \
    "could not encode run $run"
  printf '%s\n' "$run_json" >> "$runs_file"

  if [ "$stop_exit" -ne 0 ] || [ "$restart_ready" != "true" ]; then
    run_failed=1
  fi
  printf 'run %s: startup=%ss memory=%sMiB fds=%s leftover=%s stop=%ss restartReady=%s\n' \
    "$run" "$startup_seconds" "$idle_memory_mib" "$idle_fds" "$LEFTOVER" \
    "$stop_seconds" "$restart_ready"

  run=$((run + 1))
done

mkdir -p "$MEASUREMENTS" || die "could not create measurements directory"
output="$MEASUREMENTS/$label.json"
temporary="$MEASUREMENTS/.$label.json.$$"
jq -n \
  --arg image "$image" \
  --arg label "$label" \
  --arg measuredAt "$measured_at" \
  --slurpfile runs "$runs_file" \
  '{image: $image, label: $label, measuredAt: $measuredAt, runs: $runs}' \
  > "$temporary" || die "could not write $output"
mv "$temporary" "$output" || die "could not move the measurement file into place"

keep_scratch=1
printf 'measurements: %s\n' "$output"
printf 'scratch data dir: %s\n' "$data_dir"
printf 'attestation: %s\n' "$attestation"

if [ "$run_failed" -ne 0 ]; then
  printf 'drill: at least one run failed (stop exit or restart readiness)\n' >&2
  exit 1
fi
