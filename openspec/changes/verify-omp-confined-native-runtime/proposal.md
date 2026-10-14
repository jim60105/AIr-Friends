# Proposal

## Why

The dependency-closed native cutover needs real pinned-binary evidence under filesystem confinement, not only successful helper or delivered-artifact mocks. A separate complete acceptance deliverable keeps runtime mount integration and its consumer repair allowance below eight hours without postponing production prerequisites.

## What Changes

- Add a real OMP 18.6.1 ACP initialize/new/catalog/cancel/load probe for both launch modes and pooled native data roots with confinement enabled and disabled.
- Hand-author the tracked native model fixture used here and by the final model-driven consumer suite; fixture setup installs authored bytes before the production observation interval.
- Observe authored config file accesses and native database/session writes without generating configuration or asserting settings-byte equality.
- Report binary/bwrap/trace prerequisites as explicit failures, and label native, mocked and unexercised evidence separately.
- No production implementation changes; runtime paths and mounts are complete in the prerequisite.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: real native confined runtime acceptance and evidence boundaries.

## Impact

New `tests/acp/omp-native-runtime-smoke.test.ts`, `tests/fixtures/omp-native-runtime/home/.omp/agent/models.yml`, native evidence sections in `docs/OMP_SPAWN.md`, `docs/OMP_PACKAGING.md` and `CHANGELOG.md`. Production code and OpenCode behavior remain unchanged. Covers native evidence for design items 3, 6, 7, 12, 17, 29 and 30, supplementing—not replacing—the full 37-item table in document-omp-parity-and-consumer-regressions/coverage.md.

## Effort

Estimated implementation 2.50 h plus final verification/repair 1.00 h = **3.50 h**, strictly below eight hours. Estimates are not guarantees. Detailed tasks contain exact targets, APIs, inputs, failures and observable acceptance.

## Batch:

depends-on: cutover-omp-native-runtime

code-conflict: tests/acp/omp-native-runtime-smoke.test.ts; tests/fixtures/omp-native-runtime/; docs/OMP_SPAWN.md; docs/OMP_PACKAGING.md; CHANGELOG.md; openspec/specs/acp-integration/spec.md

D owns all production mounts/launch consumers and their behavioral IO tests. This change owns the native probe/model fixture. It may follow D before or after the container-installation change; serialize shared documentation with installation. The final consumer proposal requires both installation and this change. Recommended serial order A,B,C,D,E,G,F.
