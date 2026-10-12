# Test Map

## Unit vs integration split

| Task                                          | Scope                                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deno task test:unit`                         | Everything under `tests/` except `tests/integration/` (`--ignore=tests/integration`).                                                                  |
| `deno task test:integration`                  | `tests/integration/` only. Subprocess-backed tests self-skip (`ignore:`) when `dumb-init` or `deno` is absent from `PATH`; the container bundles both. |
| `deno task test:coverage` + `coverage:report` | Coverage gate (> 75%) over the same tree.                                                                                                              |
| `deno task fmt:check` / `lint` / `check`      | Formatting, lint, and type gate for `src/` + `tests/`.                                                                                                 |

Never run bare `deno test`; use the tasks above so permission flags match CI.

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
  permission mode, recorded ownership context (`deriveActualRecoveryTarget`
  from the factory env — never hand-derived), config-catalog shape, handler
  availability (**default absent**), live registry-epoch tool-observation
  fixtures, and destructive-input shapes. Every allow-path fixture must be
  registered as a labeled synthetic positive in `SyntheticPositiveLedger`.
  The 5.2 runtime guard scans `SyntheticPositiveLedger.allEntries()` — a
  **per-Deno-process** scan (Deno gives each test file its own process), so
  the guard verifies every positive registered in its own file, and every
  other suite verifies its own fixtures locally (each file asserts its own
  ledger entries carry the label). There is no readiness
  tuple/channel/surface anywhere on the composed object. The follow-up
  per-spawn/pool
  skill-handoff regression (row 22) consumes this builder **unchanged**;
  new fields are added only additively in that change.

## Combined lifecycle suite (`tests/integration/omp-lifecycle/`)

| File                                          | Covers                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lifecycle.integration.test.ts`               | 3.1 happy path (initialize/new/prompt/cancel/load through the real `AgentProcessPool`), 3.2 crash → reconnect → same-mode load with gate-context re-evaluation, 3.3/3.3b cross-mode ownership rejection both directions + post-load catalog-miss isolation, 4.1 absent-handler client-policy denials + pinned launch posture, 4.3 dual-mode coexistence on the global lease + LSP-posture stability across respawn. |
| `enforcement-composition.integration.test.ts` | 4.2 registry-refresh re-admission composed through 14b's real handler body + 14a's real decision modules (connection tier): stale-epoch denial, labeled MCP re-admission positive, workspace-origin provenance denial, record-survivor never grants, undecodable destructive fail-closed with zero side effects.                                                                                                    |
| `opencode-regression.integration.test.ts`     | 5.1 OpenCode launch values byte-compared to the shipped factory output + pool reuse + OpenCode-only RPC stream + `agent-config/opencode.json` build/yolo `lsp` denies; 5.2 the mandatory runtime honesty guard (ledger scan + pinned unresolved-seam statuses as data).                                                                                                                                             |

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

## P0 fixture-labeling rule

Every scenario where a restricted call or prompt is **allowed** registers
its enabling fixture in `SyntheticPositiveLedger` with a
`composition-boundary:` label stating why it is a synthetic positive, not
native evidence. Deny/blocked outcomes need no ledger entry (they are the
fail-closed default). The 5.2 guard fails the suite if any ledger entry
lacks the label, and asserts the pinned unresolved-seam statuses
(`needs-mechanism-audit` MCP basis, `unresolved` record-reset gate,
`UNRESOLVED` destructive-decode verdict) as deny-basis data.

## Evidence boundary (design §15)

Mock evidence never certifies native behavior. Nothing in this tree
demonstrates or claims that the native OMP binary invokes the attached
handler, honors a denial, rejects a cross-mode load, emits readiness, or
suppresses a language server. Those remain the user-owned runtime checklist
(`docs/OMP_ENFORCEMENT.md` §Checklist). Extension-load failure stays the
accepted residual risk: pinned `runner.emit` logs lifecycle errors without
failing startup, and no client-observable readiness assertion compensates.

## Deliberately untouched files

The original (P0–P9) suite was test-only: `CHANGELOG.md` was intentionally
untouched (the batch changelog sync is owned by the final docs row), and
`config.example.yaml`, `.env.example`, `helm/values.yaml`, and `deno.json`
carried no changes. Correction-batch row C2 (`align-omp-native-tool-contracts`)
supersedes the last claim: `deno.json`/`deno.lock` now carry the exact
`@sinclair/typebox` import-map pin that lets Deno fixtures resolve the same
schema-builder facade the pinned host host-resolves for the extension
closure (`docs/OMP_PACKAGING.md` §5).
Correction-batch row C3 (`package-bun-compatible-omp-extension`) replaces the
extension packaging under test: the image-side mirror tree and generated
`deno.json` import map are gone, replaced by ONE generated native-loadable
bundle (`deno task bundle:omp-extension` → `index.js`; the packaging suite
builds it and asserts the emitted-edge audit and digest inventory). The repo
import-map pin above stays for Deno fixtures — the BUNDLE itself keeps only
the bare host-facade specifier and installs no npm: pin.
