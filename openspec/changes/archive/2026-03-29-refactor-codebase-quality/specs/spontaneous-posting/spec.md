## MODIFIED Requirements

### Requirement: SpontaneousScheduler manages per-platform timers
The `SpontaneousScheduler` SHALL extend `BaseScheduler` while preserving its per-platform independent timer management via `Map<Platform, PlatformSchedulerState>`.

#### Scenario: Scheduler extends BaseScheduler
- **WHEN** `SpontaneousScheduler` is instantiated
- **THEN** it SHALL be an instance of `BaseScheduler` and inherit common lifecycle methods

#### Scenario: Per-platform scheduling is preserved
- **WHEN** `start()` is called on the spontaneous scheduler
- **THEN** it SHALL create independent timers for each valid platform, each with its own random interval computed from platform-specific config
