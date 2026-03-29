## MODIFIED Requirements

### Requirement: GitBackupScheduler extends BaseScheduler
The `GitBackupScheduler` SHALL extend `BaseScheduler`, inheriting common lifecycle management while providing its fixed-interval scheduling and immediate-first-execution behavior.

#### Scenario: Scheduler extends BaseScheduler
- **WHEN** `GitBackupScheduler` is instantiated
- **THEN** it SHALL be an instance of `BaseScheduler` and use `getNextDelayMs()` to return the configured `intervalMs`

#### Scenario: Immediate execution on first start preserved
- **WHEN** `start()` is called without restored state
- **THEN** the scheduler SHALL execute immediately (delay of 0) on first start, matching current behavior
