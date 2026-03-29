## MODIFIED Requirements

### Requirement: SelfResearchScheduler extends BaseScheduler
The `SelfResearchScheduler` SHALL extend `BaseScheduler`, inheriting common lifecycle management while providing its own scheduling configuration.

#### Scenario: Scheduler extends BaseScheduler
- **WHEN** `SelfResearchScheduler` is instantiated
- **THEN** it SHALL be an instance of `BaseScheduler` and use `getNextDelayMs()` to compute random intervals from `minIntervalMs`/`maxIntervalMs` config
