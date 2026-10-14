# Spec Delta

## ADDED Requirements

### Requirement: Pinned Native OMP Confined Runtime Consumer Evidence

Native OMP acceptance SHALL exercise the official pinned binary with the authored configuration and shipped native-loadable extension, and SHALL distinguish real native lifecycle/configuration evidence from mock/helper dispatch evidence. Required binary/confinement/observation prerequisites SHALL fail explicitly when unavailable or mismatched.

#### Scenario: Authored models in both launch modes
- **WHEN** restricted and YOLO native ACP processes initialize and create sessions using the authored fixture
- **THEN** the actual native model catalog SHALL resolve the fixture model without generated configuration, a fabricated catalog or a paid prompt.

#### Scenario: Confined pooled native persistence and load
- **WHEN** real opposite-mode pool consumers run with filesystem confinement enabled and restore their own actual sessions after process restart
- **THEN** each SHALL consume its selected read-only assets and persist/load beneath its own selected native data directory while shared lease/mode selection remains in effect.

#### Scenario: No authored configuration writes
- **WHEN** production factory/native startup runs after named test provisioning is complete
- **THEN** writable opens or replacements of authored native mode/model YAML SHALL be absent, as observed by filesystem events rather than settings-byte equality.

#### Scenario: Missing prerequisites are not success
- **WHEN** the exact pinned native binary, supported confinement runtime or required filesystem observation cannot be exercised
- **THEN** acceptance SHALL report the precise failed prerequisite and SHALL not silently skip or label mock evidence as native success.
