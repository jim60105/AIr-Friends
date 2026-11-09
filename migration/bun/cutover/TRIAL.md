# Cutover drill and live trial (human-reviewed)

Status: container drill on the development-data substitute complete; the live
trial and its sign-off are **DEFERRED by the owner on 2026-11-10**.

This document is the human-reviewed record for the pre-cutover drill. It does
not replace the automated evidence: the process-level restart guarantee is
`tests/integration/restart-persistence.integration.test.ts`.

## 1. Data copy provenance

- **Date copied:** 2026-11-10.
- **Path:** `./data` in the `drill-bun-cutover-and-rollback` worktree, seeded
  from the original checkout's `./data` with:
  `cp -a /var/home/jim60105/repos/air-friends/data/. data/`
- **Size:** 76K (`du -sh data`).
- **Contents:** `agent-workspace/`, `workspaces/discord/`, `skill-jwt/`,
  `todos.db`; no `skill-secret` (the daemon generates one on first start).
- **What it is:** the repository's **development data**. It is **NOT a copy of
  production `/app/data`**. The production copy was not available on this
  non-root drill host; the owner approved this explicit substitute on
  2026-11-10.
- **What that means:** the measurements below are honest measurements of this
  substitute, but they are **not production-representative**. They do not
  claim production fidelity for P0-8 or for data volume/permissions found in
  production. P0-8 at process level is proven by the automated test.
- **Non-mutation:** the copy was never mounted or written. `drill.sh` copies it
  to a fresh scratch directory and binds only that scratch; after every drill
  the source was still 76K with no `skill-secret`. The seeded worktree copy and
  every scratch copy were deleted after the drill (task 5.1); the measurement
  files remain.
- **Rollback image:** `ghcr.io/jim60105/air-friends@sha256:fad837549aaeeadb7ac6be51d58cdb2f25c3effb0dedc8abbf0eb32df93b0059`
  pulled rootlessly (created 2026-11-07, the recorded rollback reference).

## 2. Drill results

### Configuration actually measured

Every run mounted only `migration/bun/cutover/config.drill.yaml` at
`/app/config.yaml` (read-only) and the scratch state at `/app/data`. The
drill config disables Discord, Misskey and email, disables the dashboard and
enables health on 8080; the agent settings are unchanged. The container runs
with compose.yml's restricted posture (`--user 1000:0 --cap-drop ALL
--security-opt no-new-privileges`) and `-e ENV=production`. No credential is
passed.

Two drill-only adaptations are required because the config loader refuses a
zero-platform file:

- `platforms.drill.enabled: true` is an explicit sentinel. `drill` is not a
  platform the application knows; no adapter, client or connection can exist
  for it, and bootstrap only constructs adapters for discord, misskey and
  email.
- The drill passes `DISCORD_ENABLED=false`, `MISSKEY_ENABLED=false` and
  `EMAIL_ENABLED=false` explicitly, so no environment or image default can
  override the YAML, and `AGENT_DEFAULT_TYPE=opencode` resolves the example's
  required env placeholder to the documented default.

**Platform-safety observation:** every run's container log contains
`"message":"No platform adapters configured"` (Bootstrap, WARN) and
`"platforms":[]` (Main), and contains none of `Platform registered:`,
`Connecting to <n> platforms`, `Failed to connect platform` or `All platforms
connection initiated`. `drill.sh` fails the run if that evidence changes.

### Deno (rollback) image

Command:

```bash
sh migration/bun/cutover/drill.sh \
  ghcr.io/jim60105/air-friends@sha256:fad837549aaeeadb7ac6be51d58cdb2f25c3effb0dedc8abbf0eb32df93b0059 \
  data deno 5
```

Five runs, all ready, restart-ready, stopped with exit 0 in under 15 s and
left zero processes:

| run | startup s | idle MiB | idle FDs | leftovers | stop s | stop exit | restart ready |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1.301 | 87.805 | 42 | 0 | 0.090 | 0 | true |
| 2 | 1.303 | 86.851 | 42 | 0 | 0.085 | 0 | true |
| 3 | 1.046 | 87.843 | 42 | 0 | 0.091 | 0 | true |
| 4 | 1.043 | 87.671 | 47 | 0 | 0.081 | 0 | true |
| 5 | 1.043 | 86.288 | 42 | 0 | 0.090 | 0 | true |

Thresholds derived from this file (medians 1.046 s / 87.671 MiB, max 47 FDs)
and committed before the Bun run: startup 1.3075 s, idle memory 109.58875 MiB,
idle FDs 58.75, leftover processes 0, stop under 15 s, every restart ready.

### Bun image

Command:

```bash
sh migration/bun/cutover/drill.sh localhost/air-friends:bun-local data bun 5
```

The measured image's `/app/src` `main.ts` and `bun.lock` hashes equal this
commit's files, so the measurement is of the cutover build's source. Image:
`localhost/air-friends:bun-local` (podman image ID
`7d80437a51972f4252d95128f0e7000d77c627ba69b1b9a56cfb158ae37b6ddc`).

| run | startup s | idle MiB | idle FDs | leftovers | stop s | stop exit | restart ready |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.787 | 77.782 | 35 | 0 | 0.087 | 0 | true |
| 2 | 0.783 | 77.782 | 35 | 0 | 0.080 | 0 | true |
| 3 | 0.784 | 77.677 | 35 | 0 | 0.084 | 0 | true |
| 4 | 0.787 | 77.734 | 40 | 0 | 0.085 | 0 | true |
| 5 | 0.788 | 78.192 | 35 | 0 | 0.081 | 0 | true |

Every run was ready and restart-ready, stopped with exit 0 in under 15 s and
left zero processes.

### Threshold comparison

Command:

```bash
cd migration/bun/cutover
bun run --no-env-file compare.ts measurements/deno.json measurements/bun.json thresholds.json
```

Output (exit 0):

```text
startupSeconds 1.308 0.787 ok
idleMemoryMiB 109.589 77.782 ok
idleFds 58.75 40 ok
leftoverProcesses 0 0 ok
stopSeconds 15 0.087 ok
stopExit 0 0 ok
restartReady true true ok
```

The thresholds file was committed before `measurements/bun.json` was created;
`compare.ts` verified the committed blob and the order before comparing. A
nonzero `stopExit` in any Bun run fails the comparison, as do the other
metrics.

### Rollback drill

Command:

```bash
sh migration/bun/cutover/drill.sh --rollback \
  ghcr.io/jim60105/air-friends@sha256:fad837549aaeeadb7ac6be51d58cdb2f25c3effb0dedc8abbf0eb32df93b0059 \
  /tmp/air-friends-drill/bun.qyaqXL/data
```

Result (exit 0):

```text
rollback ready: ghcr.io/jim60105/air-friends@sha256:fad837549aaeeadb7ac6be51d58cdb2f25c3effb0dedc8abbf0eb32df93b0059
rollback state: skill-secret matches the Bun-written attestation
```

The rollback image started on the exact scratch state the Bun runs used after
Bun wrote `skill-secret` there, the daemon-written secret matched the recorded
attestation, and `/ready` answered 200 within the drill timeout. The rollback
run also passed the zero-platform log guard.

### Drill implementation adaptations

- `--log-driver=k8s-file` is passed because this host's journald driver
  captured no container output, which would make the platform-safety log check
  unobservable. It changes log capture only, not the process or its posture.
- `--userns=keep-id:uid=1000,gid=0` maps the host-owned scratch directory to
  container UID 1000 on this non-root host; compose.yml uses a podman volume
  instead. `--user 1000:0` is unchanged.
- Each run additionally records `leftoverProcesses` (host PID + start-time
  comparison after stop) and `containerExit` (the container's recorded exit
  status). Design D2's minimal schema omitted these fields, but D3 and the
  P0-3 evidence need them; all other fields follow D2.

## 3. Live trial with test accounts — DEFERRED

The live trial is knowingly deferred by the owner (2026-11-10). No live check
was run and **no platform check has passed**. Discord permits exactly one live
bot instance per application and production holds it; no test accounts or
credentials exist for Discord, Misskey or Email; and this environment cannot
start the service against a live platform. No result below is fabricated.

| Check | Result | Date |
| --- | --- | --- |
| Discord reply from a test account | DEFERRED — one live bot instance is permitted and production holds it; no test account or credential here | 2026-11-10 |
| Misskey reply from a test account | DEFERRED — one live bot instance policy; no test account or credential here | 2026-11-10 |
| Email receive and reply | DEFERRED — no mailbox account or credential available here | 2026-11-10 |
| Reminder fires | DEFERRED — needs a live session to schedule and observe delivery; persistence is covered by the automated restart test | 2026-11-10 |
| Memory save and recall | DEFERRED — needs a live session for recall; persistence is covered by the automated restart test | 2026-11-10 |
| Skill API calls from a skill | DEFERRED — needs a live agent session to invoke a skill against the Skill API | 2026-11-10 |
| OpenCode session | DEFERRED — no live agent credential available here | 2026-11-10 |
| OMP session | DEFERRED — no live agent credential available here | 2026-11-10 |

**Risk of deferral:** at release, live Discord/Misskey/Email connectivity and
reply delivery, reminder firing, live memory recall, Skill API calls from a
skill, and OpenCode/OMP sessions remain unverified. The drill proves container
startup, resources, stop/restart, rollback and process-level persistence only.
Verify every row above in a post-release maintenance window with test accounts
and credentials; a failure there is handled as a release incident, including
rollback to the old digest.

## 4. Deployment parameters at cutover

Change in ArgoCD together with the image digest:

- `env.DENO_ENV` → `env.ENV` (the current code reads `ENV`; default
  `development`).
- `AGENT_SKILLS_DIR` → the deployment's `/home/air/.agents/skills` tree (the
  image default; relative values anchor at the working directory).
- Image digest → the cutover image digest, never the mutable `latest` tag.
- Rollback parameters: old image digest
  `ghcr.io/jim60105/air-friends@sha256:fad837549aaeeadb7ac6be51d58cdb2f25c3effb0dedc8abbf0eb32df93b0059`
  and the old `DENO_ENV` / skills-directory values.

## 5. Owner sign-off

- [x] Owner acknowledgement: the live trial in section 3 is knowingly
  **DEFERRED** (2026-11-10). The owner accepts that no platform check has
  passed and that those checks will be verified post-release with test
  accounts.

Owner: the owner (acknowledgement recorded through the supervisor)
Date: 2026-11-10
Live trial: knowingly deferred — accepted 2026-11-10
