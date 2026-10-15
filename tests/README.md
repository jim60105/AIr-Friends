# Test Map

## Unit vs integration split

| Task                                          | Scope                                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deno task test:unit`                         | Everything under `tests/` except `tests/integration/` (`--ignore=tests/integration`).                                                                  |
| `deno task test:integration`                  | `tests/integration/` only. Subprocess-backed tests self-skip (`ignore:`) when `dumb-init` or `deno` is absent from `PATH`; the container bundles both. |
| `deno task test:coverage` + `coverage:report` | Coverage gate (> 75%) over the same tree.                                                                                                              |
| `deno task fmt:check` / `lint` / `check`      | Formatting, lint, and type gate for `src/` + `tests/`.                                                                                                 |

Never run bare `deno test`; use the tasks above so permission flags match CI.

The packaging suite's local-architecture image scenario
(`tests/utils/omp-packaging.test.ts`) is an explicit opt-in: it runs ONLY with
`OMP_PACKAGING_BUILD=1` on a host with a usable `podman` (`ignore:` otherwise,
like the other subprocess-backed tests), because it builds the real image and
starts the installed native runtime. No CI run therefore pays for a container
build, and every other scenario under `tests/` stays mock/unit evidence.

## Mock harness inventory (`tests/mocks/`)

- **`mock-acp-agent.ts`** — scripted ACP agent spoken over stdio JSON-RPC
  (the `dumb-init -- deno run …` spawn pattern used by
  `tests/integration/shared-process.integration.test.ts`). Baseline behavior:
  prompt delay, Skill-API callbacks (memory-save / send-reply). OMP lifecycle
  behavior activates ONLY on opt-in env inputs the shipped OpenCode suites
  never set: `MOCK_STATE_FILE`, `MOCK_OMP_CONFIG_CATALOG` /
  `MOCK_OMP_LOAD_CONFIG_CATALOG` (`grouped|flat|miss|none` config-option
  catalogs on `session/new` / `session/load`), `MOCK_OMP_RECORD_RPC`
  (JSONL `{gen,seq,pid,method,params}` per handled request; `gen` is unique
  per connection generation), `MOCK_CRASH_ON_PROMPT` (+ `MOCK_SIDEBRO=1` to
  prove tool-child death; needs `--allow-run`), and the `mock-refresh-config`
  prompt trigger that emits a genuine `config_option_update` notification.
- **`mock-acp-connection.ts`** — in-process scripted connection recorder
  injected at the connector's connection seam: records every RPC
  (recorder keys are the connection method names — `initialize`,
  `newSession`, `loadSession`, `prompt`, `cancel`, `setSessionMode`,
  `unstable_setSessionModel`, `setSessionConfigOption`, mapping to the
  wire methods `initialize`, `session/new`, `session/load`, `session/prompt`,
  `session/cancel`, `session/set_mode`, `session/set_model`,
  `session/set_config_option`),
  replays scripted responses/notifications, supports scripted mid-call
  connection death (`crash: true` never settles).
- **`omp-mock-session.ts`** — the shared OMP mock-session builder (spec:
  Shared OMP Mock Session Builder Contract). Composition dimensions:
  permission mode, the pool base root the mode-scoped native data root
  derives from (`{baseRoot}/omp-agent/{mode}/xdg-data`), the scripted
  in-process connection, and client-config/cwd overrides. There is no readiness
  tuple/channel/surface anywhere on the composed object. The follow-up
  per-spawn/pool
  skill-handoff regression (row 22) consumes this builder **unchanged**;
  new fields are added only additively in that change.

Mock evidence is identified as mock evidence by the owning suite's scenario
and comment naming; no synthetic-approval ledger, epoch or governance record
exists anywhere in this tree.

## Combined lifecycle suite (`tests/integration/omp-lifecycle/`)

| File                                      | Covers                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lifecycle.integration.test.ts`           | 3.1 happy path (initialize/new/prompt/cancel/load through the real `AgentProcessPool`), 3.2 crash → reconnect → same-mode load with gate-context re-evaluation, 3.3/3.3b cross-mode ownership rejection both directions + post-load catalog-miss isolation, 4.1 absent-handler client-policy denials + pinned launch posture, 4.3 dual-mode coexistence on the global lease + LSP-posture stability across respawn. |
| `opencode-regression.integration.test.ts` | 5.1 OpenCode launch values byte-compared to the shipped factory output + pool reuse + OpenCode-only RPC stream + `agent-config/opencode.json` build/yolo `lsp` denies; 5.2 the mock composition exposes no readiness/handler surface, so no readiness claim can drift in.                                                                                                                                           |

## Determinism rules

- **Fake timers** (`@std/testing/time`) are legal per-OBJECT, not per-suite:
  never let FakeTime coexist with a real `AgentProcessPool` or a subprocess
  connector — their liveness/idle math reads `Date.now()` across process
  boundaries. (No suite here uses FakeTime at either tier; in-process
  connection-tier tests may.)
- Subprocess death/assertions are driven by the mock's **scripted crash
  trigger** (prompt-text-matched, no delay dependency), the connector's own
  crash signal, and the **recorded RPC JSONL** — never by wall-clock sleeps
  or delay-based kill races. `MOCK_PROMPT_DELAY_MS=0` removes the mock's
  own delay from lifecycle tests.
- Waiting is limited to bounded polls of explicitly observable facts
  (`kill -0` liveness, pool `isIdle()` after the documented release drain),
  each with a hard attempt cap.
- Subprocess spawns in the integration task are exclusively `deno run`
  mocks of `mock-acp-agent.ts`: no real `omp` executable, provider or paid
  credentials, network egress, container/bwrap, or live-acceptance path.

## Mock-evidence rule

Mock evidence stays mock evidence: the owning suite identifies it as such in
its own scenario names and comments. There is no synthetic-approval ledger,
epoch or governance record to register against, so an allow-path fixture needs
no separate bookkeeping entry.

## Evidence boundary (design §15)

Mock evidence never certifies native behavior. Nothing in this tree
demonstrates or claims that the native OMP binary invokes the attached
handler, honors a denial, rejects a cross-mode load, emits readiness, or
suppresses a language server. Those remain the user-owned runtime checklist
(`docs/agent/security-and-sandbox.md`). Extension-load failure stays the
accepted residual risk: pinned `runner.emit` logs lifecycle errors without
failing startup, and no client-observable readiness assertion compensates.

## Deliberately untouched files

The original (P0–P9) suite was test-only: `CHANGELOG.md` was intentionally
untouched (the batch changelog sync is owned by the final docs row), and
`config.example.yaml`, `.env.example`, `helm/values.yaml`, and `deno.json`
carried no changes. Correction-batch row C2 (`align-omp-native-tool-contracts`)
once pinned `@sinclair/typebox` in `deno.json`/`deno.lock` so Deno fixtures
resolved the schema-builder facade the pinned host resolved; the native
runtime cutover removed that alias, so no import-map pin remains
(`docs/agent/acp-engine.md`).
Correction-batch row C3 (`package-bun-compatible-omp-extension`) replaces the
extension packaging under test: the image-side mirror tree and generated
`deno.json` import map are gone, replaced by ONE generated native-loadable
bundle (`deno task bundle:omp-extension` → `index.js`; the packaging suite
builds it, audits its emitted edges and asserts that no digest inventory is
prepended). The bundled capability-admission closure carries no external
dependency edge at all — documented `node:`/`bun:` builtins stay external
because the native runtime provides them — and the bundle installs no npm: pin.
