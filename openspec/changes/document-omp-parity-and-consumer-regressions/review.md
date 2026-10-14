# Blocking batch critique and resolution record

## Review performed

The single blocking rubber-duck reviewer `OmpParityProposals.ParityBatchDuck` read the full approved design, all originally completed six proposal sets, relevant repository source/tests/specs, and pinned native mechanisms. It reported three blocking issues and one non-blocking false-positive risk. No implementation or checks were run by the reviewer. Its initial verdict required targeted revisions before implementation.

## Findings and authored corrections

| Finding | Original evidence | Correction and ownership |
|---|---|---|
| Native config/data invisible under confinement | sandbox-manager.ts passes only cwd/TMPDIR/agentWorkspace/skillRoot; filesystem-confinement defaults exclude native HOME config and pooled mode data | D Task1.2 explicitly carries selected read-only native assets and selected writable XDG_DATA_HOME/omp child using existing shared mount arrays. Shared overlap refusal/read-only skill bind and unchanged OpenCode mounts remain. D has real confined IO controls; G has real native confined catalog/persistence/load. No broad HOME/pool/dataRoot mount. |
| Old current contracts contradict cutover | Fail-Closed ACP Root Observation and Evidence Limits still P0-blocking; Scoped Agent State Selectors still PI_CODING_AGENT_DIR; Per-Channel Shared ACP Process Pool still mode-specific cwd/TMPDIR | D deltas explicitly retire mixed old requirements and add shared canonical evidence and pool-entry/data replacements. Every existing shared lease/key/reclaim/OpenCode scenario is preserved; only obsolete governance/directory obligations are cancelled. |
| Shared inventory contract incorrectly removed | Inventory Denial Invariants Survive The Ownership Relaxation is common enumerated-entry/identity authorization, not OMP provenance | D withdraws that removal. Existing script inventory requirement, source and planted-after-enumeration/changed-identity tests remain unchanged. Coverage rows19/28 retain the shared mechanisms. |
| Unknown-tool fixture can fail as unavailable before policy | Native discoverable tools mount by default | F Task1.2 pins essential direct and discoverable mounted fixtures, exact execution/schema recipe, rejected_unknown_tool outcome and absent marker; corresponding native-YOLO positive controls must execute and create markers. |

## Final decomposition

Adding required confinement integration while retaining the native probe inside D would overpack the cutover. G `verify-omp-confined-native-runtime` is a complete3.50h evidence deliverable, owning the real-binary probe and authored test-model fixture formerly planned inside D. D remains a functioning7.75h production cutover with all mount code, callsites and changed-behavior IO tests already present. G is not a runtime bridge, placeholder or delayed import repair. Seven changes total40.50h; all individually below8h including verification/repair. F depends on G and E; serial order A,B,C,D,E,G,F.

## Review execution limit

After all seven artifact sets were complete and the findings above corrected, the same reviewer was revived to amend its verdict over the repaired D/F and the split G. The platform returned `usage_limit_reached` with no answer. Consequently there is **no observed independent amended seven-set clearance**, and this record does not fabricate one. The observed result is the original blocking critique plus the concrete authored corrections above. The supervisor was informed of this external reviewer-execution blocker.

## Validation and evidence limits

All seven `openspec validate <change> --strict` commands passed after the corrections. This validates planning syntax only, not implementation or runtime behavior. No application implementation, tests, builds, linters, formatters, native-binary smoke, container, proxy or platform checks were executed during proposal creation. Source-grounded planned acceptance and exact prerequisites remain in each tasks.md. Proposal-only commits stay on master and touch only their corresponding change directory; unrelated documentation was not modified or included.
