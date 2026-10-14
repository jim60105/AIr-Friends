# Spec Delta

## ADDED Requirements

### Requirement: OMP Mode Pools Recover Through Their Existing Connector

OMP restricted and YOLO pool entries SHALL remain distinct and recover through their existing connector options. Recovery SHALL preserve the global execution lease, current-session pointer and per-session JWT/staging identity without an additional OMP ownership gate.

#### Scenario: Mode coexistence and recovery
- **WHEN** one mode’s process dies while sessions for both modes exist
- **THEN** recovery SHALL restart that entry with its existing options and at most one session SHALL retain the execution lease.

#### Scenario: Session identity after restore
- **WHEN** a pooled session resumes
- **THEN** its own active-session pointer and JWT SHALL authorize skill callbacks and sibling identity SHALL not be substituted.

#### Scenario: OpenCode pool reuse
- **WHEN** OpenCode sessions change per-session permission mode
- **THEN** the existing canonical pool key and same-process reuse SHALL remain unchanged.

