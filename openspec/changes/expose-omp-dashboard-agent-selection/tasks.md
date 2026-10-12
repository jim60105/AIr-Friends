# Tasks

Archived dashboard API support; independent, listed last for single-writer ordering (C7). Run build/format/lint/affected tests once after all implementation edits, not between tasks. Automated acceptance is deterministic source/API-shaped smoke only; native runtime, providers, platforms, and containers remain user-owned.

## 1. Expose and forward the existing supported choice

- [ ] 1.1 Add OMP to the existing labelled agent selector while retaining OpenCode and current initial selection; reuse current forwarding and change JavaScript only if necessary. Verify each selected value reaches the current authenticated request body without changing model or lifecycle controls.
- [ ] 1.2 Update dashboard usage docs and changelog and adjust existing consumer-visible contract coverage only where behavior changes. Verify unsupported API types still reject and omitted type retains configured-default behavior; do not add source/option-copy tests.

## 2. Actual dashboard smoke

- [ ] 2.1 After all edits, launch the actual dashboard page in throwaway Chromium with a mocked authenticated connect/SSE boundary, select and connect once with each agent, and inspect request bodies. Verify omp/opencode are forwarded as selected with no real agent/provider launch; close the throwaway browser and report visual/API evidence separately.

## Workflow follow-up

- Archive and sync after implementation/review gates; leave historical archives unchanged.
- Apply successors in the correction index order; rebuild/recut owned outputs for each affected successor.
