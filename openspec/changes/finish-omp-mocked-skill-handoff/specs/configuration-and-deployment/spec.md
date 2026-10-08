## ADDED Requirements

### Requirement: Batch Configuration-Documentation Consistency Audit

The repository SHALL carry a completed consistency audit proving that every configuration or environment field introduced or widened by any change in the OMP integration batch is documented consistently across `config.example.yaml`, `.env.example`, and `helm/values.yaml`, with the audit results recorded as a table in the project's agent-facing documentation.

#### Scenario: Every audited field is present in all three files
- **GIVEN** the audited field set from the documentation audit table
- **WHEN** the synchronization test inspects `config.example.yaml`, `.env.example`, and `helm/values.yaml`
- **THEN** each audited field name SHALL be present in every one of the three files
- **AND** the `defaultAgentType`/`AGENT_DEFAULT_TYPE` documentation SHALL describe both `opencode` and `omp` with `opencode` as the default

#### Scenario: Undocumented OMP-related name fails the audit
- **GIVEN** an OMP-related configuration or environment name newly added to one of the three documentation files without a matching audit-table row
- **WHEN** the synchronization test runs
- **THEN** the test SHALL fail, naming the undocumented field and the file

#### Scenario: Drift is repaired documentation-only
- **GIVEN** the audit finds an audited field missing from one of the three files
- **WHEN** the reconciliation is applied
- **THEN** only the affected documentation files SHALL change, mirroring the field's existing treatment in the other files
- **AND** no source, Helm template, or runtime behavior SHALL be modified by the reconciliation

#### Scenario: Minimum audited field set is covered
- **GIVEN** the audited field set of the consistency audit
- **WHEN** it is inspected
- **THEN** it SHALL include at minimum the `agent.defaultAgentType`/`AGENT_DEFAULT_TYPE` value domain with `omp` as a valid value and the `AGENT_OMP_MIN_VERSION` override

#### Scenario: No-new-field batch claims hold under the audit
- **GIVEN** a batch change claiming to introduce no new configuration or environment field
- **WHEN** the audit runs
- **THEN** the change SHALL in fact have added no field to `config.example.yaml`, `.env.example`, or `helm/values.yaml`

#### Scenario: The audit is non-destructive and recorded
- **GIVEN** the audit and any documentation-only drift repair of this final change
- **WHEN** their effects are inspected
- **THEN** the audit SHALL NOT introduce, rename, or remove any configuration or environment field
- **AND** any documentation-only repair SHALL be recorded in this final change

### Requirement: Single User-Runtime Verification Checklist Artifact

The repository SHALL provide exactly one consolidated user-owned runtime verification checklist artifact carrying every observation from the approved integration design's user-verification section, expanded with the per-area runtime items recorded across the batch's OMP documentation.

#### Scenario: Checklist carries the design list unverified
- **WHEN** the consolidated checklist artifact is inspected
- **THEN** every user-owned runtime observation named in the approved design's verification section SHALL appear as a checklist row
- **AND** each active row's runtime outcome SHALL read unverified with space for a user observation, while historically cancelled readiness observations SHALL be marked cancelled by user decision with the accepted residual risk retained
- **AND** no row SHALL cite unit or mock results as runtime verification

#### Scenario: OMP documents resolve to one checklist home
- **GIVEN** any OMP-area documentation file
- **WHEN** its verification pointers are inspected
- **THEN** it SHALL contain an append-only cross-link to the single consolidated checklist artifact
- **AND** the checklist SHALL link back to that file's area with its items enumerated

#### Scenario: Every checklist item separates its evidence into three kinds
- **WHEN** any checklist row is inspected
- **THEN** it SHALL separate source-audit evidence, unit/mock evidence, and user runtime evidence

#### Scenario: Predecessor documentation gains cross-links only
- **GIVEN** a predecessor document with existing verification content
- **WHEN** its cross-link to the consolidated checklist artifact is added
- **THEN** its existing content SHALL be extended with the cross-link only, except the explicitly authorized decision-register section 1a and batch-index synchronization; pinned ledger verdicts SHALL never be rewritten

### Requirement: Batch Documentation Final-Consistency Pass

The final documentation pass SHALL consolidate the batch's change-history entries so that every batch change that owed one has exactly one entry, including a test-lifecycle change whose entry was explicitly deferred to this final change, with no duplicated description of one shipped behavior.

#### Scenario: Deferred changelog entry lands once
- **WHEN** the change history is audited after the final pass
- **THEN** the test-lifecycle change whose changelog entry was deferred SHALL have exactly one entry added by this final change
- **AND** no previously shipped entry SHALL be duplicated or rewritten except a factually wrong entry reconciled with a recorded note

#### Scenario: README states honest status
- **WHEN** the README integration section is read
- **THEN** it SHALL name both supported agent types with the OpenCode default and unknown-value rejection
- **AND** it SHALL state that automated unit and mock evidence does not certify native runtime enforcement and that runtime verification remains user-owned

#### Scenario: README and agent-facing docs state the deployment behavior
- **GIVEN** the README integration section and the agent-facing documentation
- **WHEN** they are read
- **THEN** they SHALL state the available agent types with the OpenCode default and load-time rejection of unknown values
- **AND** they SHALL state the restricted-versus-native-YOLO deployment behavior

#### Scenario: Honest integration status is stated
- **GIVEN** the agent-facing documentation's integration status
- **WHEN** it is read
- **THEN** it SHALL state that the proposals are approved and the implementation lands through the applied changes
- **AND** all seven user dispositions SHALL be described as DECIDED while pinned incompatible/unresolved verdicts stay unchanged and runtime verification stays user-owned/unverified

#### Scenario: Payload-file and prompt contract is recorded in final form
- **WHEN** the documentation of the payload-file and prompt contract is inspected
- **THEN** it SHALL record literal session ids and absolute staging paths in prompts and skill recipes
- **AND** the legacy token-path expansion SHALL be retained for existing OpenCode callers only

### Requirement: Final OMP Decision Register And Batch Synchronization

The final synchronization SHALL preserve the decision register as authoritative, state all seven dispositions DECIDED without relabeling pinned incompatible/unresolved verdicts, record gate-omp-policy-readiness removed from the batch with client-observable readiness cancelled, and state LSP-all-off for OMP restricted+YOLO and OpenCode build+yolo through per-agent OpenCode denies. The CHANGELOG SHALL record those planning decisions and their evidence limits exactly once.

#### Scenario: Final documents reflect decided posture
- **WHEN** the batch-final documentation synchronization completes
- **THEN** decision register and index SHALL retain all seven DECIDED dispositions and unchanged pinned verdicts, show row 13 removed without renumbering, and name both agents and both modes for LSP denial
- **AND** the accepted absent-handler residual risk and cancelled readiness requirement SHALL be recorded without native enforcement claims

#### Scenario: Planning decisions receive one changelog entry
- **WHEN** CHANGELOG is consolidated
- **THEN** the readiness cancellation, row 13 removal and both-agent LSP posture SHALL be recorded once with their evidence limits
- **AND** no mock result SHALL be described as clearing a native compatibility verdict
