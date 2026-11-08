# Design

## Context

See `proposal.md`. Observed facts:

- Rollback reference: `ghcr.io/jim60105/air-friends@sha256:fad837549aaeeadb7ac6be51d58cdb2f25c3effb0dedc8abbf0eb32df93b0059`, source `734c8b0`, observed from the cluster on 2026-11-07.
- The health server listens on `health.port` (default 8080) and answers `/health`, `/healthz`, `/ready`, `/readyz`. `src/main.ts` logs `AIr-Friends is running` after platforms start.
- Stores: `MemoryStore.addMemory`, `getCoreTierMemories`, `getRecentWorkingMemories`; `ReminderStore.addReminder`, `getActiveCount`, `getDueReminders`; `WorkspaceManager.getOrCreateWorkspace(event)`, `writeWorkspaceFile`, `readWorkspaceFile`; `resolveSkillApiSecret(...)` returns `{ source: "env" | "file" | "generated", secret }`, persisting to `data/skill-secret`; `createSkillJwt`/`verifySkillJwt` in `src/utils/skill-jwt.ts`; `src/utils/path-validator.ts` holds the workspace boundary check.
- Deployment permissions: `--user 1000:0 --cap-drop ALL --security-opt no-new-privileges` (`compose.yml`).

## Goals / Non-Goals

**Goals:** automated P0-8, container stop/restart and rollback evidence; thresholds fixed before the comparison; a written live-trial checklist.

**Non-Goals:**

- No production deployment and no ArgoCD change (owner, at cutover).
- No live-platform automation; live checks are the owner's trial in `TRIAL.md`.
- No change to `src/`.

## Decisions

### D1. Restart persistence test

`tests/integration/restart-persistence.integration.test.ts`: one temp data directory per test. Phase 1 creates stores and the workspace manager from a test `AppConfig` pointing at it, writes the state of each spec scenario, then drops every reference. Phase 2 creates fresh instances on the same directory and asserts. "Restart" is in-process (new instances, no shared module state is relied on: the test calls any exported cache-reset function the stores provide, such as the memory-recall snapshot cache reset). The isolation scenario uses the same boundary check the skill handlers use for workspace paths. One test per spec scenario, named after it.

### D2. Drill

`migration/bun/cutover/drill.sh <image> <data-copy-dir> <label> [runs]` (default `runs` 5):

1. Copy `<data-copy-dir>` to a fresh scratch directory for this label (never touch the source copy).
2. For each run: `podman run -d --user 1000:0 --cap-drop ALL --security-opt no-new-privileges -v <scratch>:/app/data:Z -v migration/bun/cutover/config.drill.yaml:/app/config.yaml:ro,Z -p 127.0.0.1:18080:8080 <image>`; startup time = seconds from `podman run` returning to the first `200` from `http://127.0.0.1:18080/ready` (poll every 250 ms, timeout 120 s); after 60 s idle: memory from `podman stats --no-stream --format '{{.MemUsage}}'` (MiB), descriptors = sum over `podman exec <c> sh -c 'ls /proc/[0-9]*/fd | wc -l'`, processes = `podman top <c> pid comm`; then `podman stop -t 15`, stop duration and exit code; then `podman start`, readiness again (restart), `podman stop -t 15`; then `podman rm`.
3. Write `measurements/<label>.json`: `{ image, label, measuredAt, runs: [{ startupSeconds, idleMemoryMiB, idleFds, processes: [...], stopSeconds, stopExit, restartReady }] }`.

`config.drill.yaml` is `config.example.yaml` with every platform disabled, the dashboard disabled, health enabled on 8080 and agents unchanged.

Rollback check (`drill.sh --rollback <rollback-image> <scratch-of-bun-run>`): one run of the rollback image on the scratch directory the Bun runs used; it must become ready.

### D3. Thresholds and comparison

Order is enforced by `compare.ts`: it reads `thresholds.json` and `git log -1 --format=%cI -- migration/bun/cutover/thresholds.json`; a missing file or a commit time after the Bun file's `measuredAt` exits 2.

`thresholds.json` is derived from `measurements/deno.json` with this rule, recorded in the file: startup threshold = Deno median × 1.25; idle memory threshold = Deno median × 1.25; idle descriptor threshold = Deno maximum × 1.25; leftover processes after stop = 0; stop duration < 15 s; every restart ready. `compare.ts measurements/deno.json measurements/bun.json thresholds.json` prints one line per metric (`metric threshold measured ok|FAIL`) and exits 1 on any failure. `compare.spec.ts` covers the spec scenarios with in-memory inputs (the git time is injected).

### D4. `TRIAL.md` (human-reviewed)

Sections: data copy provenance (date, `kubectl cp` command, size); drill results (pasted `compare.ts` output, rollback result); live trial with test accounts per platform and agent (one line per check, with result and date: Discord reply, Misskey reply, Email receive and reply, reminder fires, memory save and recall, Skill API calls from a skill, an OpenCode session, an OMP session); deployment parameters to change in ArgoCD (`env.DENO_ENV` → `env.ENV`; `AGENT_SKILLS_DIR` under `/home/air`; image digest) and the rollback parameters (old digest and old values); owner sign-off line. This document is reviewed by the owner; no test asserts its content.

## Risks / Trade-offs

- [Production data contains secrets] → The copy stays on the drill host, is not committed, and the scratch copies are deleted after the drill.
- [Startup of the Deno image includes module compilation and is slower] → The thresholds only bound regressions of Bun relative to Deno, so a faster Bun passes.

## Open Questions

- The owner confirmed the D3 thresholds (the 1.25 multipliers, zero leftover processes, stop under 15 s) on 2026-11-09 as the meaning of "no material regression"; `thresholds.json` uses these values. The rule's shape and the order enforcement do not change.
