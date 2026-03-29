## MODIFIED Requirements

### Requirement: MemoryMaintenanceScheduler extends BaseScheduler
The `MemoryMaintenanceScheduler` SHALL extend `BaseScheduler`, inheriting common lifecycle management while providing its fixed-interval scheduling configuration.

#### Scenario: Scheduler extends BaseScheduler
- **WHEN** `MemoryMaintenanceScheduler` is instantiated
- **THEN** it SHALL be an instance of `BaseScheduler` and use `getNextDelayMs()` to return the configured `intervalMs`
