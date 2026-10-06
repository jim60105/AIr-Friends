## Why

Design §12 requires translating the relevant non-permission OpenCode settings (provider identity, prompt override, update posture, automatic compaction) into owned OMP settings, and design §7 makes owned overlays with higher precedence than project-discovered config the authoritative configuration layer — yet no OMP settings content exists today, and P0 recorded that the pinned loader folds all CLI overlays into one mapping before merging over global/project, so the approved reset-then-mode record-clearing recipe does NOT preserve its barrier. The mode-separated overlay content, its exact source-backed security pins, and the honest gate on the unresolved record reset must be authored as testable data/assembly before the factory (row 9) can ever launch an `omp` process.

## What Changes

- Author two mode-separated owned settings overlays — restricted and native-yolo — assembled from one pure module as ordered `--config` overlay files plus an owned `models.yml` and `SYSTEM.md`, with deployment-owned `PI_CODING_AGENT_DIR`/cwd making global and project discovery layers non-hostile, so workspace/project config cannot loosen the pins.
- Pin the exact source-backed, security-relevant OMP schema keys in the restricted composition: `tools.approvalMode: write` (explicit non-YOLO native mode; the per-tool `tools.approval` policy itself is row 14), `lsp.enabled: false` (pin only; the disable implementation and implicit-startup proof are row 15), `startup.checkUpdate: false`, `marketplace.autoUpdate: off`, and a complete-replacement `disabledProviders` array. Unknown YAML keys and invalid values that fall back to schema defaults are explicitly rejected as protection by the assembly validator, which accepts only keys registered at the pinned revision.
- Record the authoritative-record-reset outcome honestly: the null-reset-then-mode-mapping strategy is an UNRESOLVED APPLICATION GATE, not a working mechanism. `Settings.#readConfigOverlays` folds every CLI file into one mapping that `#mergeOwnLayers` deep-merges over global/project, and `#deepMerge` retains base-only entries, so lower-layer `tools.approval` grant/prompt/deny records can survive into an OMP process — grants the restricted runtime must not rely on settings-layer clearing to remove, and prompt/deny entries YOLO must not inherit. The restricted execution-time default-deny (row 14) is what actually holds the boundary. No working reset is fabricated; a candidate source-backed alternative (programmatic `Settings.isolated` override authority) is recorded as a P0-verify contract, not support.
- Translate provider/application identity with source-backed mechanisms only: Gemini is OMP's provider `google` credentialed solely by `GEMINI_API_KEY`, OpenRouter by `OPENROUTER_API_KEY` (row-7 supported set only, no new credentials); `X-Title: AIr-Friends` and `HTTP-Referer` are preserved by adding those headers via the agent directory's owned `models.yml`, because pinned OMP sends its own identity (`X-OpenRouter-Title: omp`, `HTTP-Referer: https://omp.sh/`, `packages/ai/src/utils/openrouter-headers.ts`) and no settings key changes it. Model IDs are never hardcoded into owned assets; operator selectors are passed through and must exist in the selected agent's advertised catalog.
- Keep automatic compaction enabled (`compaction.enabled: true`) with pinned native strategy and document the OpenCode `{auto, prune}` vs OMP `methodOrder/asyncEnabled/midTurnEnabled/threshold*` behavioral difference in `docs/OMP_SETTINGS.md`; no OMP `prune` setting is invented.
- Map `/app/prompts/system_prompt_override.md` and the per-file prompt mounts to the source-backed explicit `--system-prompt <path>` custom-prompt route (plus the discovered `<agent dir>/SYSTEM.md` copy); the mapping and its precedence are stated, runtime application is asserted only after the P0 runtime-checklist item, not here.
- Enforce mode non-contamination structurally: the restricted composition receives restricted pins, the native-yolo composition receives `tools.approvalMode: yolo` plus shared deployment pins and never any restricted `tools.approval` clamp, `disabledProviders` entry, or LSP value (design D6).
- Explicit non-goals (owned elsewhere): factory launch-command assembly, trusted-module path, `PI_CODING_AGENT_DIR`/state-dir wiring (row 9); pool identity (row 10); the restricted tool inventory/provenance policy itself and `tools.approval` records (row 14); LSP disable implementation including implicit startup (row 15); settings-file checksum/packaging install (row 20); P0 contract redefinition; row-7 supported-type predicate redefinition.
- No new `config.yaml`, `.env`, or Helm field is introduced: owned assets are deployment-owned files following the existing `agent-config/opencode.json` asset pattern, and credentials are the existing `GEMINI_API_KEY`/`OPENROUTER_API_KEY` (and their `agent.*` config forms) already passed by row 7; `config.example.yaml`, `.env.example`, and `helm/values.yaml` therefore remain intentionally unchanged in this change.

## Capabilities

### New Capabilities

None. Reuse the existing ACP integration capability; owned-settings requirements extend it rather than fork a parallel specification.

### Modified Capabilities

- `acp-integration`: Add requirements for mode-separated owned OMP settings content with higher-precedence overlay assembly, source-backed schema-key validation, the unresolved record-reset application gate, provider/application identity translation, compaction posture with documented native differences, self-update disablement, system-prompt mapping, and structural mode non-contamination. Existing runtime requirements, the P0 compatibility requirements, and the row-7 supported-type/credential requirements are consumed unchanged.

## Impact

Eventual implementation owns: `src/acp/omp-settings.ts` (pure typed composition: overlay documents, ordered paths, the owned `models.yml` content, `SYSTEM.md` source-path mapping, and a schema-key validator), `agent-config/omp/restricted.yml`, `agent-config/omp/native-yolo.yml`, `agent-config/omp/models.yml`, the settings-mapping section of `docs/OMP_SETTINGS.md`, focused CHANGELOG entry, and consumer-visible tests `tests/acp/omp-settings.test.ts` with native-shaped fixtures under `tests/fixtures/omp-settings/`. Shared-file conflicts: `src/acp/agent-factory.ts` (row 9 consumes the assembled selectors; this change does not edit the factory), `agent-config/` asset tree (row 20 installs with checksums; this change authors content only), `docs/`/`CHANGELOG.md` serial integration. `src/core/config-loader.ts`, `src/utils/env.ts`, `src/acp/sandbox-manager.ts`, the P0 contract module, row-7 predicate files, `config.example.yaml`, `.env.example`, and `helm/values.yaml` are untouched.

Application gate inherited from P0: the authoritative-record-reset boundary is recorded incompatible-as-stated/unresolved; this change generates settings data and tests but an OMP launch must not consume it for security-boundary purposes until the user approves an alternative (restricted default-deny is the operative boundary). No native API is invented and no mock certifies native behavior.

## Workday Budget

| Eventual implementation activity | Hours |
| --- | ---: |
| Pinned-schema source trace, pure composition module + both overlay documents | 1.75 |
| Provider/identity `models.yml` translation + prompt-mapping module | 1.00 |
| Schema-key validator (registered-keys-only, invalid-value rejection) + reset-gate modeling (faithful merge semantics, never remodeled) | 1.25 |
| Consumer-visible unit tests (precedence ordering, mode non-contamination, provider headers, prompt mapping, compaction/update decisions, surviving-lower-record gate documentation) | 1.75 |
| `docs/OMP_SETTINGS.md` mapping/differences tables + CHANGELOG | 0.75 |
| Applicable local type/unit checks and OpenSpec verification, no live agents | 0.50 |
| Contingency for review fixes | 1.00 |
| **Total hard ceiling** | **8.00** |

Core is 7.0 hours plus 1.0 contingency. Launch commands, pool identity, tool-policy records, LSP implementation, and packaging installation are owned by rows 9/10/14/15/20 and would exceed this change if attempted.

## Batch:

depends-on: establish-omp-compatibility-contracts
depends-on: add-omp-agent-configuration

| Change | Relationship | Code/spec conflict notes |
| --- | --- | --- |
| establish-omp-compatibility-contracts (P0) | Application gate + contract consumer | Consume the `RecordAuthorityContract` verdict machinery and the recorded reset counterexample unchanged; the reset boundary stays unresolved and gates OMP security consumption. Do not edit P0 artifacts or relabel the counterexample as supported. |
| add-omp-agent-configuration (row 7) | Required predecessor, credential/predicate consumer | Credentials come only from row 7's `omp` supported set (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`); the shared-type predicate is reused, never reparsed or redefined. Row 7 explicitly deferred the scoped-state decision to rows 8/9: this change names the required env posture (`PI_CODING_AGENT_DIR` under the process state root, no `OMP_PROFILE`/`PI_PROFILE`/`PI_CONFIG_FILES`/`XDG_*` selectors leaked) but the env wiring itself is row 9's. |
| spawn-mode-scoped-omp-agents (row 9) | Required successor, same-subsystem follow-on | Row 9 assembles the launch command (overlay ordering last among `--config` entries, `--system-prompt <owned SYSTEM.md>`), sets `PI_CODING_AGENT_DIR`/process `TMPDIR`, installs the owned `models.yml`/`SYSTEM.md` under that root, and must keep `PI_CONFIG_FILES`/extra overlay paths deployment-owned. It consumes this change's selectors and documents; it must not fork a second overlay convention. Serialize `agent-factory.ts` after row 7. |
| isolate-omp-process-pools-by-mode (row 10) | Downstream consumer | Pool/state identity must keep restricted and YOLO state roots distinct so neither process's discovered layers re-absorb the other's content; no shared files with this change. |
| enforce-omp-restricted-tool-policy (row 14) | Security successor | The restricted runtime default-deny, `tools.approval`-record policy, and `xd://`/alternate-surface blocking are row 14's; this change pins only the mode selector and provider/surface boundaries and depends on row 14 being the operative boundary while the record reset stays gated. |
| disable-restricted-agent-lsp (row 15) | Successor | This change pins `lsp.enabled: false` in the restricted overlay only; row 15 owns the implementation, the implicit-startup proof, and OpenCode-side scoping. The YOLO overlay must never carry the pin. |
| package-pinned-omp-runtime (row 20) | Successor, same-asset-tree | Row 20 installs the authored `agent-config/omp/*` files outside agent-writable roots with checksums; content changes here must land before row 20's digest list is cut. |
| modernize-acp-session-config (row 6) | Independent sibling | Model/reasoning selection uses the advertised catalog; this change hardcodes no model IDs, so no `agent-connector.ts` conflict. |
| finish-omp-mocked-skill-handoff (row 22) | Final regression/docs | Extends (never rewrites) the settings-mapping docs written here; must not restate config sync because this change introduces zero new config/env fields. |

- Shared-file conflict: `src/acp/agent-factory.ts` is shared with rows 7/9/20 (consume-only here); `agent-config/` is shared with row 20 (author content here, install there); `docs/OMP_COMPATIBILITY.md` stays P0-owned — this change documents settings under `docs/OMP_SETTINGS.md` and cross-links; `CHANGELOG.md` requires serial integration.
- Spec-conflict: ADDED requirements are uniquely named within `acp-integration`; downstream rows must apply their deltas serially and must not modify the record-reset gate requirement to claim a working reset without a P0 revision plus user decision.
