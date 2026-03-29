## MODIFIED Requirements

### Requirement: ReminderScheduler extends BaseScheduler
The `ReminderScheduler` SHALL extend `BaseScheduler`, inheriting common lifecycle management while preserving its lack of state persistence.

#### Scenario: Scheduler extends BaseScheduler
- **WHEN** `ReminderScheduler` is instantiated
- **THEN** it SHALL be an instance of `BaseScheduler` and use `getNextDelayMs()` to return the configured `checkIntervalMs`

#### Scenario: No state persistence
- **WHEN** `ReminderScheduler` starts
- **THEN** it SHALL NOT use `SchedulerStateStore` for persistence, matching current behavior
