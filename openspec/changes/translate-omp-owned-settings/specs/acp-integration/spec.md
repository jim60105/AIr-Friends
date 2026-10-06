## ADDED Requirements

### Requirement: Mode-Separated Owned OMP Settings Content

The system SHALL provide, as pure data and assembly code, deployment-owned OMP settings content for exactly two modes: restricted and native-yolo. Each mode's composition SHALL resolve to complete owned settings documents plus owned provider-model and system-prompt assets, with ordered `--config` overlay paths placing the mode document last among deployment overlays, and with the required environment posture (deployment-owned `PI_CODING_AGENT_DIR` under the selected process state root; no `OMP_PROFILE`/`PI_PROFILE`/`PI_CONFIG_FILES` inheritance; deployment-owned launch working directory) recorded as consumer contracts for the spawn change. The composition SHALL contain no subprocess launch, pool, tool-policy-record, LSP-implementation, or packaging logic.

#### Scenario: Both mode compositions assemble deterministically
- **WHEN** the composition is requested for `restricted` and for `native-yolo`
- **THEN** each SHALL return its complete owned overlay document, ordered overlay paths with the mode document last, owned provider-model asset content, the system-prompt asset mapping, and the supported provider environment key set
- **AND** repeated assembly SHALL produce identical content without reading workspace state

#### Scenario: Workspace layer cannot loosen the pins
- **WHEN** a fixture presents a workspace/project `.omp/config.yml` or a populated global config as hostile lower layers
- **THEN** the composition SHALL record the source-backed neutralization responsibilities (deployment-owned launch cwd preventing project-layer discovery, empty deployment-owned global agent directory, owned overlay paths outside agent-writable roots) as spawn/packaging contracts
- **AND** no requirement in this delta SHALL claim ordering alone removes keys present only in lower layers

### Requirement: Source-Backed Security Schema Key Validation

Every security-relevant key the owned overlays may set SHALL be a setting registered at pinned official OMP `v18.6.1` / `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`, and assembly validation SHALL reject any key absent from that pinned schema and any value outside the registered type or enum. The restricted composition SHALL pin the approval mode to an explicit non-YOLO registered value, SHALL carry the LSP-disable pin owned for the later LSP change, and SHALL disable startup update checks, marketplace auto-update, and pin the update channel, plus a complete-replacement disabled-provider array. Unknown YAML keys or invalid values that fall back to native schema defaults SHALL NOT be treated as protection, and the settings content SHALL NOT define per-tool approval-policy records, tool-inventory enablement, or MCP/project-disabling policy, which are owned by the restricted tool-policy and transport changes.

#### Scenario: Unregistered key or invalid value is rejected at assembly
- **WHEN** a fixture overlay document contains an invented key, a case-mismatched enum value, or a key valid in another OMP release but unregistered at the pinned revision
- **THEN** assembly validation SHALL fail naming the key and the pinned-revision reason
- **AND** it SHALL NOT emit a document that relies on native default fallback for a security-relevant field

#### Scenario: Restricted pins are present with registered values
- **WHEN** the restricted overlay document is parsed
- **THEN** it SHALL select an explicit registered non-YOLO approval mode, carry the LSP-disabled pin, disable startup update checking and marketplace auto-update, pin the update channel, and contain a complete provider-disable array
- **AND** it SHALL NOT contain per-tool approval policy records

### Requirement: Authoritative Record Reset Remains an Unresolved Application Gate

The owned-settings composition SHALL model the pinned settings loader's actual merge semantics: all CLI overlay files fold into one mapping before deep-merging over global and project layers, base-only entries survive, and a configured `null` counts as unset. The composition SHALL expose the record-reset status as unresolved and SHALL NOT assert that a null-reset overlay followed by a mode overlay clears lower-layer approval records. Documentation and tests SHALL state the consequence: lower-layer grant, prompt, or deny approval records can survive into an OMP process, the restricted execution-time default-deny policy is the operative boundary while this gate stands, and any OMP security consumption of these overlays is blocked until the compatibility change records a supported reset mechanism and the user approves it. No generated content, fixture, or mock SHALL certify a working settings-layer reset, and no test SHALL reorder merge layers to make a reset recipe pass.

#### Scenario: Surviving lower records are the expected test result
- **GIVEN** a lower layer with an unknown-tool grant and a read denial, a reset overlay setting the approval record to null, and a mode overlay supplying a read mapping
- **WHEN** the faithful merge model folds the CLI overlays and merges over the lower layer
- **THEN** the test SHALL observe the lower-only grant surviving and the null behaving as unset
- **AND** it SHALL classify the reset-then-mode recipe as not providing record clearance, without remodeling layer order to obtain a different result

#### Scenario: Gate blocks security consumption, not data generation
- **WHEN** the composition is requested while the reset boundary is unresolved
- **THEN** it SHALL return the settings content together with the unresolved gate record
- **AND** downstream security use SHALL require an explicit compatibility-verdict revision and user decision rather than passing unit tests

### Requirement: OMP Provider and Application Identity Translation

The owned provider assets SHALL express Gemini exclusively as the pinned provider id `google` credentialed by `GEMINI_API_KEY` and OpenRouter credentialed by `OPENROUTER_API_KEY`, using only the row-approved supported credential set and introducing no new credential or configuration field. The assets SHALL carry the `X-Title: AIr-Friends` application header through the pinned custom-provider header mechanism. Where pinned source shows a built-in identity header that the supported content mechanism cannot override, the translation SHALL record the exact non-preserved identity element and its source symbols as an explicit compatibility item instead of inventing a setting or faking preservation through mocks. Owned assets SHALL contain no hardcoded model identifiers; operator model selectors SHALL be validated only against the selected agent's advertised catalog.

#### Scenario: Provider credentials and ids match the pinned scheme
- **WHEN** the owned provider asset content and environment posture are inspected
- **THEN** Gemini SHALL appear only as provider `google` with `GEMINI_API_KEY`, OpenRouter only with `OPENROUTER_API_KEY`
- **AND** no additional provider credential, profile selector, or platform secret SHALL be required or passed

#### Scenario: Application title preserved and referer divergence recorded
- **WHEN** the OpenRouter header translation is assembled against pinned header-application order
- **THEN** the owned `X-Title: AIr-Friends` value SHALL survive on OpenRouter requests
- **AND** the documentation SHALL record that the pinned built-in `HTTP-Referer` identity cannot be overridden through the supported content path, naming the source symbols, instead of claiming preservation

#### Scenario: No model identifier is baked into owned assets
- **WHEN** every owned overlay and provider asset is scanned for model identifiers
- **THEN** no OpenCode-format or fixed model id SHALL be present
- **AND** a requested model missing from the advertised agent catalog SHALL remain an explicit selection error owned by the session-config change

### Requirement: Compaction, Update Posture, and Prompt Mapping Decisions

The owned content SHALL keep automatic conversation compaction enabled using the pinned native strategy and SHALL document the native pruning/summarization behavioral difference from the existing OpenCode compaction configuration instead of asserting equivalence or inventing an unavailable native field. The update posture SHALL disable the schema-supported automatic update surfaces and SHALL state that binary version changes remain deliberate deployment actions; it SHALL NOT invent a nonexistent whole-updater kill switch. The system-prompt mapping SHALL route `/app/prompts/system_prompt_override.md` to the pinned supported custom-prompt mechanism (owned agent-directory discovered file and explicit launch-path contract) and SHALL record that runtime application and behavioral adequacy under generated native surfaces remain user-verified compatibility items; per-file payload prompt mounts consumed by the existing pipeline SHALL be documented as requiring no agent-settings translation.

#### Scenario: Compaction stays enabled with documented native differences
- **WHEN** the shared deployment content is parsed and the mapping documentation is read
- **THEN** automatic compaction SHALL be enabled in both mode documents
- **AND** the documentation SHALL describe the native strategy's actual methods/triggers and state that the existing prune-style control has no native equivalent, without emitting any invented compaction key

#### Scenario: Update posture disables automatic surfaces honestly
- **WHEN** the update-posture keys are parsed
- **THEN** startup update checking and marketplace auto-update SHALL be disabled and the update channel pinned
- **AND** the documentation SHALL state that the explicit operator update command remains available and that version changes occur only through deliberate image updates

#### Scenario: Prompt override mapping asserts mechanism, not runtime effect
- **WHEN** the prompt mapping is assembled
- **THEN** it SHALL name the supported custom-prompt route, the owned file location under the deployment-owned agent directory, and the explicit-path contract for the spawn change
- **AND** neither the mapping nor any test SHALL claim the override is applied at runtime before the compatibility checklist item is user-verified

### Requirement: Restricted and YOLO Overlay Non-Contamination

Restricted-only pins SHALL appear exclusively in the restricted composition, and the native-yolo composition SHALL select the pinned native YOLO approval mode while carrying only shared deployment content. The native-yolo document SHALL NOT contain per-tool approval records, approval-record resets, the provider-disable array, or any LSP key, so native YOLO remains maximally permissive and no restricted clamp crosses into it.

#### Scenario: YOLO document carries no restricted clamp
- **WHEN** the native-yolo overlay document is parsed
- **THEN** it SHALL contain the native YOLO approval mode and shared deployment pins only
- **AND** it SHALL contain no per-tool approval content, no approval null-reset, no provider-disable entry, and no LSP setting

#### Scenario: Restricted document retains its pins
- **WHEN** the restricted overlay document is parsed
- **THEN** the restricted pin set SHALL be present and the two documents SHALL share only the declared shared deployment key set
